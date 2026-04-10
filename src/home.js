/**
 * 知识库首页
 */

function showHome() {
  document.getElementById('home-modal').style.display = '';
  document.getElementById('graph-page').style.display = 'none';
  currentKBPath = null;
  currentRoomPath = null;
  refreshKBList();
}

function hideHome() {
  document.getElementById('home-modal').style.display = 'none';
  document.getElementById('graph-page').style.display = '';
}

function refreshKBList() {
  Promise.all([Store.listKBs(), Store.getRootDir()]).then(function(res) {
    var kbs = res[0];
    var rootDir = res[1] || '';
    var grid = document.getElementById('kb-grid');
    if (!kbs || !kbs.length) {
      grid.innerHTML =
        '<div class="home-empty">' +
          '<div class="home-empty-icon">📚</div>' +
          '<h3>还没有知识库</h3>' +
          '<p>点击 ＋ 创建你的第一个知识图谱</p>' +
        '</div>' +
        '<div class="home-card-add" onclick="createKBPrompt()">' +
          '<div class="home-card-add-icon">＋</div>' +
          '<div class="home-card-add-text">新建知识库</div>' +
        '</div>';
      return;
    }

    // 并行获取每个知识库的节点数
    var countPromises = kbs.map(function(kb) {
      return Store.countChildren(kb.path);
    });

    Promise.all(countPromises).then(function(counts) {
      var html = '';
      kbs.forEach(function(kb, i) {
        var nodeCount = counts[i] || 0;
        var absPath = rootDir + '/' + kb.path;
        var imgContent = kb.cover
          ? '<img src="' + escHtml(rootDir + '/' + kb.path + '/' + kb.cover) + '">'
          : '<span class="home-card-image-icon">📚</span>';

        html += '<div class="home-card" data-kb-path="' + esc(kb.path) + '" onclick="openKB(\'' + esc(kb.path) + '\')">';
        html += '<div class="home-card-image">' + imgContent;
        html += '<button class="home-card-cover-btn" onclick="event.stopPropagation();changeKBCover(\'' + esc(kb.path) + '\')" title="更换封面">📷 更换</button>';
        html += '<div class="git-status-badge"></div>';
        html += '</div>';
        html += '<div class="home-card-body">';
        html += '<div class="home-card-title">';
        html += '<span>' + escHtml(kb.name) + '</span>';
        html += '<div class="home-card-actions">';
        html += '<button class="home-card-action-btn danger" onclick="event.stopPropagation();deleteKBConfirm(\'' + esc(kb.path) + '\',\'' + esc(kb.name) + '\')" title="删除">🗑</button>';
        html += '</div></div>';
        html += '<div class="home-card-meta"><span>📊 ' + nodeCount + ' 个节点</span></div>';
        html += '<div class="home-card-path" onclick="event.stopPropagation();Store.openInFinder(\'' + esc(kb.path) + '\')" title="在 Finder 中打开">📁 ' + escHtml(absPath) + '</div>';
        html += '</div></div>';
      });
      html += '<div class="home-card-add" onclick="createKBPrompt()">';
      html += '<div class="home-card-add-icon">＋</div>';
      html += '<div class="home-card-add-text">新建知识库</div>';
      html += '</div>';
      // 隐藏的文件输入
      html += '<input type="file" id="kb-cover-file-input" accept="image/*" style="display:none">';
      grid.innerHTML = html;

      // 异步注入 git 状态徽标
      GitBackend.statusBatch(kbs.map(function(kb) { return kb.path; })).then(function(statuses) {
        kbs.forEach(function(kb) {
          var st = statuses[kb.path] || { state: 'uninit' };
          var card = grid.querySelector('[data-kb-path="' + kb.path + '"]');
          if (!card) return;
          var badge = card.querySelector('.git-status-badge');
          if (!badge) return;
          var label = _gitBadgeLabel(st);
          var cls = 'git-badge git-badge--' + st.state;
          badge.innerHTML = '<span class="' + cls + '" onclick="event.stopPropagation();GitUI.openForKB(\'' + esc(kb.path) + '\')" title="Git 状态">' + label + '</span>';
        });
      }).catch(function() {});
    });
  }).catch(function(err) {
    console.error('加载知识库列表失败:', err);
  });
}

// ===== 新建知识库（使用深色表单） =====
var _kbCoverBlob = null;

function createKBPrompt() {
  _kbCoverBlob = null;
  var overlay = document.getElementById('kb-form-overlay');
  var nameInput = document.getElementById('kb-form-name');
  var dirDisplay = document.getElementById('kb-form-dir-display');
  var coverPreview = document.getElementById('kb-form-cover-preview');
  var coverUpload = document.getElementById('kb-form-cover-upload');

  nameInput.value = '';
  dirDisplay.textContent = '默认目录';
  dirDisplay.dataset.customDir = '';
  coverPreview.innerHTML = '<div class="home-image-upload-text">📷 点击选择封面</div><div class="home-image-upload-hint">可选，不设置使用默认</div>';
  coverPreview.classList.remove('has-image');
  if (coverUpload) coverUpload.value = '';

  overlay.classList.add('active');
}

function kbFormSelectDir() {
  Store.selectDir().then(function(dir) {
    if (dir) {
      document.getElementById('kb-form-dir-display').textContent = dir;
      document.getElementById('kb-form-dir-display').dataset.customDir = dir;
    }
  });
}

function kbFormSelectCover() {
  document.getElementById('kb-form-cover-upload').click();
}

function kbFormCoverChanged(input) {
  if (!input.files || !input.files[0]) return;
  _kbCoverBlob = input.files[0];
  var reader = new FileReader();
  reader.onload = function(e) {
    var preview = document.getElementById('kb-form-cover-preview');
    preview.innerHTML = '<img src="' + e.target.result + '"><button class="home-remove-image" onclick="event.stopPropagation();kbFormRemoveCover()">✕</button>';
    preview.classList.add('has-image');
  };
  reader.readAsDataURL(_kbCoverBlob);
}

function kbFormRemoveCover() {
  _kbCoverBlob = null;
  var preview = document.getElementById('kb-form-cover-preview');
  preview.innerHTML = '<div class="home-image-upload-text">📷 点击选择封面</div><div class="home-image-upload-hint">可选，不设置使用默认</div>';
  preview.classList.remove('has-image');
  document.getElementById('kb-form-cover-upload').value = '';
}

function kbFormCancel() {
  document.getElementById('kb-form-overlay').classList.remove('active');
  _kbCoverBlob = null;
}

function kbFormSubmit() {
  var name = document.getElementById('kb-form-name').value.trim();
  if (!name) { document.getElementById('kb-form-name').focus(); return; }

  Store.createKB(name).then(function() {
    // 保存封面
    if (_kbCoverBlob) {
      return Store.saveImage(name, _kbCoverBlob, 'cover.' + (_kbCoverBlob.name || 'png').split('.').pop()).then(function(r) {
        // 更新 meta 记录封面路径
        return Store.getKBMeta(name).then(function(meta) {
          meta.cover = r.markdownRef;
          return Store.saveKBMeta(name, meta);
        });
      });
    }
  }).then(function() {
    kbFormCancel();
    refreshKBList();
  }).catch(function(err) {
    console.error('创建知识库失败:', err);
  });
}

// ===== 更换知识库封面 =====
var _changeCoverKBPath = null;
function changeKBCover(kbPath) {
  _changeCoverKBPath = kbPath;
  var input = document.getElementById('kb-cover-file-input');
  input.value = '';
  input.onchange = function() {
    if (!input.files || !input.files[0] || !_changeCoverKBPath) return;
    var blob = input.files[0];
    var ext = (blob.name || 'png').split('.').pop();
    Store.saveImage(_changeCoverKBPath, blob, 'cover.' + ext).then(function(r) {
      return Store.getKBMeta(_changeCoverKBPath).then(function(meta) {
        meta.cover = r.markdownRef;
        return Store.saveKBMeta(_changeCoverKBPath, meta);
      });
    }).then(function() {
      _changeCoverKBPath = null;
      refreshKBList();
    });
  };
  input.click();
}

function deleteKBConfirm(kbPath, name) {
  _pendingConfirmAction = function() {
    Store.deleteKB(kbPath).then(function() { refreshKBList(); });
  };
  document.getElementById('confirm-message').textContent = '确定删除知识库「' + name + '」？此操作不可恢复。';
  document.getElementById('modal-confirm').classList.add('active');
}

function openKB(kbPath) {
  currentKBPath = kbPath;
  currentRoomPath = null;
  roomHistory = [];
  hideHome();
  loadRoom(kbPath);
  // 自动初始化 git（如果可用）
  GitBackend.checkAvailable().then(function(r) {
    if (r && r.available) GitBackend.init(kbPath);
  }).catch(function() {});
}

function esc(s) { return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function escHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function _gitBadgeLabel(st) {
  var map = {
    'uninit': '○ 未追踪',
    'dirty': '● 有变更',
    'clean': '✓ 本地',
    'ahead': '⬆ ' + (st.ahead || '') ,
    'behind': '⬇ ' + (st.behind || ''),
    'diverged': '⇅ 分叉',
    'conflict': '⚡ 冲突',
    'no-remote': '○ 无远程',
    'git-unavailable': '— Git 不可用',
  };
  return map[st.state] || st.state;
}
