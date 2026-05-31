import nodeFs from 'fs';
import nodePath from 'path';

export function createKbService(deps) {
  const {
    clearTrashItems,
    ensureDir,
    kbsDir,
    kbsTrashItemKind,
    listTrashItems,
    moveToTrash,
    relativeToKbs,
    requireSafeDirName,
    requireValidWorkDir,
    restoreTrashItem,
    safeSegment,
    uniqueFolderName,
    validateAbsolutePath,
  } = deps;

  return {
    listKBs(rootDir) {
      rootDir = requireValidWorkDir(rootDir);
      var dir = kbsDir(rootDir);
      var children = nodeFs.readdirSync(dir, { withFileTypes: true })
        .filter(function(e) { return e.isDirectory() && !e.name.startsWith('.') && e.name !== 'images'; })
        .map(function(e) {
          return { name: e.name };
        });
      children.sort(function(a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
      });
      return children;
    },

    listTrashKBs(rootDir) {
      return listTrashItems(rootDir, 'kbs').filter(function(item) {
        return kbsTrashItemKind(item) === 'kb';
      });
    },

    restoreTrashKB(rootDir, trashName) {
      rootDir = requireValidWorkDir(rootDir);
      var trashItem = listTrashItems(rootDir, 'kbs').find(function(item) {
        return item.trashName === trashName;
      });
      if (!trashItem || kbsTrashItemKind(trashItem) !== 'kb') {
        throw new Error('该回收站项目不是知识库，不能从首页恢复');
      }
      var restoredPath = restoreTrashItem(rootDir, 'kbs', trashName, kbsDir(rootDir));
      return nodePath.basename(restoredPath);
    },

    clearTrashKBs(rootDir) {
      rootDir = requireValidWorkDir(rootDir);
      clearTrashItems(rootDir, 'kbs');
    },

    createKbsDir(rootDir, kbName) {
      rootDir = requireValidWorkDir(rootDir);
      var finalName = requireSafeDirName(kbName, '知识库名称');
      var dir = nodePath.join(kbsDir(rootDir), finalName);
      if (nodeFs.existsSync(dir)) {
        throw new Error('目录已存在: ' + relativeToKbs(rootDir, dir));
      }
      ensureDir(dir);
    },

    deleteKbsDir(rootDir, dirPath) {
      rootDir = requireValidWorkDir(rootDir);
      if (!String(dirPath || '').trim()) {
        throw new Error('不能删除知识库根目录');
      }
      var dir = deps.resolveKbsPath(rootDir, dirPath);
      var normalizedPath = String(dirPath || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      var kind = normalizedPath.includes('/') ? 'card' : 'kb';
      moveToTrash(rootDir, dir, 'kbs', {
        kind: kind,
        kbsPath: normalizedPath,
      });
    },

    renameKB(rootDir, kbPath, newName) {
      rootDir = requireValidWorkDir(rootDir);
      var dir = deps.resolveKbsPath(rootDir, kbPath);
      if (!nodeFs.existsSync(dir)) return null;
      var parentDir = kbsDir(rootDir);
      var newSafeName = safeSegment(newName);
      var newDirName = uniqueFolderName(parentDir, newSafeName);
      var oldDirName = nodePath.basename(dir);
      var newDir = nodePath.join(parentDir, newDirName);
      if (oldDirName !== newDirName) {
        nodeFs.renameSync(dir, newDir);
      }
      return nodePath.relative(kbsDir(rootDir), newDir).split(nodePath.sep).join('/');
    },

    importKB(rootDir, sourcePath) {
      rootDir = requireValidWorkDir(rootDir);
      var src = validateAbsolutePath(sourcePath);
      var relToRoot = nodePath.relative(rootDir, src);
      if (relToRoot === '' || (!relToRoot.startsWith('..' + nodePath.sep) && relToRoot !== '..' && !nodePath.isAbsolute(relToRoot))) {
        throw new Error('不能从当前工作目录内部导入知识库');
      }
      if (!nodeFs.existsSync(src)) throw new Error('源目录不存在: ' + src);
      if (!nodeFs.statSync(src).isDirectory()) throw new Error('源路径不是目录');
      if (!nodeFs.existsSync(nodePath.join(src, '_graph.json'))) {
        throw new Error('不是有效的知识库目录');
      }
      var kbName = nodePath.basename(src);
      ensureDir(kbsDir(rootDir));
      var destName = uniqueFolderName(kbsDir(rootDir), kbName);
      var dest = nodePath.join(kbsDir(rootDir), destName);
      ensureDir(dest);

      function copyDirRecursive(srcDir, destDir) {
        ensureDir(destDir);
        var entries = nodeFs.readdirSync(srcDir, { withFileTypes: true });
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (entry.name === 'node_modules') continue;
          if (entry.isSymbolicLink()) continue;
          var srcEntry = nodePath.join(srcDir, entry.name);
          var destEntry = nodePath.join(destDir, entry.name);
          if (entry.isDirectory()) {
            copyDirRecursive(srcEntry, destEntry);
          } else {
            ensureDir(nodePath.dirname(destEntry));
            if (/\.(json|txt)$/i.test(entry.name)) {
              var text = nodeFs.readFileSync(srcEntry, 'utf-8');
              nodeFs.writeFileSync(destEntry, text, 'utf-8');
            } else {
              var data = nodeFs.readFileSync(srcEntry);
              nodeFs.writeFileSync(destEntry, data);
            }
          }
        }
      }

      try {
        copyDirRecursive(src, dest);
      } catch (e) {
        try {
          if (nodeFs.existsSync(dest)) nodeFs.rmSync(dest, { recursive: true, force: true });
        } catch {}
        throw e;
      }

      return nodePath.relative(kbsDir(rootDir), dest).split(nodePath.sep).join('/');
    },
  };
}
