/**
 * Git UI 模块
 */
var GitUI = (function () {
  var _kbPath = null;

  // ===== overlay 工具 =====
  function _open(id) { document.getElementById(id).classList.add('active'); }
  function _close(id) { document.getElementById(id).classList.remove('active'); }

  // ===== 工具栏红点 =====
  function _setDot(on) {
    var dot = document.querySelector('#btn-git-status .git-dot');
    if (dot) dot.style.display = on ? '' : 'none';
  }

  // ===== 状态路由 =====
  function openForKB(kbPath) {
    if (!kbPath) return;
    _kbPath = kbPath;
    GitBackend.status(_kbPath).then(function (st) {
      GitStore.setStatus(_kbPath, st);
      _setDot(st.state === 'dirty' || st.state === 'ahead' || st.state === 'behind' || st.state === 'diverged' || st.state === 'conflict');
      if (st.state === 'conflict') { openConflict(); return; }
      if (st.state === 'ahead' || st.state === 'behind' || st.state === 'diverged') { openSync(st); return; }
      if (st.state === 'uninit') { _initAndOpen(); return; }
      openCommit();
    }).catch(function () { openCommit(); });
  }

  function _initAndOpen() {
    GitBackend.init(_kbPath).then(function () {
      // init 完成后刷新首页徽标，再打开 commit 面板
      _refreshHomeBadge(_kbPath);
      openCommit();
    }).catch(function () { openCommit(); });
  }

  // ===== GitStore 监听 =====
  GitStore.onStatusChange(function (kbPath, st) {
    if (kbPath !== currentKBPath) return;
    _setDot(st.state === 'dirty' || st.state === 'ahead' || st.state === 'behind' || st.state === 'diverged' || st.state === 'conflict');
  });

  // ===== Commit 面板 =====
  var _commitFiles = [];

  function openCommit() {
    _open('git-commit-overlay');
    document.getElementById('git-commit-msg').value = '';
    document.getElementById('git-commit-files').innerHTML = '<div class="git-loading">加载中...</div>';
    GitBackend.diffFiles(_kbPath).then(function (files) {
      _commitFiles = files || [];
      _renderCommitFiles(_commitFiles);
    }).catch(function () {
      document.getElementById('git-commit-files').innerHTML = '<div class="git-empty">无变更文件</div>';
    });
  }

  function _fileIcon(f) {
    if (f.status === 'D') return '🗑';
    if (f.status === '??' || f.status === 'A') return '✨';
    if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f.path)) return '🖼';
    if (f.path.endsWith('_meta.json')) return '⚙';
    return '📄';
  }

  function _renderCommitFiles(files) {
    var el = document.getElementById('git-commit-files');
    if (!files.length) { el.innerHTML = '<div class="git-empty">无变更文件</div>'; return; }
    el.innerHTML = files.map(function (f, i) {
      return '<div class="git-file-item" data-idx="' + i + '">' + _fileIcon(f) + ' <span class="git-file-path">' + escHtml(f.path) + '</span><span class="git-file-status git-status-' + (f.status || 'M').toLowerCase() + '">' + escHtml(f.status || 'M') + '</span></div>';
    }).join('');
    el.querySelectorAll('.git-file-item').forEach(function (item) {
      item.addEventListener('click', function () {
        el.querySelectorAll('.git-file-item').forEach(function (x) { x.classList.remove('active'); });
        item.classList.add('active');
        var f = _commitFiles[+item.dataset.idx];
        _loadCommitDiff(f);
      });
    });
  }

  function _loadCommitDiff(f) {
    var msgEl = document.getElementById('git-commit-msg');
    var prev = msgEl.placeholder;
    msgEl.placeholder = '加载 diff...';
    GitBackend.diff(_kbPath, { file: f.path }).then(function (d) {
      msgEl.placeholder = prev;
      _showDiffInEl(document.getElementById('git-commit-files').parentElement, d, 'git-commit-diff-view');
    }).catch(function () { msgEl.placeholder = prev; });
  }

  function closeCommit() { _close('git-commit-overlay'); }

  function doCommit() {
    var msg = document.getElementById('git-commit-msg').value.trim();
    var btn = document.getElementById('git-commit-btn');
    btn.disabled = true; btn.textContent = '提交中...';
    GitBackend.commit(_kbPath, msg).then(function () {
      btn.disabled = false; btn.textContent = '提交';
      closeCommit();
      GitStore.markClean(_kbPath);
      if (window.TabManager) TabManager.markClean(_kbPath);
      _setDot(false);
      _refreshHomeBadge(_kbPath);
    }).catch(function (err) {
      btn.disabled = false; btn.textContent = '提交';
      alert('提交失败：' + (err && err.message || err));
    });
  }

  // ===== Log / Diff 面板 =====
  var _logEntries = [];

  function openLog() {
    _kbPath = _kbPath || currentKBPath;
    _open('git-log-overlay');
    document.getElementById('git-log-list').innerHTML = '<div class="git-loading">加载中...</div>';
    document.getElementById('git-log-diff').innerHTML = '';
    GitBackend.log(_kbPath).then(function (entries) {
      _logEntries = entries || [];
      _renderLogList(_logEntries);
    }).catch(function () {
      document.getElementById('git-log-list').innerHTML = '<div class="git-empty">暂无提交记录</div>';
    });
  }

  function _renderLogList(entries) {
    var el = document.getElementById('git-log-list');
    if (!entries.length) { el.innerHTML = '<div class="git-empty">暂无提交记录</div>'; return; }
    el.innerHTML = entries.map(function (e, i) {
      return '<div class="git-log-item" data-idx="' + i + '">' +
        '<div class="git-log-msg">' + escHtml(e.message || '') + '</div>' +
        '<div class="git-log-meta">' + escHtml((e.hash || '').slice(0, 7)) + ' · ' + escHtml(e.date || '') + '</div>' +
        '</div>';
    }).join('');
    el.querySelectorAll('.git-log-item').forEach(function (item) {
      item.addEventListener('click', function () {
        el.querySelectorAll('.git-log-item').forEach(function (x) { x.classList.remove('active'); });
        item.classList.add('active');
        _loadLogDiff(_logEntries[+item.dataset.idx]);
      });
    });
    // 自动选第一条
    var first = el.querySelector('.git-log-item');
    if (first) first.click();
  }

  function _loadLogDiff(entry) {
    var diffEl = document.getElementById('git-log-diff');
    diffEl.innerHTML = '<div class="git-loading">加载 diff...</div>';
    GitBackend.commitDiffFiles(_kbPath, entry.hash).then(function (files) {
      if (!files || !files.length) { diffEl.innerHTML = '<div class="git-empty">无文件变更</div>'; return; }
      var html = '<div class="git-diff-file-list">' + files.map(function (f, i) {
        return '<span class="git-diff-file-tab" data-hash="' + escHtml(entry.hash) + '" data-fp="' + escHtml(f.path) + '" data-idx="' + i + '">' + _fileIcon(f) + ' ' + escHtml(f.path) + '</span>';
      }).join('') + '</div><div class="git-diff-content" id="git-log-diff-content"></div>';
      diffEl.innerHTML = html;
      diffEl.querySelectorAll('.git-diff-file-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
          diffEl.querySelectorAll('.git-diff-file-tab').forEach(function (x) { x.classList.remove('active'); });
          tab.classList.add('active');
          _loadCommitFileDiff(tab.dataset.hash, tab.dataset.fp);
        });
      });
      var firstTab = diffEl.querySelector('.git-diff-file-tab');
      if (firstTab) firstTab.click();
    }).catch(function () { diffEl.innerHTML = '<div class="git-empty">加载失败</div>'; });
  }

  function _loadCommitFileDiff(hash, fp) {
    var el = document.getElementById('git-log-diff-content');
    if (!el) return;
    el.innerHTML = '<div class="git-loading">加载中...</div>';
    GitBackend.commitFileDiff(_kbPath, hash, fp).then(function (d) {
      el.innerHTML = _renderDiff(d);
    }).catch(function () { el.innerHTML = '<div class="git-empty">加载失败</div>'; });
  }

  function closeLog() { _close('git-log-overlay'); }

  // ===== Diff 渲染 =====
  function _renderDiff(raw) {
    if (!raw) return '<div class="git-empty">无内容</div>';
    var lines = raw.split('\n');
    var html = '<pre class="git-diff-pre">';
    lines.forEach(function (line) {
      var cls = '';
      if (line.startsWith('+') && !line.startsWith('+++')) cls = 'diff-add';
      else if (line.startsWith('-') && !line.startsWith('---')) cls = 'diff-del';
      else if (line.startsWith('@@')) cls = 'diff-hunk';
      else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) cls = 'diff-meta';
      html += '<span class="' + cls + '">' + escHtml(line) + '\n</span>';
    });
    return html + '</pre>';
  }

  function _showDiffInEl(container, raw, viewId) {
    var existing = document.getElementById(viewId);
    if (!existing) {
      var div = document.createElement('div');
      div.id = viewId;
      div.className = 'git-diff-inline-view';
      container.appendChild(div);
      existing = div;
    }
    existing.innerHTML = _renderDiff(raw);
    existing.style.display = '';
  }

  // ===== 同步面板 =====
  var _syncState = null;

  function openSync(st) {
    _syncState = st;
    _open('git-sync-overlay');
    var summary = document.getElementById('git-sync-summary');
    var actionBtn = document.getElementById('git-sync-action-btn');
    var logEl = document.getElementById('git-sync-log');
    logEl.classList.add('hidden');
    document.getElementById('git-sync-log-pre').textContent = '';

    if (!st) {
      GitBackend.status(_kbPath).then(function (s) { _syncState = s; _renderSyncSummary(s); });
    } else {
      _renderSyncSummary(st);
    }
  }

  function _renderSyncSummary(st) {
    var summary = document.getElementById('git-sync-summary');
    var actionBtn = document.getElementById('git-sync-action-btn');
    var title = document.getElementById('git-sync-title');

    if (st.state === 'ahead') {
      title.textContent = '推送变更';
      summary.innerHTML = '<p>本地领先远程 <strong>' + (st.ahead || 0) + '</strong> 个提交，可以推送。</p>';
      actionBtn.textContent = '⬆ Push';
      actionBtn.onclick = function () { _doSync('push'); };
    } else if (st.state === 'behind') {
      title.textContent = '拉取更新';
      summary.innerHTML = '<p>远程领先本地 <strong>' + (st.behind || 0) + '</strong> 个提交，建议拉取。</p>';
      actionBtn.textContent = '⬇ Pull';
      actionBtn.onclick = function () { _doSync('pull'); };
    } else if (st.state === 'diverged') {
      title.textContent = '分叉同步';
      summary.innerHTML = '<p>本地与远程已分叉（本地 +' + (st.ahead || 0) + ' / 远程 +' + (st.behind || 0) + '）。建议先 Pull 再 Push。</p>';
      actionBtn.textContent = '⬇ Pull & Merge';
      actionBtn.onclick = function () { _doSync('pull'); };
    } else if (st.state === 'no-remote') {
      title.textContent = '同步';
      summary.innerHTML = '<p>尚未配置远程仓库，请先设置远程地址。</p>';
      actionBtn.textContent = '⚙ 设置远程';
      actionBtn.onclick = function () { closeSync(); openRemote(); };
    } else {
      title.textContent = '同步';
      summary.innerHTML = '<p>当前状态：' + escHtml(st.state) + '</p>';
      actionBtn.textContent = '关闭';
      actionBtn.onclick = closeSync;
    }
  }

  function _doSync(op) {
    var logEl = document.getElementById('git-sync-log');
    var logPre = document.getElementById('git-sync-log-pre');
    var actionBtn = document.getElementById('git-sync-action-btn');
    logEl.classList.remove('hidden');
    logPre.textContent = op === 'push' ? '正在推送...\n' : '正在拉取...\n';
    actionBtn.disabled = true;

    var fn = op === 'push' ? GitBackend.push(_kbPath) : GitBackend.pull(_kbPath);
    fn.then(function (r) {
      logPre.textContent += (r && r.output ? r.output : '完成') + '\n';
      actionBtn.disabled = false;
      // 如果是 pull 且之前 diverged，提示可以 push
      GitBackend.status(_kbPath).then(function (st) {
        GitStore.setStatus(_kbPath, st);
        _setDot(st.state !== 'clean' && st.state !== 'no-remote' && st.state !== 'uninit');
        _refreshHomeBadge(_kbPath);
        if (op === 'pull' && st.state === 'ahead') {
          logPre.textContent += '\n拉取成功，本地有未推送提交，可继续 Push。\n';
          actionBtn.textContent = '⬆ Push';
          actionBtn.onclick = function () { _doSync('push'); };
        } else if (op === 'pull' && st.state === 'conflict') {
          logPre.textContent += '\n检测到冲突，请解决冲突后再提交。\n';
          actionBtn.textContent = '⚡ 解决冲突';
          actionBtn.onclick = function () { closeSync(); openConflict(); };
        } else {
          actionBtn.textContent = '关闭';
          actionBtn.onclick = closeSync;
        }
      });
    }).catch(function (err) {
      actionBtn.disabled = false;
      var msg = err && err.message || String(err);
      if (/AUTH_FAILED|authentication/i.test(msg)) msg = '认证失败，请检查 Token 或 SSH 密钥配置。';
      else if (/PUSH_REJECTED|rejected/i.test(msg)) msg = '推送被拒绝，请先拉取远程变更。';
      else if (/TIMEOUT|timeout/i.test(msg)) msg = '操作超时，请检查网络连接。';
      logPre.textContent += '\n错误：' + msg + '\n';
      actionBtn.textContent = '重试';
      actionBtn.onclick = function () { _doSync(op); };
    });
  }

  function closeSync() { _close('git-sync-overlay'); }

  // ===== 远程设置面板 =====
  function openRemote() {
    _kbPath = _kbPath || currentKBPath;
    _open('git-remote-overlay');
    // 加载当前 remote URL
    GitBackend.remoteGet(_kbPath).then(function (r) {
      document.getElementById('git-remote-url').value = (r && r.url) || '';
    }).catch(function () {});
    // 加载认证类型
    GitBackend.authGetType(_kbPath).then(function (r) {
      var type = (r && r.type) || 'token';
      document.querySelectorAll('input[name="git-auth-type"]').forEach(function (radio) {
        radio.checked = radio.value === type;
      });
      _switchAuthPanel(type);
    }).catch(function () {});
    // SSH 公钥
    GitBackend.authGetSSHKey().then(function (r) {
      document.getElementById('git-ssh-pubkey').textContent = (r && r.pubkey) || '（未生成）';
    }).catch(function () {
      document.getElementById('git-ssh-pubkey').textContent = '（不可用）';
    });
    // 监听 radio 切换
    document.querySelectorAll('input[name="git-auth-type"]').forEach(function (radio) {
      radio.onchange = function () { _switchAuthPanel(radio.value); };
    });
  }

  function _switchAuthPanel(type) {
    document.getElementById('git-auth-token-panel').classList.toggle('hidden', type !== 'token');
    document.getElementById('git-auth-ssh-panel').classList.toggle('hidden', type !== 'ssh');
  }

  function saveRemote() {
    var url = document.getElementById('git-remote-url').value.trim();
    var type = document.querySelector('input[name="git-auth-type"]:checked');
    type = type ? type.value : 'token';
    var token = document.getElementById('git-remote-token').value.trim();

    var p = GitBackend.remoteSet(_kbPath, url);
    if (type === 'token' && token) {
      p = p.then(function () { return GitBackend.authSetToken(_kbPath, token); });
    }
    p = p.then(function () { return GitBackend.authSetType(_kbPath, type); });
    p.then(function () {
      closeRemote();
      GitBackend.fetch(_kbPath).then(function () {
        GitBackend.status(_kbPath).then(function (st) {
          GitStore.setStatus(_kbPath, st);
          _refreshHomeBadge(_kbPath);
        });
      }).catch(function () {});
    }).catch(function (err) {
      alert('保存失败：' + (err && err.message || err));
    });
  }

  function copySSHKey() {
    var key = document.getElementById('git-ssh-pubkey').textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(key).then(function () { alert('已复制到剪贴板'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = key; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      alert('已复制到剪贴板');
    }
  }

  function closeRemote() { _close('git-remote-overlay'); }

  // ===== 冲突解决面板 =====
  var _conflictFiles = [];
  var _conflictCurrent = null;

  function openConflict() {
    _open('git-conflict-overlay');
    document.getElementById('git-conflict-files').innerHTML = '<div class="git-loading">加载中...</div>';
    document.getElementById('git-conflict-main').innerHTML = '';
    GitBackend.conflictList(_kbPath).then(function (files) {
      _conflictFiles = files || [];
      _renderConflictFiles();
    }).catch(function () {
      document.getElementById('git-conflict-files').innerHTML = '<div class="git-empty">加载失败</div>';
    });
  }

  function _renderConflictFiles() {
    var el = document.getElementById('git-conflict-files');
    if (!_conflictFiles.length) {
      el.innerHTML = '<div class="git-empty">无冲突文件</div>';
      document.getElementById('git-conflict-complete-btn').disabled = false;
      return;
    }
    el.innerHTML = _conflictFiles.map(function (f, i) {
      var resolved = f.resolved ? ' git-conflict-resolved' : '';
      return '<div class="git-conflict-file-item' + resolved + '" data-idx="' + i + '">⚡ ' + escHtml(f.path) + (f.resolved ? ' ✓' : '') + '</div>';
    }).join('');
    el.querySelectorAll('.git-conflict-file-item').forEach(function (item) {
      item.addEventListener('click', function () {
        el.querySelectorAll('.git-conflict-file-item').forEach(function (x) { x.classList.remove('active'); });
        item.classList.add('active');
        _loadConflictFile(_conflictFiles[+item.dataset.idx]);
      });
    });
    var first = el.querySelector('.git-conflict-file-item');
    if (first) first.click();
  }

  function _loadConflictFile(f) {
    _conflictCurrent = f;
    var main = document.getElementById('git-conflict-main');
    main.innerHTML = '<div class="git-loading">加载中...</div>';
    GitBackend.conflictShow(_kbPath, f.path).then(function (data) {
      var isAuto = data && data.autoMerge;
      var content = (data && (data.merged || data.content)) || '';
      main.innerHTML =
        '<div class="git-conflict-info">' +
          (isAuto ? '<span class="git-conflict-auto-badge">✓ 自动合并</span>' : '<span class="git-conflict-manual-badge">⚡ 需手动解决</span>') +
          ' <strong>' + escHtml(f.path) + '</strong>' +
        '</div>' +
        (data && data.ours ? '<div class="git-conflict-cols"><div class="git-conflict-col"><div class="git-conflict-col-header">本地 (Ours)</div><pre class="git-conflict-pre">' + escHtml(data.ours) + '</pre></div>' +
          '<div class="git-conflict-col"><div class="git-conflict-col-header">远程 (Theirs)</div><pre class="git-conflict-pre">' + escHtml(data.theirs || '') + '</pre></div></div>' : '') +
        '<div class="git-conflict-edit-label">编辑解决结果：</div>' +
        '<textarea class="git-conflict-textarea" id="git-conflict-edit">' + escHtml(content) + '</textarea>' +
        '<div class="git-conflict-actions">' +
          (isAuto ? '<button class="git-btn git-btn--primary" onclick="GitUI.acceptAutoMerge()">接受自动合并</button>' : '') +
          '<button class="git-btn git-btn--primary" onclick="GitUI.resolveConflict()">标记为已解决</button>' +
        '</div>';
    }).catch(function () {
      main.innerHTML = '<div class="git-empty">加载失败</div>';
    });
  }

  function acceptAutoMerge() {
    resolveConflict();
  }

  function resolveConflict() {
    if (!_conflictCurrent) return;
    var ta = document.getElementById('git-conflict-edit');
    var content = ta ? ta.value : '';
    GitBackend.conflictResolve(_kbPath, _conflictCurrent.path, content).then(function () {
      _conflictCurrent.resolved = true;
      _renderConflictFiles();
      var allResolved = _conflictFiles.every(function (f) { return f.resolved; });
      document.getElementById('git-conflict-complete-btn').disabled = !allResolved;
    }).catch(function (err) {
      alert('解决失败：' + (err && err.message || err));
    });
  }

  function completeConflict() {
    GitBackend.conflictComplete(_kbPath).then(function () {
      closeConflict();
      GitStore.markClean(_kbPath);
      if (window.TabManager) TabManager.markClean(_kbPath);
      _setDot(false);
      _refreshHomeBadge(_kbPath);
    }).catch(function (err) {
      alert('完成合并失败：' + (err && err.message || err));
    });
  }

  function closeConflict() { _close('git-conflict-overlay'); }

  // ===== 首页徽标刷新 =====
  function _refreshHomeBadge(kbPath) {
    GitBackend.status(kbPath).then(function (st) {
      var grid = document.getElementById('kb-grid');
      if (!grid) return;
      var card = grid.querySelector('[data-kb-path="' + kbPath + '"]');
      if (!card) return;
      var badge = card.querySelector('.git-status-badge');
      if (!badge) return;
      var label = _gitBadgeLabel(st);
      var cls = 'git-badge git-badge--' + st.state;
      badge.innerHTML = '<span class="' + cls + '" data-action="open-git" data-kb-path="' + escHtml(kbPath) + '" title="Git 状态">' + label + '</span>';
    }).catch(function () {});
  }

  // ===== 工具栏按钮绑定 =====
  document.getElementById('btn-git-status').addEventListener('click', function () {
    if (currentKBPath) openForKB(currentKBPath);
  });

  return {
    openForKB: openForKB,
    openCommit: openCommit,
    closeCommit: closeCommit,
    doCommit: doCommit,
    openLog: openLog,
    closeLog: closeLog,
    openSync: openSync,
    closeSync: closeSync,
    openRemote: openRemote,
    closeRemote: closeRemote,
    saveRemote: saveRemote,
    copySSHKey: copySSHKey,
    openConflict: openConflict,
    closeConflict: closeConflict,
    resolveConflict: resolveConflict,
    acceptAutoMerge: acceptAutoMerge,
    completeConflict: completeConflict,
  };
})();
