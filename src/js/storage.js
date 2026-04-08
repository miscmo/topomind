/**
 * 混合存储引擎：
 *   Electron 模式 → Node.js fs（通过 IPC）+ IndexedDB
 *   Web 模式     → File System Access API + IndexedDB
 *   降级模式     → 纯 IndexedDB
 */

var isElectron = !!(window.electronAPI && window.electronAPI.isElectron);
var DB_NAME = 'topomind-db';
var DB_VERSION = 1;
var db = null; // IndexedDB 实例

// File System Access（仅 Web 模式）
var supportsFS = !isElectron && !!window.showDirectoryPicker;
var workDirHandle = null;
var docsDirHandle = null;
var imagesDirHandle = null;

// 保存防抖
var _saveGraphTimer = null;

// ===================== IndexedDB 初始化 =====================

function initDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function(e) {
      var d = e.target.result;
      if (!d.objectStoreNames.contains('nodes')) d.createObjectStore('nodes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('edges')) d.createObjectStore('edges', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('markdown')) d.createObjectStore('markdown', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('images')) d.createObjectStore('images', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('knowledgebases')) d.createObjectStore('knowledgebases', { keyPath: 'id' });
    };
    req.onsuccess = function(e) { db = e.target.result; resolve(db); };
    req.onerror = function(e) { reject(e.target.error); };
  });
}

// ===================== IndexedDB 通用操作 =====================

function dbPut(store, data) {
  return new Promise(function(resolve, reject) {
    var tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(data);
    tx.oncomplete = resolve;
    tx.onerror = function() { reject(tx.error); };
  });
}

function dbGet(store, key) {
  return new Promise(function(resolve, reject) {
    var tx = db.transaction(store, 'readonly');
    var req = tx.objectStore(store).get(key);
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}

function dbDelete(store, key) {
  return new Promise(function(resolve, reject) {
    var tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = function() { reject(tx.error); };
  });
}

function dbGetAll(store) {
  return new Promise(function(resolve, reject) {
    var tx = db.transaction(store, 'readonly');
    var req = tx.objectStore(store).getAll();
    req.onsuccess = function() { resolve(req.result || []); };
    req.onerror = function() { reject(req.error); };
  });
}

function dbClear(store) {
  return new Promise(function(resolve, reject) {
    var tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = resolve;
    tx.onerror = function() { reject(tx.error); };
  });
}

function dbPutBatch(store, items) {
  return new Promise(function(resolve, reject) {
    var tx = db.transaction(store, 'readwrite');
    var os = tx.objectStore(store);
    items.forEach(function(item) { os.put(item); });
    tx.oncomplete = resolve;
    tx.onerror = function() { reject(tx.error); };
  });
}

// ===================== 图结构保存（节点/边/颜色/视野） =====================

function saveGraphState() {
  clearTimeout(_saveGraphTimer);
  _saveGraphTimer = setTimeout(function() {
    _doSaveGraph();
  }, 300);
}

function _doSaveGraph() {
  if (!db) return;
  try {
    // 节点
    var nodes = cy.nodes().map(function(n) {
      return { id: n.id(), label: n.data('label'), level: n.data('level'), parent: n.data('parent') || '', posX: n.position().x, posY: n.position().y };
    });
    // 边
    var edges = cy.edges().map(function(e) {
      return { id: e.id(), source: e.source().id(), target: e.target().id(), relation: e.data('relation'), weight: e.data('weight') };
    });

    var tx = db.transaction(['nodes', 'edges', 'meta'], 'readwrite');
    // 清空再写入（批量更新）
    tx.objectStore('nodes').clear();
    nodes.forEach(function(n) { tx.objectStore('nodes').put(n); });
    tx.objectStore('edges').clear();
    edges.forEach(function(e) { tx.objectStore('edges').put(e); });
    // 颜色和视野存 meta
    tx.objectStore('meta').put({ key: 'colors', value: Object.assign({}, DOMAIN_COLORS) });
    tx.objectStore('meta').put({ key: 'view', value: { zoom: cy.zoom(), pan: cy.pan(), currentRoom: currentRoom, roomHistory: roomHistory.slice() } });

    tx.oncomplete = function() { showSaveIndicator(); };
  } catch (e) { /* 静默 */ }
}

// ===================== Markdown 读写 =====================

/** 读取 Markdown：Electron → IPC，Web → 本地文件/IndexedDB */
function loadMarkdown(nodeId) {
  if (isElectron) {
    return window.electronAPI.readMarkdown(nodeId);
  }
  if (supportsFS && docsDirHandle) {
    return _readFileFromDir(docsDirHandle, nodeId + '.md').catch(function() {
      return dbGet('markdown', nodeId).then(function(r) { return r ? r.content : ''; });
    });
  }
  return dbGet('markdown', nodeId).then(function(r) { return r ? r.content : ''; });
}

/** 保存 Markdown：Electron → IPC + IndexedDB，Web → 本地文件 + IndexedDB */
function saveMarkdown(nodeId, content) {
  // IndexedDB 始终写
  var p1 = dbPut('markdown', { id: nodeId, content: content, updatedAt: Date.now() });
  // Electron：通过 IPC 写文件
  var p2 = Promise.resolve();
  if (isElectron) {
    p2 = window.electronAPI.writeMarkdown(nodeId, content).catch(function() {});
  } else if (supportsFS && docsDirHandle) {
    p2 = _writeFileToDir(docsDirHandle, nodeId + '.md', content).catch(function() {});
  }
  return Promise.all([p1, p2]).then(function() { showSaveIndicator(); });
}

/** 删除 Markdown */
function deleteMarkdown(nodeId) {
  var p1 = dbDelete('markdown', nodeId);
  var p2 = Promise.resolve();
  if (isElectron) {
    p2 = window.electronAPI.deleteMarkdown(nodeId).catch(function() {});
  } else if (supportsFS && docsDirHandle) {
    p2 = docsDirHandle.removeEntry(nodeId + '.md').catch(function() {});
  }
  return Promise.all([p1, p2]);
}

// ===================== 图片读写 =====================

/** 保存图片，返回图片 ID */
function saveImage(nodeId, blob, filename) {
  var ext = filename.split('.').pop() || 'png';
  var imgId = 'img-' + autoId('i');
  var imgFilename = imgId + '.' + ext;

  // 压缩（如果是图片且较大）
  var processedBlob = (blob.size > 500 * 1024) ? compressImage(blob) : Promise.resolve(blob);

  return processedBlob.then(function(finalBlob) {
    // IndexedDB 存索引
    var record = { id: imgId, nodeId: nodeId, filename: imgFilename, mime: blob.type, size: finalBlob.size, createdAt: Date.now() };
    if (!isElectron && !supportsFS) {
      record.blob = finalBlob; // 纯 IndexedDB 降级模式
    }
    var p1 = dbPut('images', record);

    // 写文件
    var p2 = Promise.resolve();
    if (isElectron) {
      p2 = finalBlob.arrayBuffer().then(function(ab) {
        return window.electronAPI.writeImage(imgFilename, ab);
      }).catch(function() {});
    } else if (supportsFS && imagesDirHandle) {
      p2 = _writeBlobToDir(imagesDirHandle, imgFilename, finalBlob).catch(function() {});
    }

    return Promise.all([p1, p2]).then(function() {
      return { id: imgId, filename: imgFilename, markdownRef: 'images/' + imgFilename };
    });
  });
}

/** 读取图片 Blob，返回 ObjectURL */
function loadImageUrl(imgIdOrFilename) {
  var imgId = imgIdOrFilename.replace(/\.\w+$/, '');

  if (isElectron) {
    return dbGet('images', imgId).then(function(record) {
      if (!record) return '';
      return window.electronAPI.readImage(record.filename).then(function(ab) {
        if (!ab) return '';
        var blob = new Blob([ab], { type: record.mime || 'image/png' });
        return URL.createObjectURL(blob);
      });
    }).catch(function() { return ''; });
  }

  if (supportsFS && imagesDirHandle) {
    return dbGet('images', imgId).then(function(record) {
      if (!record) return '';
      return _readBlobFromDir(imagesDirHandle, record.filename).then(function(blob) {
        return URL.createObjectURL(blob);
      });
    }).catch(function() { return ''; });
  }
  // 降级：从 IndexedDB 取 Blob
  return dbGet('images', imgId).then(function(record) {
    if (!record || !record.blob) return '';
    return URL.createObjectURL(record.blob);
  }).catch(function() { return ''; });
}

/** 删除节点关联的所有图片 */
function deleteNodeImages(nodeId) {
  return dbGetAll('images').then(function(all) {
    var tasks = [];
    all.forEach(function(img) {
      if (img.nodeId === nodeId) {
        tasks.push(dbDelete('images', img.id));
        if (isElectron) {
          tasks.push(window.electronAPI.deleteImage(img.filename).catch(function() {}));
        } else if (supportsFS && imagesDirHandle) {
          tasks.push(imagesDirHandle.removeEntry(img.filename).catch(function() {}));
        }
      }
    });
    return Promise.all(tasks);
  });
}

/** 图片压缩（Canvas 缩放 + 质量压缩） */
function compressImage(blob) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var maxW = 1920, maxH = 1920;
      var w = img.width, h = img.height;
      if (w > maxW || h > maxH) {
        var ratio = Math.min(maxW / w, maxH / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(function(result) {
        URL.revokeObjectURL(img.src);
        resolve(result || blob);
      }, 'image/webp', 0.85);
    };
    img.onerror = function() { resolve(blob); };
    img.src = URL.createObjectURL(blob);
  });
}

// ===================== 本地文件系统操作 =====================

function _readFileFromDir(dirHandle, filename) {
  return dirHandle.getFileHandle(filename).then(function(fh) {
    return fh.getFile();
  }).then(function(file) {
    return file.text();
  });
}

function _writeFileToDir(dirHandle, filename, content) {
  return dirHandle.getFileHandle(filename, { create: true }).then(function(fh) {
    return fh.createWritable();
  }).then(function(writable) {
    return writable.write(content).then(function() { return writable.close(); });
  });
}

function _writeBlobToDir(dirHandle, filename, blob) {
  return dirHandle.getFileHandle(filename, { create: true }).then(function(fh) {
    return fh.createWritable();
  }).then(function(writable) {
    return writable.write(blob).then(function() { return writable.close(); });
  });
}

function _readBlobFromDir(dirHandle, filename) {
  return dirHandle.getFileHandle(filename).then(function(fh) {
    return fh.getFile();
  });
}

// ===================== 工作目录管理 =====================

/** 选择/创建工作目录 */
function pickWorkDirectory() {
  if (!supportsFS) return Promise.reject(new Error('不支持 File System Access API'));
  return window.showDirectoryPicker({ mode: 'readwrite' }).then(function(dirHandle) {
    return _initWorkDir(dirHandle);
  });
}

function _initWorkDir(dirHandle) {
  workDirHandle = dirHandle;
  return Promise.all([
    dirHandle.getDirectoryHandle('docs', { create: true }),
    dirHandle.getDirectoryHandle('images', { create: true })
  ]).then(function(dirs) {
    docsDirHandle = dirs[0];
    imagesDirHandle = dirs[1];
    // 存储 handle 到 IndexedDB 以便下次自动恢复
    return dbPut('meta', { key: 'workDirHandle', value: dirHandle });
  }).then(function() {
    return dirHandle;
  });
}

/** 尝试恢复上次的工作目录 */
function tryRestoreWorkDir() {
  if (!supportsFS) return Promise.resolve(false);
  return dbGet('meta', 'workDirHandle').then(function(record) {
    if (!record || !record.value) return false;
    var handle = record.value;
    // 检查权限
    return handle.queryPermission({ mode: 'readwrite' }).then(function(perm) {
      if (perm === 'granted') return _initWorkDir(handle).then(function() { return true; });
      // 需要重新授权
      return handle.requestPermission({ mode: 'readwrite' }).then(function(perm2) {
        if (perm2 === 'granted') return _initWorkDir(handle).then(function() { return true; });
        return false;
      });
    });
  }).catch(function() { return false; });
}

/** 获取工作目录状态信息 */
function getStorageInfo() {
  var info = {};
  if (isElectron) {
    info.mode = 'electron';
    return window.electronAPI.getWorkDir().then(function(dir) {
      info.dirName = dir;
      return Promise.all([
        dbGetAll('nodes').then(function(r) { info.nodeCount = r.length; }),
        dbGetAll('edges').then(function(r) { info.edgeCount = r.length; }),
        dbGetAll('markdown').then(function(r) { info.docCount = r.length; }),
        dbGetAll('images').then(function(r) { info.imageCount = r.length; info.imageSize = r.reduce(function(s, i) { return s + (i.size || 0); }, 0); })
      ]).then(function() { return info; });
    });
  }
  info.mode = supportsFS && workDirHandle ? 'hybrid' : 'indexeddb';
  if (workDirHandle) info.dirName = workDirHandle.name;
  return Promise.all([
    dbGetAll('nodes').then(function(r) { info.nodeCount = r.length; }),
    dbGetAll('edges').then(function(r) { info.edgeCount = r.length; }),
    dbGetAll('markdown').then(function(r) { info.docCount = r.length; }),
    dbGetAll('images').then(function(r) { info.imageCount = r.length; info.imageSize = r.reduce(function(s, i) { return s + (i.size || 0); }, 0); })
  ]).then(function() { return info; });
}

// ===================== 全量加载/保存（启动和迁移用） =====================

/** 从 IndexedDB 加载全部图结构到 Cytoscape */
function loadGraphFromDB() {
  return Promise.all([
    dbGetAll('nodes'),
    dbGetAll('edges'),
    dbGet('meta', 'colors'),
    dbGet('meta', 'view')
  ]).then(function(results) {
    var nodes = results[0], edges = results[1], colorsMeta = results[2], viewMeta = results[3];
    if (!nodes.length) return false;

    cy.elements().remove();
    Object.keys(MD).forEach(function(k) { delete MD[k]; });

    if (colorsMeta && colorsMeta.value) Object.assign(DOMAIN_COLORS, colorsMeta.value);

    nodes.forEach(function(n) {
      var data = { id: n.id, label: n.label, level: n.level };
      if (n.parent) data.parent = n.parent;
      var ele = cy.add({ group: 'nodes', data: data, classes: 'card' });
      if (n.posX !== undefined && n.posY !== undefined) ele.position({ x: n.posX, y: n.posY });
    });

    edges.forEach(function(e) {
      cy.add({ group: 'edges', data: { id: e.id, source: e.source, target: e.target, relation: e.relation, weight: e.weight } });
    });

    // 预加载全部 Markdown 到 MD 对象（轻量模式，后续可改为懒加载）
    return dbGetAll('markdown').then(function(docs) {
      docs.forEach(function(d) { MD[d.id] = d.content; });
      if (viewMeta && viewMeta.value) {
        currentRoom = viewMeta.value.currentRoom || null;
        roomHistory = viewMeta.value.roomHistory || [];
      }
      return true;
    });
  });
}

/** 将默认数据写入 IndexedDB（首次启动） */
function seedDefaultData() {
  var nodes = graphNodes.map(function(n) {
    return { id: n.data.id, label: n.data.label, level: n.data.level, parent: n.data.parent || '', posX: 0, posY: 0 };
  });
  var edges = graphEdges.map(function(e) {
    return { id: e.data.id, source: e.data.source, target: e.data.target, relation: e.data.relation, weight: e.data.weight };
  });
  var docs = Object.keys(MD).map(function(k) {
    return { id: k, content: MD[k], updatedAt: Date.now() };
  });

  return Promise.all([
    dbPutBatch('nodes', nodes),
    dbPutBatch('edges', edges),
    dbPutBatch('markdown', docs),
    dbPut('meta', { key: 'colors', value: Object.assign({}, DOMAIN_COLORS) }),
    dbPut('meta', { key: 'view', value: { zoom: 1, pan: { x: 0, y: 0 }, currentRoom: null, roomHistory: [] } })
  ]);
}

/** 同步 Markdown 到本地文件 */
function syncMarkdownToFiles() {
  if (isElectron) {
    return dbGetAll('markdown').then(function(docs) {
      var tasks = docs.map(function(d) {
        return window.electronAPI.writeMarkdown(d.id, d.content).catch(function() {});
      });
      return Promise.all(tasks);
    });
  }
  if (!supportsFS || !docsDirHandle) return Promise.resolve();
  return dbGetAll('markdown').then(function(docs) {
    var tasks = docs.map(function(d) {
      return _writeFileToDir(docsDirHandle, d.id + '.md', d.content).catch(function() {});
    });
    return Promise.all(tasks);
  });
}

/** 从工作目录扫描并导入（选择已有工作目录时） */
function importFromWorkDir() {
  if (!supportsFS || !docsDirHandle) return Promise.resolve();
  return _scanDir(docsDirHandle, '.md').then(function(files) {
    var tasks = files.map(function(f) {
      var nodeId = f.name.replace(/\.md$/, '');
      return f.handle.getFile().then(function(file) { return file.text(); }).then(function(content) {
        MD[nodeId] = content;
        return dbPut('markdown', { id: nodeId, content: content, updatedAt: Date.now() });
      });
    });
    return Promise.all(tasks);
  });
}

function _scanDir(dirHandle, ext) {
  var files = [];
  return (async function() {
    for await (var entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith(ext)) {
        files.push({ name: entry.name, handle: entry });
      }
    }
    return files;
  })();
}

// ===================== 迁移：localStorage → IndexedDB =====================

function migrateFromLocalStorage() {
  var STORAGE_KEY = 'topomind-save-v1';
  var raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return Promise.resolve(false);

  try {
    var state = JSON.parse(raw);
    if (!state.nodes || !state.nodes.length) return Promise.resolve(false);

    var nodes = state.nodes.map(function(n) {
      return { id: n.data.id, label: n.data.label, level: n.data.level, parent: n.data.parent || '', posX: (n.position && n.position.x) || 0, posY: (n.position && n.position.y) || 0 };
    });
    var edges = (state.edges || []).map(function(e) {
      return { id: e.data.id, source: e.data.source, target: e.data.target, relation: e.data.relation, weight: e.data.weight };
    });
    var docs = [];
    if (state.markdown) {
      Object.keys(state.markdown).forEach(function(k) {
        if (state.markdown[k]) docs.push({ id: k, content: state.markdown[k], updatedAt: Date.now() });
      });
    }

    return Promise.all([
      dbPutBatch('nodes', nodes),
      dbPutBatch('edges', edges),
      dbPutBatch('markdown', docs),
      state.colors ? dbPut('meta', { key: 'colors', value: state.colors }) : Promise.resolve(),
      state.view ? dbPut('meta', { key: 'view', value: state.view }) : Promise.resolve()
    ]).then(function() {
      localStorage.removeItem(STORAGE_KEY); // 迁移完成后清除
      return true;
    });
  } catch (e) {
    return Promise.resolve(false);
  }
}

// ===================== 清除全部数据 =====================

function clearAllData() {
  return Promise.all([
    dbClear('nodes'), dbClear('edges'), dbClear('markdown'), dbClear('images'), dbClear('meta')
  ]);
}

// ===================== 兼容层：saveState() =====================
// 旧代码中大量调用 saveState()，保持接口兼容，内部改为 IndexedDB 增量写入

function saveState() {
  saveGraphState();
}

function clearSavedState() {
  return clearAllData();
}

function showSaveIndicator() {
  var el = document.getElementById('save-indicator');
  if (!el) return;
  el.classList.add('visible');
  setTimeout(function() { el.classList.remove('visible'); }, 1200);
}
