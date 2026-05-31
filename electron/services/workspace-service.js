import nodeFs from 'fs';
import nodePath from 'path';
import {
  appConfigPath,
  isValidWorkDir as validateWorkDirStructure,
  kbsDir,
  logsDir,
  validateAbsolutePath,
} from './path-guard.js';

function ensureDir(dirPath) {
  if (!nodeFs.existsSync(dirPath)) {
    nodeFs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJsonFile(filePath, data) {
  ensureDir(nodePath.dirname(filePath));
  var tempPath = filePath + '.tmp-' + process.pid + '-' + Date.now();
  var fd = null;
  try {
    fd = nodeFs.openSync(tempPath, 'w');
    nodeFs.writeFileSync(fd, JSON.stringify(data || {}, null, 2), 'utf-8');
    nodeFs.fsyncSync(fd);
    nodeFs.closeSync(fd);
    fd = null;
    nodeFs.renameSync(tempPath, filePath);
  } catch (e) {
    if (fd !== null) {
      try {
        nodeFs.closeSync(fd);
      } catch {}
    }
    try {
      if (nodeFs.existsSync(tempPath)) nodeFs.rmSync(tempPath, { force: true });
    } catch {}
    throw e;
  }
}

function isDirEmpty(dirPath) {
  try {
    if (!nodeFs.existsSync(dirPath)) return true;
    return nodeFs.readdirSync(dirPath).length === 0;
  } catch {
    return false;
  }
}

export function createWorkDir(dirPath) {
  var dir = dirPath || null;
  try {
    if (!dir) {
      return { valid: false, nodePath: null, error: '工作目录路径为空' };
    }
    dir = validateAbsolutePath(dir);
    if (nodeFs.existsSync(dir) && !isDirEmpty(dir)) {
      return { valid: false, nodePath: dir, error: '工作目录必须是空目录' };
    }
    ensureDir(dir);
    ensureDir(kbsDir(dir));
    ensureDir(logsDir(dir));
    writeJsonFile(appConfigPath(dir), {});
    return { valid: true, nodePath: dir };
  } catch (e) {
    return { valid: false, nodePath: dir, error: e && e.message ? e.message : '创建工作目录失败' };
  }
}

export function isValidWorkDir(dirPath) {
  var dir = dirPath;
  if (!dir) {
    return { valid: false, nodePath: null, error: '工作目录路径为空' };
  }
  dir = validateAbsolutePath(dir);
  var validation = validateWorkDirStructure(dir);
  if (!validation.valid) {
    return { valid: false, nodePath: dir, error: validation.error || '不是有效的工作目录' };
  }
  return { valid: true, nodePath: dir };
}
