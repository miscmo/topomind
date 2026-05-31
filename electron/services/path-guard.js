import nodePath from 'path';
import nodeFs from 'fs';

export function kbsDir(dir) {
  return nodePath.join(dir, 'kbs');
}

export function logsDir(dir) {
  return nodePath.join(dir, 'logs');
}

export function appConfigPath(dir) {
  return nodePath.join(dir, '_config.json');
}

export function validateAbsolutePath(dir) {
  if (typeof dir !== 'string' || !dir.trim() || /[\x00-\x1F\x7F]/.test(dir)) {
    throw new Error('路径无效');
  }
  if (!nodePath.isAbsolute(dir)) {
    throw new Error('路径必须是绝对路径');
  }
  return nodePath.resolve(dir);
}

export function isValidWorkDir(dirPath) {
  try {
    if (!dirPath) return { valid: false, error: '工作目录路径为空' };
    if (!nodeFs.existsSync(dirPath)) return { valid: false, error: '工作目录不存在' };
    if (!nodeFs.statSync(dirPath).isDirectory()) return { valid: false, error: '工作目录路径不是文件夹' };
    if (!nodeFs.existsSync(appConfigPath(dirPath))) return { valid: false, error: '缺少工作目录配置文件 _config.json' };
    if (!nodeFs.existsSync(kbsDir(dirPath))) return { valid: false, error: '缺少知识库目录 kbs' };
    if (!nodeFs.existsSync(logsDir(dirPath))) return { valid: false, error: '缺少日志目录 logs' };
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e && e.message ? e.message : '工作目录校验失败' };
  }
}

export function requireValidWorkDir(rootDir) {
  var dir = validateAbsolutePath(rootDir);
  var validation = isValidWorkDir(dir);
  if (!validation.valid) {
    throw new Error(validation.error || '不是有效的工作目录');
  }
  return dir;
}
