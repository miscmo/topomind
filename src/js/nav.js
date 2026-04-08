/**
 * 左侧导航目录构建
 */
function buildNavTree() {
  var tree = document.getElementById('nav-tree');
  tree.innerHTML = '';

  var roomNode = currentRoom ? cy.getElementById(currentRoom) : null;
  var kids = (roomNode && roomNode.length) ? roomNode.children()
    : cy.nodes().filter(function(n) { return n.data('level') === 1; });

  if (currentRoom !== null) {
    var backRow = document.createElement('div');
    backRow.style.cssText = 'padding:8px 16px';
    backRow.innerHTML = '<button onclick="goBack()" style="width:100%;height:28px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;color:#666">← 返回上一层</button>';
    tree.appendChild(backRow);
  }

  kids.sort(function(a, b) { return a.data('label').localeCompare(b.data('label')); });
  kids.forEach(function(n) {
    var c = nodeColor(n);
    var hasKids = n.children().length > 0;
    var div = document.createElement('div');
    div.className = 'nav-group';
    var badge = hasKids ? '<span style="font-size:10px;color:#aaa;margin-left:4px">📂' + n.children().length + '</span>' : '';
    div.innerHTML = '<div class="nav-item nav-domain" data-id="' + n.id() + '" style="border-left-color:' + c.bg + '"><span>' + n.data('label') + badge + '</span><button class="nav-add-btn" data-parent="' + n.id() + '" title="添加子节点">＋</button></div>';
    tree.appendChild(div);
  });

  var addRow = document.createElement('div');
  addRow.style.cssText = 'padding:8px 16px';
  addRow.innerHTML = '<button id="nav-add-card" style="width:100%;height:28px;border:1.5px dashed #ccc;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;color:#999">＋ 新建卡片</button>';
  tree.appendChild(addRow);

  tree.querySelectorAll('.nav-item').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (e.target.classList.contains('nav-add-btn')) return;
      var nid = el.dataset.id;
      var node = cy.getElementById(nid);
      if (!node.length) return;
      if (selectedNode) selectedNode.removeClass('selected');
      node.addClass('selected'); selectedNode = node;
      showDetail(nid);
    });
    el.addEventListener('dblclick', function(e) {
      if (e.target.classList.contains('nav-add-btn')) return;
      drillInto(el.dataset.id);
    });
  });

  tree.querySelectorAll('.nav-add-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var name = prompt('输入子概念名称：');
      if (name && name.trim()) quickAddChild(btn.dataset.parent, name.trim());
    });
  });

  var addCardBtn = document.getElementById('nav-add-card');
  if (addCardBtn) {
    addCardBtn.addEventListener('click', function() {
      var name = prompt('输入新卡片名称：');
      if (name && name.trim()) quickAddChild(currentRoom, name.trim());
    });
  }
}
