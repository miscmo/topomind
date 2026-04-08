/**
 * 全局状态和配置常量
 */
var selectedNode = null;
var edgeMode = false, edgeModeSource = null;
var currentRoom = null;
var roomHistory = [];
var autoIdCounter = Date.now();
var edgeIdCounter = 100;

function autoId(prefix) { return (prefix || 'n') + '-' + (autoIdCounter++).toString(36); }
function nextEdgeId() { return 'e' + (edgeIdCounter++); }
