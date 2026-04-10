/**
 * Git 认证管理（Token + SSH 密钥）
 * Token 使用 Electron safeStorage 加密存储
 */
const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');
const { execFile } = require('child_process');

var _storePath = null;
var _store = null;

function getStorePath() {
  if (!_storePath) {
    _storePath = path.join(app.getPath('userData'), 'git-auth.json');
  }
  return _storePath;
}

function loadStore() {
  if (_store) return _store;
  try {
    var data = fs.readFileSync(getStorePath(), 'utf-8');
    _store = JSON.parse(data);
  } catch (e) {
    _store = {};
  }
  return _store;
}

function saveStore() {
  fs.writeFileSync(getStorePath(), JSON.stringify(_store || {}, null, 2), 'utf-8');
}

// ===== Token 管理 =====

async function saveToken(kbPath, token) {
  var store = loadStore();
  if (!store[kbPath]) store[kbPath] = {};
  try {
    if (safeStorage.isEncryptionAvailable()) {
      store[kbPath].token = safeStorage.encryptString(token).toString('base64');
      store[kbPath].tokenEncrypted = true;
    } else {
      // safeStorage 不可用时明文存储（仅开发场景）
      store[kbPath].token = Buffer.from(token).toString('base64');
      store[kbPath].tokenEncrypted = false;
    }
  } catch (e) {
    store[kbPath].token = Buffer.from(token).toString('base64');
    store[kbPath].tokenEncrypted = false;
  }
  saveStore();
  return { ok: true };
}

async function getToken(kbPath) {
  var store = loadStore();
  var entry = store[kbPath];
  if (!entry || !entry.token) return null;
  try {
    if (entry.tokenEncrypted && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(entry.token, 'base64'));
    }
    return Buffer.from(entry.token, 'base64').toString('utf-8');
  } catch (e) {
    return null;
  }
}

async function setAuthType(kbPath, authType) {
  var store = loadStore();
  if (!store[kbPath]) store[kbPath] = {};
  store[kbPath].authType = authType; // 'token' | 'ssh'
  saveStore();
  return { ok: true };
}

async function getAuthType(kbPath) {
  var store = loadStore();
  var entry = store[kbPath];
  return { ok: true, authType: entry ? (entry.authType || 'token') : 'token' };
}

// ===== SSH 密钥管理 =====

function getSSHKeyPath() {
  return path.join(app.getPath('userData'), 'topomind-git-key');
}

async function ensureSSHKey() {
  var privPath = getSSHKeyPath();
  var pubPath = privPath + '.pub';

  if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
    return { privPath: privPath, pubPath: pubPath };
  }

  return new Promise(function(resolve, reject) {
    execFile('ssh-keygen', [
      '-t', 'ed25519',
      '-C', 'topomind-sync@' + require('os').hostname(),
      '-f', privPath,
      '-N', ''  // 无密码
    ], function(err) {
      if (err) reject(err);
      else resolve({ privPath: privPath, pubPath: pubPath });
    });
  });
}

async function getSSHPublicKey() {
  try {
    var paths = await ensureSSHKey();
    var pub = fs.readFileSync(paths.pubPath, 'utf-8').trim();
    return { ok: true, publicKey: pub };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ===== 构建 Git 环境变量 =====

/**
 * 为 simple-git 构建认证环境变量
 * @param {string} kbPath 知识库相对路径（用于查找存储的认证信息）
 * @param {string} remoteUrl 远程仓库 URL
 */
async function buildGitEnv(kbPath, remoteUrl) {
  if (!remoteUrl) return {};

  var isSSH = remoteUrl.startsWith('git@') || remoteUrl.startsWith('ssh://');
  var store = loadStore();
  var entry = store[kbPath] || {};
  var authType = entry.authType || (isSSH ? 'ssh' : 'token');

  if (authType === 'ssh' || isSSH) {
    try {
      var paths = await ensureSSHKey();
      return {
        GIT_SSH_COMMAND: 'ssh -i "' + paths.privPath + '" -o StrictHostKeyChecking=accept-new -o BatchMode=yes'
      };
    } catch (e) {
      return {};
    }
  } else {
    // HTTPS Token
    var token = await getToken(kbPath);
    if (token) {
      // 方式1：通过环境变量注入（更安全，不在 URL 中暴露）
      return {
        GIT_ASKPASS: 'echo',
        GIT_USERNAME: 'oauth2',
        GIT_PASSWORD: token,
        // 方式2（备选）：直接修改 URL，针对 GitHub
        // 在 push/pull 时 simple-git 不一定能用上面的方式，所以同时提供
      };
    }
    return {};
  }
}

module.exports = {
  saveToken: saveToken,
  getToken: getToken,
  setAuthType: setAuthType,
  getAuthType: getAuthType,
  ensureSSHKey: ensureSSHKey,
  getSSHPublicKey: getSSHPublicKey,
  buildGitEnv: buildGitEnv,
};
