/**
 * AI 配置与密钥存储（主进程，P0；P5 扩展为多模型）。
 *
 * 设计约束（docs/design/native-ai-agent-design.md §7）：
 *  - 一期只支持「用户自带 Key 的云端 API」；`providerType` 预留 ollama / hosted 扩展点；
 *  - 明文 Key 永不进入渲染进程、永不进入日志、永不写进 `_config.json`；
 *  - 用 Electron safeStorage（Windows DPAPI / macOS Keychain / Linux libsecret）加密后落盘；
 *  - 所有文件放在当前工作目录的 `.topomind/ai/`，随工作区切换自然隔离。
 *
 * 多模型（P5）：
 *  - `config.json` 的顶层 7 个连接字段仍是**默认模型的镜像**（旧版渲染层、旧 GUI
 *    冒烟、buildRequestBody 都按这个契约读），另加 `models[]` 与 `defaultModelId`；
 *  - 老配置没有 models[] 时，读盘会用它自己的顶层字段合成 1 个 `model.default`，
 *    因此升级零迁移、旧配置不会丢；
 *  - keyring.json 的 `cipher` 是共享 / 旧版 Key，`keys{id}` 是模型专属 Key；
 *    专属 Key 缺失时回退共享 Key —— 同一服务商下新增多个模型不必重复填 Key；
 *  - 保存时「旧接口只改顶层字段」与「新接口改 models[]」两条路径都会把默认模型
 *    镜像回顶层，保证 `readAiConfig().config.baseURL` 一类的既有断言始终成立。
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

export const DEFAULT_MODEL_ID = 'model.default';
export const MAX_MODELS = 20;

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
    const raw = nodeFileRead(filePath);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    // 派生数据损坏时自愈：调用方按默认值重建，不阻断主流程。
    return null;
  }
}

function nodeFileRead(filePath) {
  return nodeFs.readFileSync(filePath, 'utf8');
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

/** 单个模型 / 顶层共用的连接参数白名单；base 让新模型继承全局服务地址与参数。 */
function normalizeConnection(raw, base = DEFAULT_AI_CONFIG) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    providerType: PROVIDER_TYPES.has(input.providerType) ? input.providerType : base.providerType,
    baseURL: shortString(input.baseURL, 300, base.baseURL),
    model: shortString(input.model, 120, base.model),
    temperature: clampNumber(input.temperature, 0, 2, base.temperature),
    maxTokens: Math.round(clampNumber(input.maxTokens, 1, 32768, base.maxTokens)),
    timeoutMs: Math.round(clampNumber(input.timeoutMs, 5000, 300000, base.timeoutMs)),
    contextBudget: Math.round(clampNumber(input.contextBudget, 1000, 128000, base.contextBudget)),
  };
}

/** 模型列表归一化：id 去重补齐、字段白名单、至少保留一个模型。 */
export function normalizeModelProfiles(rawModels, base = DEFAULT_AI_CONFIG) {
  const connection = normalizeConnection(base);
  const list = Array.isArray(rawModels) ? rawModels.slice(0, MAX_MODELS) : [];
  const used = new Set();
  const profiles = list.map((item, index) => {
    const raw = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
    let id = shortString(raw.id, 80, `${DEFAULT_MODEL_ID}.${index + 1}`);
    if (used.has(id)) id = `${id}.${index + 1}`;
    while (used.has(id)) id = `${id}.${index + 1}`;
    used.add(id);
    const fields = normalizeConnection(raw, connection);
    return { id, name: shortString(raw.name, 60, fields.model), ...fields };
  });
  if (profiles.length > 0) return profiles;
  // 老配置 / 空配置：用顶层字段合成一个默认模型，升级零迁移。
  return [{ id: DEFAULT_MODEL_ID, name: '默认模型', ...connection }];
}

/** 配置输入归一化：顶层 7 字段 + 模型列表 + 默认 id，未知字段一律丢弃。 */
export function normalizeAiConfig(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const connection = normalizeConnection(input);
  const models = normalizeModelProfiles(input.models, connection);
  const defaultModelId = typeof input.defaultModelId === 'string'
    && models.some((profile) => profile.id === input.defaultModelId)
    ? input.defaultModelId
    : models[0].id;
  return { ...connection, models, defaultModelId };
}

function decryptCipher(cipher) {
  if (typeof cipher !== 'string' || !cipher) return null;
  try {
    const plain = safeStorage.decryptString(Buffer.from(cipher, 'base64'));
    return typeof plain === 'string' && plain ? plain : null;
  } catch {
    // 换了系统账号 / 密钥环不可解时当作未配置，提示用户重新填写即可。
    return null;
  }
}

function encryptKey(apiKey) {
  if (!safeStorage.isEncryptionAvailable()) {
    const error = new Error('当前系统不支持安全存储，无法保存 API Key');
    error.code = 'key_storage_unavailable';
    throw error;
  }
  return safeStorage.encryptString(String(apiKey)).toString('base64');
}

/**
 * @param {{ getWorkDir: () => string }} deps getWorkDir 由 main.js 提供，返回已校验的当前工作目录
 */
export function createAiKeyStore({ getWorkDir }) {
  function readConfig() {
    const data = readJsonSafe(configPath(getWorkDir()));
    if (!data || data.version !== CONFIG_VERSION) return normalizeAiConfig({});
    return normalizeAiConfig(data.config);
  }

  function readKeyring() {
    const data = readJsonSafe(keyringPath(getWorkDir()));
    if (!data || data.version !== KEYRING_VERSION) return { cipher: null, keys: {} };
    const keys = data.keys && typeof data.keys === 'object' && !Array.isArray(data.keys) ? data.keys : {};
    return {
      cipher: typeof data.cipher === 'string' ? data.cipher : null,
      keys,
    };
  }

  function writeKeyring(value) {
    ensureAiDir(getWorkDir());
    writeJsonAtomic(keyringPath(getWorkDir()), {
      version: KEYRING_VERSION,
      algorithm: 'safeStorage',
      ...value,
    });
  }

  /** 专属 Key 优先，缺失回退共享 Key（同服务商多模型共用一把 Key 的常见情形）。 */
  function readApiKey(modelId) {
    const keyring = readKeyring();
    const own = modelId && typeof keyring.keys[modelId] === 'string'
      ? decryptCipher(keyring.keys[modelId])
      : null;
    return own ?? decryptCipher(keyring.cipher);
  }

  /** 返回给渲染层的配置：绝不包含明文 Key，只有每个模型的 hasKey 布尔值。 */
  function getPublicConfig() {
    const config = readConfig();
    const keyring = readKeyring();
    const shared = decryptCipher(keyring.cipher);
    const models = config.models.map((profile) => ({
      ...profile,
      hasKey: Boolean(decryptCipher(keyring.keys[profile.id]) ?? shared),
    }));
    return {
      ...normalizeConnection(config),
      models,
      defaultModelId: config.defaultModelId,
      hasKey: Boolean(shared),
    };
  }

  return {
    getPublicConfig,

    /** 主进程内部读取，用于发起请求；不含明文 Key。 */
    getConfig: readConfig,
    getApiKey: () => readApiKey(),

    /** 按 modelId 解析一次请求的完整连接参数 + 密钥；未知 id 回退默认模型。 */
    resolveModel(modelId) {
      const config = readConfig();
      const profile = config.models.find((item) => item.id === modelId)
        ?? config.models.find((item) => item.id === config.defaultModelId)
        ?? config.models[0];
      return {
        modelId: profile.id,
        config: normalizeConnection(profile),
        apiKey: readApiKey(profile.id),
      };
    },

    /**
     * 保存配置。两条入口都收敛到同一份 models[]：
     *  - 新 UI：patch.models / defaultModelId / modelKeys / clearModelKeys；
     *  - 旧 UI / 冒烟：patch 只改顶层字段，镜像进当前默认模型。
     * 明文 Key 只在这里加密写入 keyring，返回值始终是可回传渲染层的公开配置。
     */
    saveConfig(patch) {
      const input = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
      const current = readConfig();
      const legacyPatch = normalizeConnection({ ...current, ...input });
      let models;
      if (Array.isArray(input.models)) {
        models = normalizeModelProfiles(input.models, legacyPatch);
      } else {
        const mirrored = current.models.map((profile) => (
          profile.id === current.defaultModelId ? { ...profile, ...legacyPatch } : profile
        ));
        models = normalizeModelProfiles(mirrored, legacyPatch);
      }
      const requestedDefault = typeof input.defaultModelId === 'string' ? input.defaultModelId : current.defaultModelId;
      const defaultModelId = models.some((profile) => profile.id === requestedDefault)
        ? requestedDefault
        : models[0].id;
      const active = models.find((profile) => profile.id === defaultModelId) ?? models[0];
      // 顶层永远等于默认模型的镜像：旧调用方读到的就是当前真正生效的连接。
      const nextConfig = {
        ...normalizeConnection(active, legacyPatch),
        models,
        defaultModelId,
      };
      ensureAiDir(getWorkDir());
      writeJsonAtomic(configPath(getWorkDir()), { version: CONFIG_VERSION, config: nextConfig });

      // 密钥补丁合并成一次原子写：clearKey 只清共享 cipher，绝不删整个 keyring 文件
      // （多模型下其它模型的专属 Key 必须保留）。
      const hasKeyPatch = input.clearKey === true
        || (typeof input.apiKey === 'string' && Boolean(input.apiKey.trim()))
        || (input.modelKeys && typeof input.modelKeys === 'object' && !Array.isArray(input.modelKeys))
        || Array.isArray(input.clearModelKeys);
      if (hasKeyPatch) {
        const keyring = readKeyring();
        const nextKeys = { ...keyring.keys };
        if (input.clearKey === true) keyring.cipher = null;
        if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
          keyring.cipher = encryptKey(input.apiKey.trim());
        }
        if (input.modelKeys && typeof input.modelKeys === 'object' && !Array.isArray(input.modelKeys)) {
          for (const [id, value] of Object.entries(input.modelKeys)) {
            if (typeof id === 'string' && id && typeof value === 'string' && value.trim()) {
              nextKeys[id.slice(0, 80)] = encryptKey(value.trim());
            }
          }
        }
        if (Array.isArray(input.clearModelKeys)) {
          for (const id of input.clearModelKeys) {
            if (typeof id === 'string') delete nextKeys[id];
          }
        }
        keyring.keys = nextKeys;
        writeKeyring(keyring);
      }
      return getPublicConfig();
    },
  };
}

export default createAiKeyStore;
