/**
 * 主页 - 知识库管理
 */

var currentEditingKB = null; // 当前编辑的知识库
var allKBs = []; // 所有知识库缓存

// ===================== 主页显示/隐藏 =====================

function showHome() {
  document.getElementById('home-modal').style.display = 'flex';
  loadAllKBs();
}

function hideHome() {
  document.getElementById('home-modal').style.display = 'none';
}

// ===================== 知识库 CRUD =====================

/** 加载所有知识库 */
function loadAllKBs() {
  dbGetAll('knowledgebases').then(function(kbs) {
    allKBs = kbs;
    renderKBGrid(kbs);
  });
}

/** 渲染知识库网格 */
function renderKBGrid(kbs) {
  var grid = document.getElementById('home-grid');
  var empty = document.getElementById('home-empty');
  
  if (!kbs || kbs.length === 0) {
    grid.innerHTML = '';
    empty.style.display = '';
    return;
  }
  
  empty.style.display = 'none';
  
  var html = '';
  kbs.forEach(function(kb) {
    var imgHtml = kb.image 
      ? '<img src="' + kb.image + '" alt="' + kb.name + '">' 
      : '📚';
    var date = kb.updatedAt ? formatDate(kb.updatedAt) : '';
    var nodeCount = kb.nodeCount || 0;
    var docCount = kb.docCount || 0;
    
    html += '<div class="home-card" data-id="' + kb.id + '" ondblclick="openKB(\'' + kb.id + '\')">';
    html += '  <div class="home-card-image">' + imgHtml + '</div>';
    html += '  <div class="home-card-body">';
    html += '    <div class="home-card-title">';
    html += '      <span>' + escapeHtml(kb.name) + '</span>';
    html += '      <div class="home-card-actions">';
    html += '        <button class="home-card-action-btn" onclick="event.stopPropagation(); editKB(\'' + kb.id + '\')" title="编辑">✏</button>';
    html += '        <button class="home-card-action-btn danger" onclick="event.stopPropagation(); deleteKB(\'' + kb.id + '\')" title="删除">🗑</button>';
    html += '      </div>';
    html += '    </div>';
    html += '    <div class="home-card-desc">' + escapeHtml(kb.description || '暂无简介') + '</div>';
    html += '    <div class="home-card-meta">';
    html += '      <span>📊 ' + nodeCount + ' 节点</span>';
    html += '      <span>📄 ' + docCount + ' 文档</span>';
    if (date) html += '      <span>🕐 ' + date + '</span>';
    html += '    </div>';
    html += '  </div>';
    html += '</div>';
  });
  
  // 添加新建卡片
  html += '<div class="home-card home-card-add" onclick="showKBForm()">';
  html += '  <div class="home-card-add-icon">➕</div>';
  html += '  <div class="home-card-add-text">创建新知识库</div>';
  html += '</div>';
  
  grid.innerHTML = html;
}

/** 显示知识库表单 */
function showKBForm(kb) {
  currentEditingKB = kb || null;
  var overlay = document.getElementById('home-form-overlay');
  var form = document.getElementById('home-form-kb');
  var title = document.getElementById('home-form-title');
  
  if (kb) {
    title.textContent = '编辑知识库';
    form.name.value = kb.name || '';
    form.description.value = kb.description || '';
    if (kb.image) {
      document.querySelector('.home-image-upload').classList.add('has-image');
      document.querySelector('.home-image-upload img').src = kb.image;
    }
  } else {
    title.textContent = '新建知识库';
    form.reset();
    document.querySelector('.home-image-upload').classList.remove('has-image');
    var uploadImg = document.querySelector('.home-image-upload img');
    if (uploadImg) uploadImg.src = '';
  }
  
  overlay.classList.add('active');
}

function hideKBForm() {
  document.getElementById('home-form-overlay').classList.remove('active');
  currentEditingKB = null;
}

/** 保存知识库 */
function saveKB() {
  var form = document.getElementById('home-form-kb');
  var name = form.name.value.trim();
  var description = form.description.value.trim();
  var imageEl = document.querySelector('.home-image-upload img');
  var image = (imageEl && imageEl.src && !imageEl.src.endsWith('undefined')) ? imageEl.src : '';
  
  if (!name) {
    alert('请输入知识库名称');
    return;
  }
  
  var kb = {
    name: name,
    description: description,
    image: image,
    updatedAt: Date.now()
  };
  
  if (currentEditingKB) {
    // 更新
    kb.id = currentEditingKB.id;
    kb.createdAt = currentEditingKB.createdAt;
    dbPut('knowledgebases', kb).then(function() {
      hideKBForm();
      loadAllKBs();
    });
  } else {
    // 新建
    kb.id = 'kb-' + autoId('k');
    kb.createdAt = Date.now();
    dbPut('knowledgebases', kb).then(function() {
      hideKBForm();
      loadAllKBs();
    });
  }
}

/** 编辑知识库 */
function editKB(kbId) {
  var kb = allKBs.find(function(k) { return k.id === kbId; });
  if (kb) showKBForm(kb);
}

/** 删除知识库 */
function deleteKB(kbId) {
  var kb = allKBs.find(function(k) { return k.id === kbId; });
  if (!kb) return;

  if (!confirm('确定要删除知识库「' + kb.name + '」吗？\n\n注意：此操作将同时删除该知识库中的所有节点、文档和图片，且不可恢复。')) {
    return;
  }

  // 只删除属于该知识库的记录
  Promise.all([
    dbGetAll('nodes'),
    dbGetAll('edges'),
    dbGetAll('markdown'),
    dbGetAll('images')
  ]).then(function(results) {
    var tasks = [];
    (results[0] || []).forEach(function(n) { if (n.kbId === kbId) tasks.push(dbDelete('nodes', n.id)); });
    (results[1] || []).forEach(function(e) { if (e.kbId === kbId) tasks.push(dbDelete('edges', e.id)); });
    (results[2] || []).forEach(function(d) { if (d.kbId === kbId) tasks.push(dbDelete('markdown', d.id)); });
    (results[3] || []).forEach(function(i) { if (i.kbId === kbId) tasks.push(dbDelete('images', i.id)); });
    tasks.push(dbDelete('knowledgebases', kbId));
    return Promise.all(tasks);
  }).then(function() {
    loadAllKBs();
  });
}

/** 双击打开知识库 */
function openKB(kbId) {
  var kb = allKBs.find(function(k) { return k.id === kbId; });
  if (!kb) return;
  
  // 保存当前知识库ID到meta
  dbPut('meta', { key: 'currentKB', value: kbId }).then(function() {
    // 隐藏主页，显示图谱
    hideHome();
    // 初始化该知识库的数据
    initKBGraph(kbId);
  });
}

/** 初始化知识库图谱数据 */
function initKBGraph(kbId) {
  // 先清除当前图谱
  if (typeof cy !== 'undefined' && cy) {
    cy.elements().remove();
  }

  // 从 nodes/edges store 中按 kbId 过滤
  Promise.all([
    dbGetAll('nodes'),
    dbGetAll('edges')
  ]).then(function(results) {
    var nodes = (results[0] || []).filter(function(n) { return n.kbId === kbId; });
    var edges = (results[1] || []).filter(function(e) { return e.kbId === kbId; });

    if (nodes.length === 0) {
      // 空知识库，加载默认种子数据
      seedKBDefaultData(kbId).then(function() {
        loadKBGraph(kbId);
      });
    } else {
      loadKBGraph(kbId);
    }
  });
}

/** 加载知识库图谱 */
function loadKBGraph(kbId) {
  Promise.all([
    dbGetAll('nodes'),
    dbGetAll('edges')
  ]).then(function(results) {
    var nodes = (results[0] || []).filter(function(n) { return n.kbId === kbId; });
    var edges = (results[1] || []).filter(function(e) { return e.kbId === kbId; });

    if (typeof cy !== 'undefined' && cy) {
      cy.elements().remove();

      nodes.forEach(function(n) {
        var data = { id: n.id, label: n.label, level: n.level };
        if (n.parent) data.parent = n.parent;
        var ele = cy.add({ group: 'nodes', data: data, classes: 'card' });
        if (n.posX !== undefined && n.posY !== undefined) {
          ele.position({ x: n.posX, y: n.posY });
        }
      });

      edges.forEach(function(e) {
        cy.add({ group: 'edges', data: {
          id: e.id,
          source: e.source,
          target: e.target,
          relation: e.relation || '相关',
          weight: e.weight || 'minor'
        }});
      });

      if (typeof applyLayout === 'function') {
        applyLayout();
      }
    }
  });
}

/** 保存知识库图谱状态 */
function saveKBGraphState(kbId) {
  if (!kbId || !db) return;
  clearTimeout(_saveGraphTimer);
  _saveGraphTimer = setTimeout(function() {
    _doSaveKBGraph(kbId);
  }, 300);
}

function _doSaveKBGraph(kbId) {
  if (!db || !cy) return;
  try {
    var nodes = cy.nodes().map(function(n) {
      return { id: n.id(), kbId: kbId, label: n.data('label'), level: n.data('level'), parent: n.data('parent') || '', posX: n.position().x, posY: n.position().y };
    });
    var edges = cy.edges().map(function(e) {
      return { id: e.id(), kbId: kbId, source: e.source().id(), target: e.target().id(), relation: e.data('relation'), weight: e.data('weight') };
    });

    // 先删除该 KB 的旧记录，再写入新记录
    Promise.all([
      dbGetAll('nodes'),
      dbGetAll('edges')
    ]).then(function(results) {
      var delTasks = [];
      (results[0] || []).forEach(function(n) { if (n.kbId === kbId) delTasks.push(dbDelete('nodes', n.id)); });
      (results[1] || []).forEach(function(e) { if (e.kbId === kbId) delTasks.push(dbDelete('edges', e.id)); });
      return Promise.all(delTasks);
    }).then(function() {
      var putTasks = nodes.map(function(n) { return dbPut('nodes', n); })
        .concat(edges.map(function(e) { return dbPut('edges', e); }));
      return Promise.all(putTasks);
    }).then(function() {
      showSaveIndicator();
      updateKBStats(kbId);
    });
  } catch (e) {
    console.error('保存失败:', e);
  }
}

/** 更新知识库统计 */
function updateKBStats(kbId) {
  Promise.all([
    dbGetAll('nodes'),
    dbGetAll('edges')
  ]).then(function(results) {
    var nodeCount = (results[0] || []).filter(function(n) { return n.kbId === kbId; }).length;
    var edgeCount = (results[1] || []).filter(function(e) { return e.kbId === kbId; }).length;
    return dbGet('knowledgebases', kbId).then(function(kb) {
      if (kb) {
        kb.nodeCount = nodeCount;
        kb.edgeCount = edgeCount;
        kb.updatedAt = Date.now();
        return dbPut('knowledgebases', kb);
      }
    });
  });
}

/** 知识库种子数据 */
function seedKBDefaultData(kbId) {
  var nodes = [
    { id: kbId + '-root', kbId: kbId, label: '我的知识', level: 1, parent: '', posX: 0, posY: 0 },
    { id: kbId + '-idea1', kbId: kbId, label: '想法一', level: 2, parent: kbId + '-root', posX: 0, posY: 0 },
    { id: kbId + '-idea2', kbId: kbId, label: '想法二', level: 2, parent: kbId + '-root', posX: 0, posY: 0 }
  ];
  var edges = [
    { id: kbId + '-e1', kbId: kbId, source: kbId + '-root', target: kbId + '-idea1', relation: '包含', weight: 'main' },
    { id: kbId + '-e2', kbId: kbId, source: kbId + '-root', target: kbId + '-idea2', relation: '包含', weight: 'main' }
  ];
  return Promise.all(
    nodes.map(function(n) { return dbPut('nodes', n); }).concat(
    edges.map(function(e) { return dbPut('edges', e); }))
  );
}

// ===================== 返回主页 =====================

function goToHome() {
  // 保存当前图谱状态
  if (typeof _doSaveGraph === 'function') {
    _doSaveGraph();
  }
  // 显示主页
  showHome();
}

// ===================== 工具函数 =====================

function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  var d = new Date(timestamp);
  var month = d.getMonth() + 1;
  var day = d.getDate();
  return (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day;
}

// ===================== 图片上传 =====================

document.addEventListener('DOMContentLoaded', function() {
  var uploadArea = document.querySelector('.home-image-upload');
  if (uploadArea) {
    uploadArea.addEventListener('click', function() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = function() {
        if (input.files[0]) {
          var reader = new FileReader();
          reader.onload = function(e) {
            uploadArea.classList.add('has-image');
            var img = uploadArea.querySelector('img') || document.createElement('img');
            img.src = e.target.result;
            if (!uploadArea.contains(img)) {
              uploadArea.insertBefore(img, uploadArea.firstChild);
            }
          };
          reader.readAsDataURL(input.files[0]);
        }
      };
      input.click();
    });
    
    var removeBtn = uploadArea.querySelector('.home-remove-image');
    if (removeBtn) {
      removeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        uploadArea.classList.remove('has-image');
        var img = uploadArea.querySelector('img');
        if (img) img.remove();
      });
    }
  }
  
  // 表单提交
  var form = document.getElementById('home-form-kb');
  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      saveKB();
    });
  }
});
