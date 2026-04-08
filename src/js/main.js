/**
 * 应用启动入口（异步）
 */

(function boot() {
  var welcomeEl = document.getElementById('welcome-overlay');

  // 1. 初始化 IndexedDB
  initDB().then(function() {

    // 2. 尝试从 localStorage 迁移旧数据
    return migrateFromLocalStorage().then(function(migrated) {

      // 3. 尝试恢复上次的工作目录
      return tryRestoreWorkDir().then(function(dirRestored) {

        // 4. 从 IndexedDB 加载图结构
        return loadGraphFromDB().then(function(loaded) {
          if (loaded) {
            hideWelcome();
            enterRoom(currentRoom);
            updateStorageStatus();
          } else {
            // 无存档 → 写入默认数据
            return seedDefaultData().then(function() {
              return loadGraphFromDB();
            }).then(function() {
              hideWelcome();
              enterRoom(null);
              updateStorageStatus();
            });
          }
        });
      });
    });
  }).catch(function(err) {
    console.error('启动失败:', err);
    // 降级：直接使用内存中的默认数据
    hideWelcome();
    enterRoom(null);
  });

  function hideWelcome() {
    if (welcomeEl) welcomeEl.style.display = 'none';
  }

  // 绑定欢迎页按钮
  var btnNewDir = document.getElementById('btn-new-workdir');
  var btnSkip = document.getElementById('btn-skip-workdir');

  if (btnNewDir) {
    btnNewDir.addEventListener('click', function() {
      if (!supportsFS) { alert('当前浏览器不支持本地文件系统，将使用浏览器内置存储。'); return; }
      pickWorkDirectory().then(function() {
        // 将当前 Markdown 同步到文件
        return syncMarkdownToFiles();
      }).then(function() {
        updateStorageStatus();
      }).catch(function() {});
    });
  }
  if (btnSkip) {
    btnSkip.addEventListener('click', function() { hideWelcome(); enterRoom(null); });
  }
})();

// ===== 存储状态显示 =====
function updateStorageStatus() {
  getStorageInfo().then(function(info) {
    var el = document.getElementById('storage-status');
    if (!el) return;
    var mode = info.mode === 'hybrid' ? '📁 ' + info.dirName : '💾 浏览器存储';
    var stats = info.nodeCount + ' 节点 · ' + info.docCount + ' 文档';
    if (info.imageCount > 0) stats += ' · ' + info.imageCount + ' 图片';
    el.textContent = mode + ' | ' + stats;
    el.style.display = '';
  });
}

// ===== 详情面板按钮 =====
document.getElementById('btn-mode-read').addEventListener('click', function() { switchDetailMode('read'); });
document.getElementById('btn-mode-edit').addEventListener('click', function() { switchDetailMode('edit'); });
document.getElementById('btn-edit-md').onclick = function() { if (selectedNode) switchDetailMode('edit'); };

// ===== 编辑区输入时自动保存（1秒防抖） =====
var editAutoSaveTimer = null;
document.getElementById('detail-edit-area').addEventListener('input', function() {
  clearTimeout(editAutoSaveTimer);
  editAutoSaveTimer = setTimeout(function() {
    flushEdit();
  }, 1000);
});

// ===== 图片粘贴/拖拽上传 =====
var detailEditArea = document.getElementById('detail-edit-area');

detailEditArea.addEventListener('paste', function(e) {
  var items = (e.clipboardData || {}).items;
  if (!items) return;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') === 0) {
      e.preventDefault();
      var blob = items[i].getAsFile();
      insertImageFromBlob(blob);
      break;
    }
  }
});

detailEditArea.addEventListener('drop', function(e) {
  var files = e.dataTransfer ? e.dataTransfer.files : [];
  for (var i = 0; i < files.length; i++) {
    if (files[i].type.indexOf('image') === 0) {
      e.preventDefault();
      insertImageFromBlob(files[i]);
      break;
    }
  }
});

detailEditArea.addEventListener('dragover', function(e) { e.preventDefault(); });

function insertImageFromBlob(blob) {
  if (!selectedNode) return;
  var nodeId = selectedNode.id();
  saveImage(nodeId, blob, blob.name || 'paste.png').then(function(result) {
    var textarea = document.getElementById('detail-edit-area');
    var pos = textarea.selectionStart;
    var text = textarea.value;
    var insert = '![图片](' + result.markdownRef + ')\n';
    textarea.value = text.substring(0, pos) + insert + text.substring(pos);
    textarea.selectionStart = textarea.selectionEnd = pos + insert.length;
    textarea.focus();
    // 触发保存
    flushEdit();
  });
}

// ===== 图片上传按钮 =====
var btnInsertImg = document.getElementById('btn-insert-image');
if (btnInsertImg) {
  btnInsertImg.addEventListener('click', function() {
    if (!selectedNode) return;
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = function() {
      if (input.files[0]) insertImageFromBlob(input.files[0]);
    };
    input.click();
  });
}

// ===== 工作目录管理按钮 =====
var btnWorkDir = document.getElementById('btn-workdir');
if (btnWorkDir) {
  btnWorkDir.addEventListener('click', function() {
    if (!supportsFS) { alert('当前浏览器不支持本地文件系统访问（需要 Chrome/Edge 86+）。\n将继续使用浏览器内置存储。'); return; }
    pickWorkDirectory().then(function() {
      return syncMarkdownToFiles();
    }).then(function() {
      updateStorageStatus();
      showSaveIndicator();
    }).catch(function() {});
  });
}

// ===== 页面关闭/刷新前保存 =====
window.addEventListener('beforeunload', function() {
  flushEdit();
  _doSaveGraph(); // 同步写入
});

// ===== 启动提示 =====
setTimeout(function() {
  var h = document.getElementById('shortcut-hint');
  if (h) { h.classList.add('visible'); setTimeout(function() { h.classList.remove('visible'); }, 4000); }
}, 800);
