/**
 * localStorage 持久化存储
 */
var STORAGE_KEY = 'topomind-save-v1';
var saveTimer = null;

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function() {
    try {
      var state = {
        nodes: cy.nodes().map(function(n) {
          return { data: Object.assign({}, n.data()), position: Object.assign({}, n.position()), classes: 'card' };
        }),
        edges: cy.edges().map(function(e) {
          return { data: { id: e.id(), source: e.source().id(), target: e.target().id(), relation: e.data('relation'), weight: e.data('weight') } };
        }),
        markdown: Object.assign({}, MD),
        colors: Object.assign({}, DOMAIN_COLORS),
        view: { zoom: cy.zoom(), pan: cy.pan(), currentRoom: currentRoom, roomHistory: roomHistory.slice() }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      showSaveIndicator();
    } catch (e) { /* quota exceeded */ }
  }, 300);
}

function loadState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    var state = JSON.parse(raw);
    if (!state.nodes || !state.nodes.length) return false;
    cy.elements().remove();
    Object.keys(MD).forEach(function(k) { delete MD[k]; });
    if (state.colors) Object.assign(DOMAIN_COLORS, state.colors);
    state.nodes.forEach(function(n) {
      var ele = cy.add({ group: 'nodes', data: n.data, classes: n.classes || 'card' });
      if (n.position && n.position.x !== undefined) ele.position(n.position);
    });
    if (state.edges) state.edges.forEach(function(e) { cy.add({ group: 'edges', data: e.data }); });
    if (state.markdown) Object.assign(MD, state.markdown);
    if (state.view) { currentRoom = state.view.currentRoom || null; roomHistory = state.view.roomHistory || []; }
    return true;
  } catch (e) { return false; }
}

function clearSavedState() { localStorage.removeItem(STORAGE_KEY); }

function showSaveIndicator() {
  var el = document.getElementById('save-indicator');
  if (!el) return;
  el.classList.add('visible');
  setTimeout(function() { el.classList.remove('visible'); }, 1200);
}
