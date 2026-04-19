/**
 * Git Auth Service - Git 认证服务
 * 封装 Git Token 管理、SSH 密钥生成和认证环境构建能力。
 */
import nodePath from 'path';
import nodeFs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { app, safeStorage } from 'electron';

let _ga_storePath = null;
let _ga_store = null;

function _ga_getStorePath() {
  if (!_ga_storePath) _ga_storePath = nodePath.join(app.getPath('userData'), 'git-auth.json');
  return _ga_storePath;
}

function _ga_loadStore() {
  if (_ga_store) return _ga_store;
  try {
    var data = nodeFs.readFileSync(_ga_getStorePath(), 'utf-8');
    _ga_store = JSON.parse(data);
  } catch (e) { _ga_store = {}; }
  return _ga_store;
}

function _ga_saveStore() {
  nodeFs.writeFileSync(_ga_getStorePath(), JSON.stringify(_ga_store || {}, null, 2), 'utf-8');
}

function createGitAuth() {
  return {
    saveToken: function(kbPath, token) {
      return Promise.resolve().then(function() {
        var store = _ga_loadStore();
        if (!store[kbPath]) store[kbPath] = {};
        if (!safeStorage.isEncryptionAvailable()) {
          return { ok: false, error: '系统安全存储不可用，无法保存 Token。请确保系统密钥链服务正常运行。' };
        }
        try {
          store[kbPath].token = safeStorage.encryptString(token).toString('base64');
          store[kbPath].tokenEncrypted = true;
          _ga_saveStore();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: '加密 Token 失败: ' + e.message };
        }
      });
    },

    getToken: function(kbPath) {
      return Promise.resolve().then(function() {
        var store = _ga_loadStore();
        var entry = store[kbPath];
        if (!entry || !entry.token) return null;
        try {
          if (entry.tokenEncrypted && safeStorage.isEncryptionAvailable()) {
            return safeStorage.decryptString(Buffer.from(entry.token, 'base64'));
          }
          return null;
        } catch (e) { return null; }
      });
    },

    setAuthType: function(kbPath, authType) {
      return Promise.resolve().then(function() {
        var store = _ga_loadStore();
        if (!store[kbPath]) store[kbPath] = {};
        store[kbPath].authType = authType;
        _ga_saveStore();
        return { ok: true };
      });
    },

    getAuthType: function(kbPath) {
      return Promise.resolve().then(function() {
        var store = _ga_loadStore();
        var entry = store[kbPath];
        return { ok: true, authType: entry ? (entry.authType || 'token') : 'token' };
      });
    },

    ensureSSHKey: function() {
      var privPath = nodePath.join(app.getPath('userData'), 'topomind-git-key');
      var pubPath = privPath + '.pub';
      if (nodeFs.existsSync(privPath) && nodeFs.existsSync(pubPath)) {
        return Promise.resolve({ privPath: privPath, pubPath: pubPath });
      }
      return new Promise(function(resolve, reject) {
        execFile('ssh-keygen', [
          '-t', 'ed25519',
          '-C', 'topomind-sync@' + os.hostname(),
          '-f', privPath,
          '-N', '',
        ], function(err) {
          if (err) reject(err);
          else resolve({ privPath: privPath, pubPath: pubPath });
        });
      });
    },

    getSSHPublicKey: function() {
      return gitAuth.ensureSSHKey()
        .then(function(nodePaths) {
          var pub = nodeFs.readFileSync(nodePaths.pubPath, 'utf-8').trim();
          return { ok: true, publicKey: pub };
        })
        .catch(function(e) { return { ok: false, error: e.message }; });
    },

    buildGitEnv: function(kbPath, remoteUrl) {
      return Promise.resolve().then(function() {
        if (!remoteUrl) return {};
        var isSSH = remoteUrl.startsWith('git@') || remoteUrl.startsWith('ssh://');
        var store = _ga_loadStore();
        var entry = store[kbPath] || {};
        var authType = entry.authType || (isSSH ? 'ssh' : 'token');
        if (authType === 'ssh' || isSSH) {
          return gitAuth.ensureSSHKey()
            .then(function(nodePaths) {
              return {
                GIT_SSH_COMMAND: 'ssh -i "' + nodePaths.privPath + '" -o StrictHostKeyChecking=accept-new -o BatchMode=yes',
              };
            })
            .catch(function() { return {}; });
        }
        return gitAuth.getToken(kbPath).then(function(token) {
          if (token) {
            return { GIT_ASKPASS: 'echo', GIT_USERNAME: 'oauth2', GIT_PASSWORD: token };
          }
          return {};
        });
      });
    },
  };
}

// Singleton instance — internal methods use this instead of re-creating via factory
const gitAuth = createGitAuth();

export { createGitAuth, gitAuth };
export default gitAuth;
