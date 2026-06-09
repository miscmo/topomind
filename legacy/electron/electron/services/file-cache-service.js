import nodeFs from 'fs';
import nodePath from 'path';

const CACHE_DIR_NAMES = ['attachments', 'previews', 'exports', 'temp'];

export function createFileCacheService(options = {}) {
  const getUserDataPath =
    typeof options.getUserDataPath === 'function'
      ? options.getUserDataPath
      : () => {
          throw new Error('getUserDataPath is required');
        };

  function getPaths() {
    const rootDir = nodePath.join(getUserDataPath(), 'cache');
    return {
      rootDir,
      attachmentsDir: nodePath.join(rootDir, 'attachments'),
      previewsDir: nodePath.join(rootDir, 'previews'),
      exportsDir: nodePath.join(rootDir, 'exports'),
      tempDir: nodePath.join(rootDir, 'temp'),
    };
  }

  function ensureReady() {
    const paths = getPaths();

    nodeFs.mkdirSync(paths.rootDir, { recursive: true });
    for (const dirName of CACHE_DIR_NAMES) {
      nodeFs.mkdirSync(nodePath.join(paths.rootDir, dirName), { recursive: true });
    }

    return healthCheck();
  }

  function healthCheck() {
    const paths = getPaths();
    const directories = Object.entries(paths).map(([key, value]) => ({
      key,
      directoryPath: value,
      exists: nodeFs.existsSync(value),
    }));

    return {
      ready: directories.every((entry) => entry.exists),
      paths,
      directories,
    };
  }

  return {
    getPaths,
    ensureReady,
    healthCheck,
  };
}
