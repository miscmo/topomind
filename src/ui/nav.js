/**
 * 左侧导航目录
 */
function buildNavTree() {
  var tree = document.getElementById('nav-tree');
  tree.innerHTML = '';
  if (!currentKBPath) return;

  // 返回按钮
  var back = document.createElement('div');
  back.style.cssText = 'padding:6px 14px';
  back.innerHTML = '<button onclick="goBack()" style="width:100%;height:28px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;color:#666">← 返回</button>';
  tree.appendChild(back);

  // 当前房间的子卡片
  var dirPath = currentRoomPath || currentKBPath;
  Store.listCards(dirPath).then(function(cards) {
    cards.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    cards.forEach(function(card) {
      var div = document.createElement('div');
      div.className = 'nav-item';
      div.dataset.id = card.path;
      div.textContent = card.name;
      div.addEventListener('click', function() {
        var n = cy.getElementById(card.path);
        if (!n.length) return;
        if (selectedNode) selectedNode.removeClass('selected');
        n.addClass('selected'); selectedNode = n;
        showDetail(card.path);
      });
      div.addEventListener('dblclick', function() { drillInto(card.path); });
      tree.appendChild(div);
    });

    // 新建按钮
    var add = document.createElement('div');
    add.style.cssText = 'padding:6px 14px';
    add.innerHTML = '<button onclick="addCardPrompt()" style="width:100%;height:28px;border:1.5px dashed #ccc;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;color:#999">＋ 新建卡片</button>';
    tree.appendChild(add);
  });
}
