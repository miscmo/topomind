/**
 * AI 配置与密钥存储（主进程，P0）。
 *
 * 设计约束（docs/design/native-ai-agent-design.md §7）：
 *  - 一期只支持「用户自带 Key 的云端 API」；`providerType` 预留 ollama / hosted 扩展点；
 *  - 明文 Key 永不进入渲染进程、永不进入日志、永不写进 `_config.json`；
 *  - 用 Electron safeStorage（Windows DPAPI / macOS Keychain / Linux libsecret）加密后落盘；
 *  - 所有文件放在当前工作目录的 `.topomind/ai/`，随工作区切换自然隔离。
 *
 * 与 file-service 一致：写盘用 temp + rename，避免半截 JSON。
 */
import nodeFs from 'fs';
import nodePath from 'path';
import { safeStorage } from 'electron';

const CONFIG_VERSION = 1;
const KEYRING_VERSION = 1;
const AI_DIR_NAME = 'ai';
const CONFIG_FILE = 'config.json';
const KEYRING_FILE = 'keyring.json';

/** 唯一允许的非敏感配置字段；未知字段一律丢弃，避免把密钥写进明文配置。 */
export const DEFAULT_AI_CONFIG = Object.freeze({
  providerType: 'openai-compatible',
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 2048,
  timeoutMs: 60000,
  contextBudget: 8000,
});

const PROVIDER_TYPES = new Set(['openai-compatible', 'ollama', 'hosted']);

function aiDir(workDir) {
  return nodePath.join(workDir, '.topomind', AI_DIR_NAME);
}

function configPath(workDir) {
  return nodePath.join(aiDir(workDir), CONFIG_FILE);
}

function keyringPath(workDir) {
  return nodePath.join(aiDir(workDir), KEYRING_FILE);
}

function ensureAiDir(workDir) {
  nodeFs.mkdirSync(aiDir(workDir), { recursive: true });
}

function readJsonSafe(filePath) {
  try {
    if (!nodeFs.existsSync(filePath)) return null;
    const raw = nodeFs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    // 派生数据损坏时自愈：调用方按默认值重建，不阻断主流程。
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  const dir = nodePath.dirname(filePath);
  nodeFs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  nodeFs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  nodeFs.renameSync(tempPath, filePath);
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function shortString(value, max, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

/** 配置输入归一化：只保留白名单字段，并钳制到安全范围。 */
export function normalizeAiConfig(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    providerType: PROVIDER_TYPES.has(input.providerType) ? input.providerType : DEFAULT_AI_CONFIG.providerType,
    baseURL: shortString(input.baseURL, 300, DEFAULT_AI_CONFIG.baseURL),
    model: shortString(input.model, 120, DEFAULT_AI_CONFIG.model),
    temperature: clampNumber(input.temperature, 0, 2, DEFAULT_AI_CONFIG.temperature),
    maxTokens: Math.round(clampNumber(input.maxTokens, 1, 32768, DEFAULT_AI_CONFIG.maxTokens)),
    timeoutMs: Math.round(clampNumber(input.timeoutMs, 5000, 300000, DEFAULT_AI_CONFIG.timeoutMs)),
    contextBudget: Math.round(clampNumber(input.contextBudget, 1000, 128000, DEFAULT_AI_CONFIG.contextBudget)),
  };
}

/**
 * @param {{ getWorkDir: () => string }} deps getWorkDir 由 main.js 提供，返回已校验的当前工作目录
 */
export function createAiKeyStore({ getWorkDir }) {
  function readConfig() {
    const data = readJsonSafe(configPath(getWorkDir()));
    if (!data || data.version !== CONFIG_VERSION) return { ...DEFAULT_AI_CONFIG };
    return normalizeAiConfig(data.config);
  }

  function readApiKey() {
    const data = readJsonSafe(keyringPath(getWorkDir()));
    if (!data || data.version !== KEYRING_VERSION || typeof data.cipher !== 'string') return null;
    try {
      const plain = safeStorage.decryptString(Buffer.from(data.cipher, 'base64'));
      return typeof plain === 'string' && plain ? plain : null;
    } catch {
      // 换了系统账号 / 密钥环不可解时当作未配置，提示用户重新填写即可。
      return null;
    }
  }

  function writeApiKey(apiKey) {
    if (!safeStorage.isEncryptionAvailable()) {
      const error = new Error('当前系统不支持安全存储，无法保存 API Key');
      error.code = 'key_storage_unavailable';
      throw error;
    }
    ensureAiDir(getWorkDir());
    const cipher = safeStorage.encryptString(String(apiKey)).toString('base64');
    writeJsonAtomic(keyringPath(getWorkDir()), {
      version: KEYRING_VERSION,
      algorithm: 'safeStorage',
      cipher,
    });
  }

  function clearApiKey() {
    const filePath = keyringPath(getWorkDir());
    try {
      if (nodeFs.existsSync(filePath)) nodeFs.unlinkSync(filePath);
    } catch {
      // 删除失败不影响后续覆盖写入。
    }
  }

  return {
    /** 返回给渲染层的配置：绝不包含明文 Key，只有 hasKey 布尔值。 */
    getPublicConfig() {
      const config = readConfig();
      return { ...config, hasKey: Boolean(readApiKey()) };
    },

    /** 主进程内部读取，用于发起请求。 */
    getConfig: readConfig,
    getApiKey: readApiKey,

    /**
     * 保存配置。`apiKey` 非空时重新加密写入；不传则保持原密钥；
     * `clearKey: true` 时删除密钥。返回值始终是可回传渲染层的公开配置。
     */
    saveConfig(patch) {
      const input = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
      const nextConfig = normalizeAiConfig({ ...readConfig(), ...input });
      ensureAiDir(getWorkDir());
      writeJsonAtomic(configPath(getWorkDir()), { version: CONFIG_VERSION, config: nextConfig });
      if (input.clearKey === true) {
        clearApiKey();
      } else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
        writeApiKey(input.apiKey.trim());
      }
      return { ...nextConfig, hasKey: Boolean(readApiKey()) };
    },
  };
}

export default createAiKeyStore;
