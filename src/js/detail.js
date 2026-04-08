/**
 * 详情面板：Markdown 渲染、内联编辑
 */
marked.setOptions({ breaks: true, gfm: true });

/** 自动保存当前编辑中的内容（切换节点/房间前调用） */
function flushEdit() {
  var textarea = document.getElementById('detail-edit-area');
  if (textarea && textarea.classList.contains('active') && selectedNode) {
    MD[selectedNode.id()] = textarea.value;
    saveState();
  }
}

function showDetail(nodeId) {
  flushEdit();

  var md = MD[nodeId];
  var titleEl = document.getElementById('detail-title');
  var body = document.getElementById('detail-body');
  var rendered = body.querySelector('.rendered-content');
  var textarea = document.getElementById('detail-edit-area');
  var node = cy.getElementById(nodeId);
  var c = nodeColor(node);

  titleEl.textContent = node.data('label');
  titleEl.style.borderLeftColor = c.bg;

  if (textarea) textarea.classList.remove('active');
  document.getElementById('btn-mode-read').classList.add('active');
  document.getElementById('btn-mode-edit').classList.remove('active');

  var hasKids = node.children().length > 0;
  var childInfo = '';
  if (hasKids) {
    childInfo = '<div style="margin:12px 0;padding:10px 14px;background:#f5f7fa;border-radius:8px;font-size:12px;color:#666">';
    childInfo += '<strong style="color:#333">📂 包含 ' + node.children().length + ' 个子概念</strong><br>';
    node.children().forEach(function(kid) {
      childInfo += '<span style="display:inline-block;margin:3px 4px 3px 0;padding:2px 8px;background:' + nodeColor(kid).bg + ';color:#fff;border-radius:4px;font-size:11px;cursor:pointer" onclick="drillInto(\'' + kid.id() + '\')">' + kid.data('label') + '</span>';
    });
    childInfo += '<br><small style="color:#aaa">双击卡片或点击标签进入</small></div>';
  }

  if (rendered) {
    rendered.style.display = '';
    rendered.innerHTML = (md ? marked.parse(md) : '<div style="color:#bbb;margin-top:20px">暂无文档内容</div>') + childInfo;
  }
  body.scrollTop = 0;

  document.getElementById('btn-edit-md').style.display = '';
  document.getElementById('btn-edit-node').style.display = '';
  document.getElementById('btn-delete-node').style.display = '';
  document.getElementById('detail-mode-toggle').classList.add('visible');

  document.querySelectorAll('#nav-tree .nav-item').forEach(function(el) {
    el.classList.toggle('active', el.dataset.id === nodeId);
  });
}

function showPlaceholder() {
  flushEdit();
  document.getElementById('detail-title').textContent = '知识详情';
  document.getElementById('detail-title').style.borderLeftColor = '#ddd';
  var body = document.getElementById('detail-body');
  var rendered = body.querySelector('.rendered-content');
  if (rendered) { rendered.style.display = ''; rendered.innerHTML = '<div class="placeholder-text"><span>📖</span>点击节点查看详情<br><small style="color:#bbb">双击卡片进入内部</small></div>'; }
  var ta = document.getElementById('detail-edit-area');
  if (ta) ta.classList.remove('active');
  document.getElementById('btn-edit-md').style.display = 'none';
  document.getElementById('btn-edit-node').style.display = 'none';
  document.getElementById('btn-delete-node').style.display = 'none';
  document.getElementById('detail-mode-toggle').classList.remove('visible');
  document.querySelectorAll('#nav-tree .nav-item').forEach(function(el) { el.classList.remove('active'); });
}

function switchDetailMode(mode) {
  var body = document.getElementById('detail-body');
  var rendered = body.querySelector('.rendered-content');
  var textarea = document.getElementById('detail-edit-area');
  if (mode === 'edit' && selectedNode) {
    document.getElementById('btn-mode-read').classList.remove('active');
    document.getElementById('btn-mode-edit').classList.add('active');
    textarea.value = MD[selectedNode.id()] || '';
    textarea.classList.add('active');
    if (rendered) rendered.style.display = 'none';
    textarea.focus();
  } else {
    if (selectedNode) { MD[selectedNode.id()] = textarea.value; saveState(); }
    document.getElementById('btn-mode-read').classList.add('active');
    document.getElementById('btn-mode-edit').classList.remove('active');
    textarea.classList.remove('active');
    if (rendered) rendered.style.display = '';
    if (selectedNode) showDetail(selectedNode.id());
  }
}
