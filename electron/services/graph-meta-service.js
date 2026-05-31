export function createGraphMetaService(deps) {
  const {
    ensureDir,
    graphFilePath,
    readJsonFile,
    requireValidWorkDir,
    resolveKbsPath,
    writeJsonFile,
  } = deps;

  return {
    readGraphMeta(rootDir, roomPath) {
      rootDir = requireValidWorkDir(rootDir);
      var dir = resolveKbsPath(rootDir, roomPath);
      return readJsonFile(graphFilePath(dir));
    },

    writeGraphMeta(rootDir, roomPath, meta) {
      rootDir = requireValidWorkDir(rootDir);
      var dir = resolveKbsPath(rootDir, roomPath);
      ensureDir(dir);
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        throw new Error('writeGraphMeta: meta 必须是普通对象');
      }
      writeJsonFile(graphFilePath(dir), meta);
    },
  };
}
