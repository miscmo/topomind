import nodeFs from 'fs';
import nodePath from 'path';

export function createCardService(deps) {
  const {
    ensureDir,
    graphFilePath,
    readJsonFile,
    relativeToKbs,
    requireValidWorkDir,
    resolveKbsPath,
    safeSegment,
    writeJsonFile,
  } = deps;

  return {
    readCardChildren(rootDir, cardPath) {
      rootDir = requireValidWorkDir(rootDir);
      var dir = resolveKbsPath(rootDir, cardPath);
      var parentGraph = readJsonFile(graphFilePath(dir));
      return parentGraph.children || {};
    },

    createCardDir(rootDir, parentPath, cardName) {
      rootDir = requireValidWorkDir(rootDir);
      var parent = resolveKbsPath(rootDir, parentPath);
      if (!nodeFs.existsSync(parent)) {
        throw new Error('父目录不存在: ' + String(parentPath || ''));
      }
      var finalName = safeSegment(cardName);
      if (!String(cardName || '').trim()) {
        throw new Error('卡片名称不能为空');
      }
      var dir = nodePath.join(parent, finalName);
      if (nodeFs.existsSync(dir)) {
        throw new Error('目录已存在: ' + relativeToKbs(rootDir, dir));
      }
      ensureDir(dir);
      writeJsonFile(graphFilePath(dir), {});
      return relativeToKbs(rootDir, dir);
    },
  };
}
