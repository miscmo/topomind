/**
 * 详情面板：Markdown 渲染、内联编辑
 */
marked.setOptions({ breaks: true, gfm: true });

/**
 * 轻量级 HTML 消毒，防止 Markdown 渲染中的 XSS
 */
function sanitizeHtml(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    .replace(/href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'href="#"')
    .replace(/src\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '');
}

// 用于追踪当前显示版本，防止竞态条件
var _detailVersion = 0;
// 记录当前已创建的 Object URL，切换卡片时统一释放
var _activeObjectURLs = [];

/** 释放上一次创建的所有 Object URL */
function _revokeActiveObjectURLs() {
  _activeObjectURLs.forEach(function(url) {
    try { URL.revokeObjectURL(url); } catch (e) {}
  });
  _activeObjectURLs = [];
}

function flushEdit() {
  var ta = document.getElementById('detail-edit-area');
  if (ta && ta.classList.contains('active') && selectedNode) {
    Store.writeMarkdown(selectedNode.id(), ta.value);
    Store.showSaveIndicator();
    GitStore.markDirty(currentKBPath);
    if (window.TabManager) TabManager.markDirty(currentKBPath);
  }
}

function showDetail(cardPath) {
  flushEdit();
  // 递增版本号：之后所有异步回调会对比此版本，旧版本的回调直接丢弃
  var version = ++_detailVersion;
  // 释放上一张卡片创建的 Object URL，防止内存泄漏
  _revokeActiveObjectURLs();

  var node = cy.getElementById(cardPath);
  if (!node.length) return;

  var titleEl = document.getElementById('detail-title');
  var body = document.getElementById('detail-body');
  var rendered = body.querySelector('.rendered-content');
  var ta = document.getElementById('detail-edit-area');

  var titleSpan = titleEl.querySelector('.detail-title-text');
  if (titleSpan) titleSpan.textContent = node.data('label');
  else titleEl.textContent = node.data('label');
  if (ta) ta.classList.remove('active');
  document.getElementById('btn-mode-read').classList.add('active');
  document.getElementById('btn-mode-edit').classList.remove('active');

  // 子卡片信息
  Store.listCards(cardPath).then(function(kids) {
    var childInfo = '';
    if (kids.length > 0) {
      childInfo = '<div class="child-info-box">';
      childInfo += '<strong class="child-info-title">📂 包含 ' + kids.length + ' 个子概念</strong><br>';
      kids.forEach(function(kid) {
      childInfo += '<span class="child-tag" data-drill-path="' + escHtml(kid.path) + '">' + escHtml(kid.name || '') + '</span>';
      });
      childInfo += '</div>';
    }

    // 读取 Markdown
    return Store.readMarkdown(cardPath).then(function(md) {
      if (rendered) {
        rendered.style.display = '';
        rendered.innerHTML = sanitizeHtml(md ? marked.parse(md) : '<div class="placeholder-text" style="color:#bbb;margin-top:20px">暂无文档内容</div>') + childInfo;
        resolveRenderedImages(rendered, cardPath, version);
        // 子卡片标签点击事件委托
        rendered.querySelectorAll('.child-tag[data-drill-path]').forEach(function(tag) {
          tag.addEventListener('click', function() {
            drillInto(tag.dataset.drillPath);
          });
        });
      }
    });
  });

  body.scrollTop = 0;
  document.getElementById('btn-edit-md').style.display = '';
  document.getElementById('btn-edit-node').style.display = '';
  document.getElementById('btn-delete-node').style.display = '';
  document.getElementById('detail-mode-toggle').classList.add('visible');
}

function showPlaceholder() {
  flushEdit();
  var titleSpan = document.querySelector('#detail-title .detail-title-text');
  if (titleSpan) titleSpan.textContent = '知识详情';
  else document.getElementById('detail-title').textContent = '知识详情';
  var body = document.getElementById('detail-body');
  var rendered = body.querySelector('.rendered-content');
  if (rendered) { rendered.style.display = ''; rendered.innerHTML = '<div class="placeholder-text"><span>📖</span>点击节点查看详情</div>'; }
  var ta = document.getElementById('detail-edit-area');
  if (ta) ta.classList.remove('active');
  ['btn-edit-md','btn-edit-node','btn-delete-node'].forEach(function(id) {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('detail-mode-toggle').classList.remove('visible');
}

function switchDetailMode(mode) {
  var rendered = document.querySelector('#detail-body .rendered-content');
  var ta = document.getElementById('detail-edit-area');
  if (mode === 'edit' && selectedNode) {
    document.getElementById('btn-mode-read').classList.remove('active');
    document.getElementById('btn-mode-edit').classList.add('active');
    Store.readMarkdown(selectedNode.id()).then(function(md) {
      ta.value = md || '';
      ta.classList.add('active');
      if (rendered) rendered.style.display = 'none';
      ta.focus();
    });
  } else {
    if (selectedNode) {
      Store.writeMarkdown(selectedNode.id(), ta.value);
      Store.showSaveIndicator();
      GitStore.markDirty(currentKBPath);
    }
    document.getElementById('btn-mode-read').classList.add('active');
    document.getElementById('btn-mode-edit').classList.remove('active');
    ta.classList.remove('active');
    if (rendered) rendered.style.display = '';
    if (selectedNode) showDetail(selectedNode.id());
  }
}

/** 解析图片引用（带竞态保护和 URL 追踪） */
function resolveRenderedImages(container, cardPath, version) {
  container.querySelectorAll('img').forEach(function(img) {
    var src = img.getAttribute('src') || '';
    if (src.startsWith('images/')) {
      var imgPath = cardPath + '/' + src;
      img.style.opacity = '0.3';
      Store.loadImage(imgPath).then(function(url) {
        // 若版本已过期（用户已切换到其他卡片），丢弃结果并释放 URL
        if (version !== _detailVersion) {
          if (url) try { URL.revokeObjectURL(url); } catch (e) {}
          return;
        }
        if (url) {
          _activeObjectURLs.push(url); // 登记，切换时统一 revoke
          img.src = url;
          img.style.opacity = '1';
        } else {
          img.alt = '[图片加载失败]';
          img.style.opacity = '1';
        }
      });
    }
  });
}

// ===== 详情面板收起/展开 =====
document.getElementById('btn-collapse-detail').addEventListener('click', function() {
  document.getElementById('detail-panel').classList.add('collapsed');
  document.getElementById('btn-toggle-detail').classList.add('visible');
  document.getElementById('detail-resize-handle').classList.add('hidden');
});
document.getElementById('btn-toggle-detail').addEventListener('click', function() {
  document.getElementById('detail-panel').classList.remove('collapsed');
  document.getElementById('btn-toggle-detail').classList.remove('visible');
  document.getElementById('detail-resize-handle').classList.remove('hidden');
});

// ===== 拖拽调整详情面板宽度 =====
(function() {
  var handle = document.getElementById('detail-resize-handle');
  var panel = document.getElementById('detail-panel');
  var dragging = false;

  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    dragging = true;
    panel.classList.add('resizing');
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var appRect = document.getElementById('app').getBoundingClientRect();
    var newWidth = appRect.right - e.clientX;
    if (newWidth < 180) newWidth = 180;
    if (newWidth > 600) newWidth = 600;
    panel.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('resizing');
    handle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();
