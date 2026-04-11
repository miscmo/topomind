/**
 * 统一存储适配器（Electron 桌面端专用）
 * 业务层只调用 Store.xxx()
 */
var Store = (function() {
  var _saveTimer = null;

  function init() {
    console.log('[Store] 初始化 FSB 后端');
    return FSB.open().then(function(r) {
      console.log('[Store] 初始化完成:', r);
      return r;
    });
  }

  function be() { return FSB; }

  // ===== 知识库（根级目录） =====
  function listKBs() { return be().listChildren(''); }

  function createKB(name, meta) {
    var fullMeta = Object.assign({ name: name, createdAt: Date.now(), children: {}, edges: [] }, meta || {});
    var rootDir = (meta && meta.rootDir) || '';
    // 如果有自定义目录，在 meta 中移除 rootDir（不应存储到 _meta.json）
    var metaToSave = Object.assign({}, fullMeta);
    delete metaToSave.rootDir;
    return be().mkDir(name, metaToSave, rootDir);
  }

  function deleteKB(name) { return be().rmDir(name); }
  function getKBMeta(name) { return be().readMeta(name); }
  function saveKBMeta(name, meta) { return be().writeMeta(name, meta); }

  // ===== 卡片（子目录） =====
  function listCards(parentPath) { return be().listChildren(parentPath); }

  function createCard(parentPath, cardName) {
    var cardPath = parentPath ? parentPath + '/' + cardName : cardName;
    var fullMeta = { name: cardName, createdAt: Date.now(), children: {}, edges: [] };
    return be().mkDir(cardPath, fullMeta).then(function() { return cardPath; });
  }

  function deleteCard(cardPath) { return be().rmDir(cardPath); }

  function renameCard(cardPath, newName) {
    return be().getDir(cardPath).then(function(dir) {
      if (!dir) return;
      dir.name = newName;
      return be().mkDir(cardPath, dir);
    });
  }

  // ===== Markdown 文档 =====
  function readMarkdown(cardPath) { return be().readFile(cardPath + '/README.md'); }
  function writeMarkdown(cardPath, content) { return be().writeFile(cardPath + '/README.md', content); }

  // ===== 关系和布局 =====
  function readLayout(dirPath) { return be().readMeta(dirPath); }
  function saveLayout(dirPath, meta) { return be().writeMeta(dirPath, meta); }

  function saveGraphDebounced(dirPath, buildMetaFn) {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function() {
      var meta = buildMetaFn();
      saveLayout(dirPath, meta).then(showSaveIndicator);
    }, 300);
  }

  // ===== 图片 =====
  function saveImage(cardPath, blob, filename) {
    var imgPath = cardPath + '/images/' + filename;
    return be().writeBlobFile(imgPath, blob).then(function() {
      return { path: imgPath, markdownRef: 'images/' + filename };
    });
  }

  function loadImage(imgPath) {
    return be().readBlobFile(imgPath).then(function(blob) {
      return blob ? URL.createObjectURL(blob) : '';
    });
  }

  // ===== 工具 =====
  function clearAll() { return be().clearAll(); }

  function showSaveIndicator() {
    var el = document.getElementById('save-indicator');
    if (!el) return;
    el.classList.add('visible');
    setTimeout(function() { el.classList.remove('visible'); }, 1200);
  }

  return {
    init: init,
    listKBs: listKBs, createKB: createKB, deleteKB: deleteKB,
    getKBMeta: getKBMeta, saveKBMeta: saveKBMeta,
    listCards: listCards, createCard: createCard, deleteCard: deleteCard, renameCard: renameCard,
    readMarkdown: readMarkdown, writeMarkdown: writeMarkdown,
    readLayout: readLayout, saveLayout: saveLayout, saveGraphDebounced: saveGraphDebounced,
    saveImage: saveImage, loadImage: loadImage,
    selectDir: function() { return be().selectDir(); },
    openInFinder: function(p) { return be().openInFinder(p); },
    countChildren: function(p) { return be().countChildren(p); },
    getRootDir: function() { return be().getRootDir(); },
    clearAll: clearAll, showSaveIndicator: showSaveIndicator
  };
})();
