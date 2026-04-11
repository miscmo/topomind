/**
 * Git IPC 前端调用封装
 * 镜像 fs-backend.js 风格（var/IIFE），业务层通过 GitBackend.xxx() 调用
 */
var GitBackend = (function() {
  var api = window.electronAPI;

  function invoke(channel) {
    var args = Array.prototype.slice.call(arguments, 1);
    return api.invoke.apply(api, [channel].concat(args));
  }

  return {
    checkAvailable:    function()             { return invoke('git:checkAvailable'); },
    init:              function(kbPath)        { return invoke('git:init', kbPath); },
    status:            function(kbPath)        { return invoke('git:status', kbPath); },
    statusBatch:       function(kbPaths)       { return invoke('git:statusBatch', kbPaths); },
    isDirty:           function(kbPath)        { return invoke('git:isDirty', kbPath); },
    commit:            function(kbPath, msg)   { return invoke('git:commit', kbPath, msg); },
    diff:              function(kbPath, opts)  { return invoke('git:diff', kbPath, opts); },
    diffFiles:         function(kbPath, opts)  { return invoke('git:diffFiles', kbPath, opts); },
    log:               function(kbPath, opts)  { return invoke('git:log', kbPath, opts); },
    commitDiffFiles:   function(kbPath, hash)  { return invoke('git:commitDiffFiles', kbPath, hash); },
    commitFileDiff:    function(kbPath, hash, fp) { return invoke('git:commitFileDiff', kbPath, hash, fp); },
    remoteGet:         function(kbPath)        { return invoke('git:remote:get', kbPath); },
    remoteSet:         function(kbPath, url)   { return invoke('git:remote:set', kbPath, url); },
    fetch:             function(kbPath)        { return invoke('git:fetch', kbPath); },
    push:              function(kbPath)        { return invoke('git:push', kbPath); },
    pull:              function(kbPath)        { return invoke('git:pull', kbPath); },
    conflictList:      function(kbPath)        { return invoke('git:conflict:list', kbPath); },
    conflictShow:      function(kbPath, fp)    { return invoke('git:conflict:show', kbPath, fp); },
    conflictResolve:   function(kbPath, fp, c) { return invoke('git:conflict:resolve', kbPath, fp, c); },
    conflictComplete:  function(kbPath)        { return invoke('git:conflict:complete', kbPath); },
    authSetToken:      function(kbPath, token) { return invoke('git:auth:setToken', kbPath, token); },
    authGetSSHKey:     function()              { return invoke('git:auth:getSSHKey'); },
    authSetType:       function(kbPath, type)  { return invoke('git:auth:setAuthType', kbPath, type); },
    authGetType:       function(kbPath)        { return invoke('git:auth:getAuthType', kbPath); },
  };
})();

/**
 * Git 状态内存缓存
 * 避免每次刷新都调用 IPC（git status 有一定开销）
 */
var GitStore = (function() {
  var _cache = {};       // kbPath -> { status, timestamp }
  var _dirty = {};       // kbPath -> boolean（有未提交变更）
  var _listeners = [];   // 状态变化监听器
  var CACHE_TTL = 30000; // 30秒缓存

  function markDirty(kbPath) {
    if (!kbPath) return;
    _dirty[kbPath] = true;
    // 如果缓存存在，更新 state 为 dirty
    if (_cache[kbPath]) {
      _cache[kbPath].status.state = 'dirty';
      _cache[kbPath].status.hasUncommitted = true;
    }
    _notifyListeners(kbPath);
  }

  function markClean(kbPath) {
    _dirty[kbPath] = false;
    _notifyListeners(kbPath);
  }

  function setStatus(kbPath, status) {
    _cache[kbPath] = { status: status, timestamp: Date.now() };
    if (status.hasUncommitted || status.state === 'dirty') {
      _dirty[kbPath] = true;
    }
    _notifyListeners(kbPath);
  }

  function getStatus(kbPath) {
    var cached = _cache[kbPath];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.status;
    }
    return null;
  }

  function invalidate(kbPath) {
    delete _cache[kbPath];
  }

  function onStatusChange(fn) {
    _listeners.push(fn);
    return function() {
      var idx = _listeners.indexOf(fn);
      if (idx !== -1) _listeners.splice(idx, 1);
    };
  }

  function _notifyListeners(kbPath) {
    var status = _cache[kbPath] ? _cache[kbPath].status : null;
    _listeners.forEach(function(fn) {
      try { fn(kbPath, status); } catch (e) {}
    });
  }

  return {
    markDirty: markDirty,
    markClean: markClean,
    isDirty: function(kbPath) { return !!_dirty[kbPath]; },
    setStatus: setStatus,
    getStatus: getStatus,
    invalidate: invalidate,
    onStatusChange: onStatusChange,
  };
})();
