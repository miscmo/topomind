/**
 * 应用启动入口
 */

// 加载存档或使用默认数据
var loaded = loadState();
if (loaded) { enterRoom(currentRoom); } else { enterRoom(null); }

// 详情面板按钮
document.getElementById('btn-mode-read').addEventListener('click', function() { switchDetailMode('read'); });
document.getElementById('btn-mode-edit').addEventListener('click', function() { switchDetailMode('edit'); });
document.getElementById('btn-edit-md').onclick = function() { if (selectedNode) switchDetailMode('edit'); };

// 编辑区输入时自动保存（1秒防抖）
var editAutoSaveTimer = null;
document.getElementById('detail-edit-area').addEventListener('input', function() {
  clearTimeout(editAutoSaveTimer);
  editAutoSaveTimer = setTimeout(function() {
    flushEdit();
  }, 1000);
});

// 页面关闭/刷新前保存
window.addEventListener('beforeunload', function() {
  flushEdit();
});

// 启动提示
setTimeout(function() {
  var h = document.getElementById('shortcut-hint');
  if (h) { h.classList.add('visible'); setTimeout(function() { h.classList.remove('visible'); }, 4000); }
}, 800);
