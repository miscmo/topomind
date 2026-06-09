import nodeFs from 'fs';
import nodePath from 'path';

export function createAttachmentService(deps) {
  const {
    attachmentDir,
    attachmentRefToPath,
    deleteTrashItem,
    ensureDir,
    extFromMime,
    listTrashItems,
    moveToTrash,
    readJsonFile,
    requireAttachmentSize,
    requirePublicHttpUrl,
    requireSafeOpenAttachment,
    requireValidWorkDir,
    resolveKbsPath,
    safeFileName,
    shell,
    uniqueFilePath,
    writeAttachmentBuffer,
    validateAbsolutePath,
    trashPathWithinDir,
  } = deps;

  return {
    listAttachments(rootDir, cardPath) {
      rootDir = requireValidWorkDir(rootDir);
      var cardDir = cardPath === '__ROOT__' ? rootDir : resolveKbsPath(rootDir, cardPath);
      var attachDir = nodePath.join(cardDir, '_attach');
      if (!nodeFs.existsSync(attachDir)) return [];
      return nodeFs.readdirSync(attachDir, { withFileTypes: true })
        .filter(function(entry) { return entry.isFile(); })
        .map(function(entry) {
          var ext = nodePath.extname(entry.name).slice(1).toLowerCase();
          var isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
          var stat = nodeFs.statSync(nodePath.join(attachDir, entry.name));
          return {
            name: entry.name,
            attachmentRef: '_attach/' + entry.name,
            isImage: isImage,
            size: stat.size,
            mtime: stat.mtimeMs
          };
        })
        .sort(function(a, b) { return b.mtime - a.mtime; });
    },

    importAttachment(rootDir, cardPath, sourceFilePath, targetFileName) {
      rootDir = requireValidWorkDir(rootDir);
      var sourcePath = validateAbsolutePath(sourceFilePath);
      if (!nodeFs.existsSync(sourcePath)) {
        throw new Error('源文件不存在: ' + sourcePath);
      }
      if (nodeFs.lstatSync(sourcePath).isSymbolicLink()) {
        throw new Error('不能导入符号链接文件');
      }
      var stat = nodeFs.statSync(sourcePath);
      if (!stat.isFile()) {
        throw new Error('只能导入文件');
      }
      requireAttachmentSize(stat.size);
      var fileName = targetFileName || nodePath.basename(sourcePath);
      var cardDir = cardPath === '__ROOT__' ? rootDir : resolveKbsPath(rootDir, cardPath);
      var attachDir = nodePath.join(cardDir, '_attach');
      ensureDir(attachDir);
      var target = uniqueFilePath(attachDir, fileName);
      nodeFs.copyFileSync(sourcePath, target);
      return '_attach/' + nodePath.basename(target);
    },

    deleteAttachment(rootDir, cardPath, attachmentName) {
      var filePath = attachmentRefToPath(rootDir, cardPath, attachmentName);
      moveToTrash(requireValidWorkDir(rootDir), filePath, 'attachments');
    },

    listTrashAttachments(rootDir, cardPath) {
      rootDir = requireValidWorkDir(rootDir);
      var attachDir = attachmentDir(rootDir, cardPath);
      var expectedOriginalDir = nodePath.relative(rootDir, attachDir).split(nodePath.sep).join('/');
      return listTrashItems(rootDir, 'attachments').filter(function(item) {
        return nodePath.dirname(item.originalPath).split(nodePath.sep).join('/') === expectedOriginalDir;
      });
    },

    restoreTrashAttachment(rootDir, cardPath, trashName) {
      rootDir = requireValidWorkDir(rootDir);
      var attachDir = attachmentDir(rootDir, cardPath);
      var allowed = this.listTrashAttachments(rootDir, cardPath).some(function(item) {
        return item.trashName === trashName;
      });
      if (!allowed) throw new Error('附件不属于当前文档回收站');
      var safeTrashName = nodePath.basename(String(trashName || '').trim());
      var trashDir = nodePath.join(rootDir, '.trash', 'attachments');
      var source = nodePath.resolve(trashDir, safeTrashName);
      if (!trashPathWithinDir(trashDir, source) || !nodeFs.existsSync(source)) {
        throw new Error('回收站附件不存在');
      }
      var meta = {};
      try {
        meta = readJsonFile(source + '.trash.json');
      } catch {}
      var fileName = safeFileName(meta.originalName || safeTrashName);
      ensureDir(attachDir);
      var target = uniqueFilePath(attachDir, fileName);
      nodeFs.copyFileSync(source, target);
      try {
        if (nodeFs.existsSync(source)) nodeFs.rmSync(source, { force: true });
        if (nodeFs.existsSync(source + '.trash.json')) nodeFs.rmSync(source + '.trash.json', { force: true });
      } catch {}
      return '_attach/' + nodePath.basename(target);
    },

    clearTrashAttachments(rootDir, cardPath) {
      rootDir = requireValidWorkDir(rootDir);
      var attachDir = attachmentDir(rootDir, cardPath);
      var expectedOriginalDir = nodePath.relative(rootDir, attachDir).split(nodePath.sep).join('/');
      listTrashItems(rootDir, 'attachments')
        .filter(function(item) {
          return nodePath.dirname(item.originalPath).split(nodePath.sep).join('/') === expectedOriginalDir;
        })
        .forEach(function(item) {
          deleteTrashItem(rootDir, 'attachments', item.trashName);
        });
    },

    async openAttachment(rootDir, cardPath, attachmentRef) {
      var filePath = attachmentRefToPath(rootDir, cardPath, attachmentRef);
      if (!nodeFs.existsSync(filePath)) return false;
      requireSafeOpenAttachment(filePath);
      var err = await shell.openPath(filePath);
      return err === '';
    },

    async showAttachmentInFolder(rootDir, cardPath, attachmentRef) {
      var filePath = attachmentRefToPath(rootDir, cardPath, attachmentRef);
      if (!nodeFs.existsSync(filePath)) return false;
      shell.showItemInFolder(filePath);
      return true;
    },

    writeAttachmentBase64(rootDir, cardPath, fileName, mimeType, base64) {
      var ext = extFromMime(mimeType);
      var safeName = safeFileName(fileName || ('image.' + ext));
      if (safeName.indexOf('.') < 0) safeName += '.' + ext;
      var buffer = Buffer.from(String(base64 || ''), 'base64');
      requireAttachmentSize(buffer.length);
      return writeAttachmentBuffer(rootDir, cardPath, safeName, buffer);
    },

    async downloadAttachment(rootDir, cardPath, url, targetFileName) {
      var parsedUrl = await requirePublicHttpUrl(String(url || '').trim());
      var abortController = new AbortController();
      var timeout = setTimeout(function() { abortController.abort(); }, deps.attachmentDownloadTimeoutMs);
      try {
        var response = await fetch(parsedUrl.href, { redirect: 'error', signal: abortController.signal });
        if (!response.ok) {
          throw new Error('下载失败: ' + response.status);
        }
        var mimeType = response.headers.get('content-type') || '';
        if (!/^image\//i.test(mimeType)) {
          throw new Error('链接不是图片: ' + mimeType);
        }
        var contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > 0) requireAttachmentSize(contentLength);
        var urlPath = parsedUrl.pathname;
        var fileName = targetFileName || nodePath.basename(urlPath) || ('image.' + extFromMime(mimeType));
        if (fileName.indexOf('.') < 0) fileName += '.' + extFromMime(mimeType);
        
        var buffer;
        if (response.body && response.body.getReader) {
          var reader = response.body.getReader();
          var chunks = [];
          var receivedLength = 0;
          while (true) {
            var { done, value } = await reader.read();
            if (done) break;
            if (value) {
              receivedLength += value.length;
              requireAttachmentSize(receivedLength);
              chunks.push(value);
            }
          }
          buffer = Buffer.concat(chunks);
        } else {
          var arrayBuffer = await response.arrayBuffer();
          buffer = Buffer.from(arrayBuffer);
          requireAttachmentSize(buffer.length);
        }
        
        return writeAttachmentBuffer(rootDir, cardPath, fileName, buffer);
      } finally {
        clearTimeout(timeout);
      }
    },

    readAttachmentDataUrl(rootDir, cardPath, attachmentRef) {
      var filePath = attachmentRefToPath(rootDir, cardPath, attachmentRef);
      if (!nodeFs.existsSync(filePath)) return '';
      requireAttachmentSize(nodeFs.statSync(filePath).size);
      var ext = nodePath.extname(filePath).slice(1).toLowerCase();
      var mimeMap = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp',
      };
      var mimeType = mimeMap[ext] || 'application/octet-stream';
      return 'data:' + mimeType + ';base64,' + nodeFs.readFileSync(filePath).toString('base64');
    },
  };
}
