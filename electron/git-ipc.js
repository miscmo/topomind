/**
 * Git IPC Handler 注册
 * 所有 git:xxx 通道在此注册
 */
const path = require('path');
const git = require('./git-service');
const auth = require('./git-auth');

function registerGitIPC(ipcMain, getFileService) {
  // 将相对路径转为绝对路径
  function absPath(relPath) {
    var rootDir = getFileService().getRootDir();
    if (!relPath) return rootDir;
    return path.resolve(rootDir, relPath);
  }

  // ===== 基础 =====

  ipcMain.handle('git:checkAvailable', async function() {
    var available = await git.checkGitAvailable();
    return { ok: true, available: available };
  });

  ipcMain.handle('git:init', async function(e, kbPath) {
    return git.initRepo(absPath(kbPath));
  });

  // ===== 状态 =====

  ipcMain.handle('git:status', async function(e, kbPath) {
    return git.getStatus(absPath(kbPath));
  });

  ipcMain.handle('git:statusBatch', async function(e, kbPaths) {
    var absPaths = (kbPaths || []).map(function(p) { return absPath(p); });
    var results = await git.getStatusBatch(absPaths);
    // 将 key 从绝对路径还原为相对路径
    var out = {};
    kbPaths.forEach(function(rel, i) {
      out[rel] = results[absPaths[i]] || { state: 'uninit', ahead: 0, behind: 0 };
    });
    return out;
  });

  ipcMain.handle('git:isDirty', async function(e, kbPath) {
    var dirty = await git.isDirty(absPath(kbPath));
    return { ok: true, dirty: dirty };
  });

  // ===== 提交 =====

  ipcMain.handle('git:commit', async function(e, kbPath, message) {
    return git.commit(absPath(kbPath), message);
  });

  // ===== Diff / Log =====

  ipcMain.handle('git:diff', async function(e, kbPath, opts) {
    return git.getDiff(absPath(kbPath), opts);
  });

  ipcMain.handle('git:diffFiles', async function(e, kbPath, opts) {
    return git.getDiffFiles(absPath(kbPath), opts);
  });

  ipcMain.handle('git:log', async function(e, kbPath, opts) {
    return git.getLog(absPath(kbPath), opts);
  });

  ipcMain.handle('git:commitDiffFiles', async function(e, kbPath, hash) {
    return git.getCommitDiffFiles(absPath(kbPath), hash);
  });

  ipcMain.handle('git:commitFileDiff', async function(e, kbPath, hash, filePath) {
    return git.getCommitFileDiff(absPath(kbPath), hash, filePath);
  });

  // ===== 远程仓库 =====

  ipcMain.handle('git:remote:get', async function(e, kbPath) {
    return git.getRemote(absPath(kbPath));
  });

  ipcMain.handle('git:remote:set', async function(e, kbPath, url) {
    return git.setRemote(absPath(kbPath), url);
  });

  ipcMain.handle('git:fetch', async function(e, kbPath) {
    var env = await auth.buildGitEnv(kbPath, await _getRemoteUrl(kbPath, absPath));
    return git.fetchRemote(absPath(kbPath), env);
  });

  ipcMain.handle('git:push', async function(e, kbPath) {
    var env = await auth.buildGitEnv(kbPath, await _getRemoteUrl(kbPath, absPath));
    return git.push(absPath(kbPath), env);
  });

  ipcMain.handle('git:pull', async function(e, kbPath) {
    var env = await auth.buildGitEnv(kbPath, await _getRemoteUrl(kbPath, absPath));
    return git.pull(absPath(kbPath), env);
  });

  // ===== 冲突 =====

  ipcMain.handle('git:conflict:list', async function(e, kbPath) {
    return git.getConflictList(absPath(kbPath));
  });

  ipcMain.handle('git:conflict:show', async function(e, kbPath, filePath) {
    var result = await git.getConflictContent(absPath(kbPath), filePath);
    // 如果是 _meta.json 且非二进制，尝试自动合并
    if (result.ok && !result.isBinary && filePath.endsWith('_meta.json')) {
      var autoMerge = git.autoMergeMetaJson(result.ours, result.theirs);
      result.autoMerge = autoMerge.ok ? autoMerge.merged : null;
    }
    return result;
  });

  ipcMain.handle('git:conflict:resolve', async function(e, kbPath, filePath, content) {
    return git.resolveConflict(absPath(kbPath), filePath, content);
  });

  ipcMain.handle('git:conflict:complete', async function(e, kbPath) {
    return git.completeConflictResolution(absPath(kbPath));
  });

  // ===== 认证 =====

  ipcMain.handle('git:auth:setToken', async function(e, kbPath, token) {
    return auth.saveToken(kbPath, token);
  });

  ipcMain.handle('git:auth:getSSHKey', async function() {
    return auth.getSSHPublicKey();
  });

  ipcMain.handle('git:auth:setAuthType', async function(e, kbPath, authType) {
    return auth.setAuthType(kbPath, authType);
  });

  ipcMain.handle('git:auth:getAuthType', async function(e, kbPath) {
    return auth.getAuthType(kbPath);
  });
}

async function _getRemoteUrl(kbPath, absPathFn) {
  try {
    var result = await git.getRemote(absPathFn(kbPath));
    return result.url || '';
  } catch (e) {
    return '';
  }
}

module.exports = { registerGitIPC: registerGitIPC };
