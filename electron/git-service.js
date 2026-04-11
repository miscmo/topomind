/**
 * Git 操作服务（主进程）
 * 封装 simple-git，提供知识库级别的 Git 能力
 */
const { simpleGit } = require('simple-git');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// ===== Git 可用性检测 =====

let _gitAvailable = null;

async function checkGitAvailable() {
  if (_gitAvailable !== null) return _gitAvailable;
  try {
    await new Promise(function(resolve, reject) {
      execFile('git', ['--version'], { timeout: 5000 }, function(err, stdout) {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
    _gitAvailable = true;
  } catch (e) {
    _gitAvailable = false;
  }
  return _gitAvailable;
}

// ===== 工具函数 =====

/** 超时包装 */
function withTimeout(promise, ms, operation) {
  var timeout = new Promise(function(_, reject) {
    setTimeout(function() {
      reject(new Error((operation || 'git') + ' 超时（' + (ms / 1000) + 's）'));
    }, ms);
  });
  return Promise.race([promise, timeout]);
}

/** 绝对路径 → git 用的 posix 路径（Windows 兼容） */
function toGitPath(p) {
  return p.split(path.sep).join('/');
}

/** 创建 simple-git 实例 */
function sg(absPath, env) {
  return simpleGit(absPath).env(Object.assign({}, process.env, env || {}));
}

// ===== 初始化 =====

/**
 * 初始化知识库 Git 仓库
 * @param {string} absKbPath 知识库绝对路径
 */
async function initRepo(absKbPath) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  var git = sg(absKbPath);
  var isRepo = await git.checkIsRepo().catch(function() { return false; });
  if (isRepo) return { ok: true, alreadyInit: true };

  // git init
  await git.init();

  // .gitignore
  var gitignorePath = path.join(absKbPath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, [
      '# TopoMind auto-generated',
      '.DS_Store',
      'Thumbs.db',
      '*.tmp',
      '.git-credentials',
    ].join('\n'), 'utf-8');
  }

  // 初始 commit
  await git.add('.');
  var status = await git.status();
  if (!status.isClean()) {
    await git.commit('init: initialize TopoMind knowledge base');
  }

  return { ok: true, alreadyInit: false };
}

// ===== 状态检测 =====

/**
 * 获取知识库 Git 状态
 * @param {string} absKbPath 知识库绝对路径
 * @returns {{ state, ahead, behind, hasUncommitted, dirtyFiles, conflictFiles }}
 */
async function getStatus(absKbPath) {
  var available = await checkGitAvailable();
  if (!available) return { state: 'git-unavailable', ahead: 0, behind: 0 };

  var git = sg(absKbPath);

  // 检查是否是 git 仓库
  var isRepo = await git.checkIsRepo().catch(function() { return false; });
  if (!isRepo) return { state: 'uninit', ahead: 0, behind: 0 };

  // 检查是否有提交历史
  var hasCommits = await git.raw(['rev-list', '--count', 'HEAD'])
    .then(function(o) { return parseInt(o.trim()) > 0; })
    .catch(function() { return false; });

  if (!hasCommits) return { state: 'uninit', ahead: 0, behind: 0 };

  // 工作区状态
  var status = await git.status();
  var conflictFiles = status.conflicted || [];
  var dirtyFiles = status.files.length;
  var hasUncommitted = !status.isClean();

  // 冲突优先
  if (conflictFiles.length > 0) {
    return { state: 'conflict', ahead: 0, behind: 0, hasUncommitted: true,
             dirtyFiles: dirtyFiles, conflictFiles: conflictFiles };
  }

  // 有未提交变更
  if (hasUncommitted) {
    // 还要检查 ahead/behind（可能同时有未提交和落后远程）
    var remoteState = await _getRemoteState(git);
    return Object.assign({ state: 'dirty', dirtyFiles: dirtyFiles,
                           hasUncommitted: true, conflictFiles: [] }, remoteState);
  }

  // 检查远程
  var remotes = await git.getRemotes(false).catch(function() { return []; });
  if (remotes.length === 0) {
    return { state: 'no-remote', ahead: 0, behind: 0, hasUncommitted: false,
             dirtyFiles: 0, conflictFiles: [] };
  }

  // 检查 tracking branch
  var tracking = await git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    .catch(function() { return ''; });
  if (!tracking.trim()) {
    return { state: 'no-remote', ahead: 0, behind: 0, hasUncommitted: false,
             dirtyFiles: 0, conflictFiles: [] };
  }

  var remoteState = await _getRemoteState(git);
  var state;
  if (remoteState.ahead > 0 && remoteState.behind > 0) state = 'diverged';
  else if (remoteState.ahead > 0) state = 'ahead';
  else if (remoteState.behind > 0) state = 'behind';
  else state = 'clean';

  return Object.assign({ state: state, hasUncommitted: false,
                         dirtyFiles: 0, conflictFiles: [] }, remoteState);
}

async function _getRemoteState(git) {
  var ahead = 0, behind = 0;
  try {
    var out = await git.raw(['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
    var parts = out.trim().split(/\s+/);
    ahead = parseInt(parts[0]) || 0;
    behind = parseInt(parts[1]) || 0;
  } catch (e) {
    // 无远程分支时忽略
  }
  return { ahead: ahead, behind: behind };
}

/**
 * 批量获取多个知识库状态（并发 3）
 * @param {string[]} absKbPaths
 */
async function getStatusBatch(absKbPaths) {
  var results = {};
  var CONCURRENCY = 3;
  for (var i = 0; i < absKbPaths.length; i += CONCURRENCY) {
    var chunk = absKbPaths.slice(i, i + CONCURRENCY);
    var chunkResults = await Promise.allSettled(
      chunk.map(function(p) {
        return getStatus(p).then(function(s) { return [p, s]; });
      })
    );
    chunkResults.forEach(function(r) {
      if (r.status === 'fulfilled') {
        results[r.value[0]] = r.value[1];
      }
    });
  }
  return results;
}

/**
 * 快速检测是否有未提交变更（不检测远程，比 getStatus 快）
 */
async function isDirty(absKbPath) {
  var available = await checkGitAvailable();
  if (!available) return false;
  var git = sg(absKbPath);
  var isRepo = await git.checkIsRepo().catch(function() { return false; });
  if (!isRepo) return false;
  var status = await git.status().catch(function() { return { isClean: function() { return true; } }; });
  return !status.isClean();
}

// ===== 提交 =====

/**
 * 生成 commit message
 */
function generateCommitMessage(kbName, status) {
  var created = (status.not_added || []).filter(function(f) { return f.endsWith('README.md'); });
  var deleted = (status.deleted || []).filter(function(f) { return f.endsWith('README.md'); });
  var modified = status.modified || [];
  var renamed = status.renamed || [];

  // 新增卡片
  if (created.length > 0 && deleted.length === 0) {
    if (created.length === 1) {
      var name = created[0].split('/').slice(-2, -1)[0] || created[0];
      return 'feat: 新增「' + name + '」';
    }
    return 'feat: 新增 ' + created.length + ' 张卡片';
  }

  // 删除卡片
  if (deleted.length > 0 && created.length === 0) {
    if (deleted.length === 1) {
      var name = deleted[0].split('/').slice(-2, -1)[0] || deleted[0];
      return 'chore: 删除「' + name + '」';
    }
    return 'chore: 删除 ' + deleted.length + ' 张卡片';
  }

  // 仅更新文档
  var onlyDocs = (status.files || []).every(function(f) {
    return f.path.endsWith('README.md');
  });
  if (onlyDocs && modified.length > 0) {
    var docNames = modified.slice(0, 2).map(function(f) {
      return '「' + (f.split('/').slice(-2, -1)[0] || f) + '」';
    });
    var suffix = modified.length > 2 ? ' 等 ' + modified.length + ' 个' : '';
    return 'docs: 更新 ' + docNames.join('、') + suffix;
  }

  // 仅调整布局（_meta.json）
  var onlyMeta = (status.files || []).every(function(f) {
    return f.path.endsWith('_meta.json');
  });
  if (onlyMeta) {
    var count = (status.files || []).length;
    return 'chore: 调整节点布局（' + count + ' 处）';
  }

  // 重命名
  if (renamed.length > 0) {
    var r = renamed[0];
    var fromName = (r.from || '').split('/').slice(-2, -1)[0] || r.from;
    var toName = (r.to || '').split('/').slice(-2, -1)[0] || r.to;
    return 'refactor: 重命名「' + fromName + '」→「' + toName + '」';
  }

  // 混合修改
  var parts = [];
  if ((status.not_added || []).length) parts.push('+' + status.not_added.length);
  if (modified.length) parts.push('~' + modified.length);
  if ((status.deleted || []).length) parts.push('-' + status.deleted.length);
  return 'update: ' + parts.join(' ') + ' 个文件';
}

/**
 * 提交当前变更
 * @param {string} absKbPath
 * @param {string} [message] 留空则自动生成
 */
async function commit(absKbPath, message) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  var git = sg(absKbPath);
  var isRepo = await git.checkIsRepo().catch(function() { return false; });
  if (!isRepo) return { ok: false, code: 'NOT_GIT_REPO', error: '尚未初始化 Git，请先初始化。' };

  var status = await git.status();
  if (status.isClean()) return { ok: true, skipped: true, message: '无变更可提交' };

  var kbName = path.basename(absKbPath);
  var msg = message || generateCommitMessage(kbName, status);

  await git.add('.');
  var result = await git.commit(msg);
  return { ok: true, hash: result.commit, message: msg };
}

// ===== Diff / Log =====

/**
 * 获取 diff 文本
 * @param {string} absKbPath
 * @param {{ from?, to?, file? }} opts
 */
async function getDiff(absKbPath, opts) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  opts = opts || {};
  var git = sg(absKbPath);

  var args = [];
  if (opts.from && opts.to) {
    args.push(opts.from + '..' + opts.to);
  } else {
    // 工作区（包含 untracked）vs HEAD
    args.push('HEAD');
  }
  if (opts.file) args.push('--', toGitPath(opts.file));

  var diffText = await git.diff(args).catch(function() { return ''; });

  // 如果是工作区 diff，还要包含未暂存的新文件
  if (!opts.from && !opts.to) {
    var untrackedDiff = await git.diff(['--cached'].concat(args.slice(1))).catch(function() { return ''; });
    diffText = (untrackedDiff + '\n' + diffText).trim();
  }

  return { ok: true, diff: diffText };
}

/**
 * 获取 diff --stat（文件级别摘要）
 */
async function getDiffStat(absKbPath, opts) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  opts = opts || {};
  var git = sg(absKbPath);
  var args = ['--stat'];
  if (opts.from && opts.to) {
    args.unshift(opts.from + '..' + opts.to);
  } else {
    args.unshift('HEAD');
  }

  var stat = await git.diff(args).catch(function() { return ''; });
  // 还要加上暂存的
  var statCached = await git.diff(['--cached', '--stat', opts.from || 'HEAD'])
    .catch(function() { return ''; });

  return { ok: true, stat: (statCached + '\n' + stat).trim() };
}

/**
 * 获取变更文件列表（结构化）
 * @returns {{ path, insertions, deletions, isNew, isDeleted, isMeta, isImage }[]}
 */
async function getDiffFiles(absKbPath, opts) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  opts = opts || {};
  var git = sg(absKbPath);

  var args = ['--numstat'];
  if (opts.from && opts.to) {
    args.unshift(opts.from + '..' + opts.to);
  } else {
    args.unshift('HEAD');
  }

  // 工作区（已跟踪文件）
  var numstat = await git.diff(args).catch(function() { return ''; });
  // 暂存区
  var numstatCached = await git.diff(['--cached', '--numstat', opts.from || 'HEAD'])
    .catch(function() { return ''; });

  var combined = (numstatCached + '\n' + numstat).trim();
  if (!combined) return { ok: true, files: [] };

  var files = [];
  var seen = {};
  combined.split('\n').forEach(function(line) {
    line = line.trim();
    if (!line) return;
    var parts = line.split('\t');
    if (parts.length < 3) return;
    var ins = parseInt(parts[0]) || 0;
    var del = parseInt(parts[1]) || 0;
    var fp = parts[2];
    if (seen[fp]) {
      seen[fp].insertions += ins;
      seen[fp].deletions += del;
      return;
    }
    var fileInfo = {
      path: fp,
      insertions: ins,
      deletions: del,
      isMeta: fp.endsWith('_meta.json'),
      isDoc: fp.endsWith('README.md'),
      isImage: /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(fp),
    };
    seen[fp] = fileInfo;
    files.push(fileInfo);
  });

  // 未追踪的新文件
  var status = await git.status();
  (status.not_added || []).forEach(function(fp) {
    if (!seen[fp]) {
      var fileInfo = {
        path: fp,
        insertions: 0,
        deletions: 0,
        isNew: true,
        isMeta: fp.endsWith('_meta.json'),
        isDoc: fp.endsWith('README.md'),
        isImage: /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(fp),
      };
      seen[fp] = fileInfo;
      files.push(fileInfo);
    }
  });

  return { ok: true, files: files };
}

/**
 * 获取提交历史
 */
async function getLog(absKbPath, opts) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  opts = opts || {};
  var git = sg(absKbPath);

  var isRepo = await git.checkIsRepo().catch(function() { return false; });
  if (!isRepo) return { ok: true, commits: [] };

  var hasCommits = await git.raw(['rev-list', '--count', 'HEAD'])
    .then(function(o) { return parseInt(o.trim()) > 0; })
    .catch(function() { return false; });
  if (!hasCommits) return { ok: true, commits: [] };

  var log = await git.log({ maxCount: opts.limit || 20 });
  return {
    ok: true,
    commits: (log.all || []).map(function(c) {
      return {
        hash: c.hash,
        shortHash: c.hash.slice(0, 7),
        message: c.message,
        date: c.date,
        author: c.author_name,
      };
    })
  };
}

/**
 * 获取特定 commit 与其父提交的 diff 文件列表
 */
async function getCommitDiffFiles(absKbPath, hash) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  var git = sg(absKbPath);
  var numstat = await git.raw(['diff', '--numstat', hash + '^', hash])
    .catch(function() {
      // 初始 commit 没有父提交
      return git.raw(['show', '--numstat', '--format=', hash]).catch(function() { return ''; });
    });

  var files = [];
  (numstat || '').trim().split('\n').forEach(function(line) {
    line = line.trim();
    if (!line) return;
    var parts = line.split('\t');
    if (parts.length < 3) return;
    files.push({
      path: parts[2],
      insertions: parseInt(parts[0]) || 0,
      deletions: parseInt(parts[1]) || 0,
      isMeta: parts[2].endsWith('_meta.json'),
      isDoc: parts[2].endsWith('README.md'),
      isImage: /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(parts[2]),
    });
  });

  return { ok: true, files: files };
}

/**
 * 获取特定 commit 与其父提交的某文件 diff
 */
async function getCommitFileDiff(absKbPath, hash, filePath) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  var git = sg(absKbPath);
  var diffText = await git.raw(['diff', hash + '^', hash, '--', toGitPath(filePath)])
    .catch(function() {
      return git.raw(['show', hash, '--', toGitPath(filePath)]).catch(function() { return ''; });
    });

  return { ok: true, diff: diffText };
}

// ===== 远程仓库 =====

/**
 * 获取远程仓库 URL
 */
async function getRemote(absKbPath) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  var git = sg(absKbPath);
  var remotes = await git.getRemotes(true).catch(function() { return []; });
  var origin = remotes.find(function(r) { return r.name === 'origin'; });
  return { ok: true, url: origin ? (origin.refs.fetch || origin.refs.push || '') : '' };
}

/**
 * 设置/更新远程仓库 URL
 */
async function setRemote(absKbPath, url) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  var git = sg(absKbPath);
  var remotes = await git.getRemotes(false).catch(function() { return []; });
  var hasOrigin = remotes.some(function(r) { return r.name === 'origin'; });
  if (hasOrigin) {
    await git.remote(['set-url', 'origin', url]);
  } else {
    await git.addRemote('origin', url);
  }
  return { ok: true };
}

/**
 * fetch 远程（只更新本地远程追踪分支，不合并）
 */
async function fetchRemote(absKbPath, env) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  var git = sg(absKbPath, env || {});
  try {
    await withTimeout(git.fetch(), 15000, 'git fetch');
    return { ok: true };
  } catch (e) {
    if (e.message.includes('超时')) return { ok: false, code: 'TIMEOUT', error: e.message };
    if (/Authentication|authentication|auth/i.test(e.message)) {
      return { ok: false, code: 'AUTH_FAILED', error: '认证失败，请检查 Token 是否有效。' };
    }
    return { ok: false, code: 'FETCH_ERROR', error: e.message };
  }
}

/**
 * 推送到远程
 */
async function push(absKbPath, env) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  var git = sg(absKbPath, env || {});
  try {
    // 动态获取当前分支名
    var branch = await git.raw(['symbolic-ref', '--short', 'HEAD'])
      .then(function(b) { return b.trim(); })
      .catch(function() { return 'main'; });

    await withTimeout(
      git.push('origin', branch, ['--set-upstream']),
      60000, 'git push'
    );
    return { ok: true };
  } catch (e) {
    if (e.message.includes('超时')) return { ok: false, code: 'TIMEOUT', error: e.message };
    if (/rejected|non-fast-forward/i.test(e.message)) {
      return { ok: false, code: 'PUSH_REJECTED', error: '推送被拒绝，远程有新提交，请先拉取再推送。' };
    }
    if (/Authentication|authentication|auth/i.test(e.message)) {
      return { ok: false, code: 'AUTH_FAILED', error: '认证失败，请检查 Token 或 SSH 密钥。' };
    }
    return { ok: false, code: 'PUSH_ERROR', error: e.message };
  }
}

/**
 * 从远程拉取
 */
async function pull(absKbPath, env) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  var git = sg(absKbPath, env || {});
  try {
    await withTimeout(git.pull(), 60000, 'git pull');
    return { ok: true };
  } catch (e) {
    if (e.message.includes('超时')) return { ok: false, code: 'TIMEOUT', error: e.message };
    if (/CONFLICT|conflict/i.test(e.message)) {
      return { ok: false, code: 'CONFLICT', error: '拉取后出现冲突，请手动解决。' };
    }
    if (/Authentication|authentication|auth/i.test(e.message)) {
      return { ok: false, code: 'AUTH_FAILED', error: '认证失败，请检查 Token 或 SSH 密钥。' };
    }
    return { ok: false, code: 'PULL_ERROR', error: e.message };
  }
}

// ===== 冲突解决 =====

/**
 * 获取冲突文件列表
 */
async function getConflictList(absKbPath) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  var git = sg(absKbPath);
  var status = await git.status();
  return { ok: true, files: status.conflicted || [] };
}

/**
 * 获取冲突文件的三个版本
 * @returns {{ ours, theirs, current, isBinary }}
 */
async function getConflictContent(absKbPath, filePath) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  var git = sg(absKbPath);
  var gitFp = toGitPath(filePath);
  var absFilePath = path.join(absKbPath, filePath);

  // 检测是否为二进制文件
  var isBinary = /\.(png|jpg|jpeg|gif|webp|svg|pdf|zip|mp4|mp3)$/i.test(filePath);

  var ours = '', theirs = '', current = '';

  if (!isBinary) {
    ours = await git.show(['HEAD:' + gitFp]).catch(function() { return ''; });
    theirs = await git.show(['MERGE_HEAD:' + gitFp]).catch(function() { return ''; });
    current = await new Promise(function(resolve) {
      fs.readFile(absFilePath, 'utf-8', function(err, data) {
        resolve(err ? '' : data);
      });
    });
  }

  return { ok: true, ours: ours, theirs: theirs, current: current, isBinary: isBinary };
}

/**
 * 写入冲突解决结果并 git add
 */
async function resolveConflict(absKbPath, filePath, resolvedContent) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  var absFilePath = path.join(absKbPath, filePath);
  fs.writeFileSync(absFilePath, resolvedContent, 'utf-8');

  var git = sg(absKbPath);
  await git.add(toGitPath(filePath));
  return { ok: true };
}

/**
 * 完成冲突解决（创建 merge commit）
 */
async function completeConflictResolution(absKbPath) {
  var available = await checkGitAvailable();
  if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };

  var git = sg(absKbPath);
  // 检查是否还有冲突
  var status = await git.status();
  if (status.conflicted.length > 0) {
    return { ok: false, code: 'STILL_CONFLICTED', error: '还有 ' + status.conflicted.length + ' 个文件未解决。' };
  }
  var result = await git.commit('merge: resolve conflicts manually');
  return { ok: true, hash: result.commit };
}

/**
 * 自动合并 _meta.json 冲突
 */
function autoMergeMetaJson(oursStr, theirsStr) {
  try {
    var ours = JSON.parse(oursStr);
    var theirs = JSON.parse(theirsStr);

    // children：本地优先，远程新增节点补充
    var mergedChildren = Object.assign({}, theirs.children || {}, ours.children || {});

    // edges：取并集
    var edgeMap = {};
    function addEdges(edges) {
      (edges || []).forEach(function(e) {
        var key = (e.source || e.from) + '::' + (e.target || e.to);
        if (!edgeMap[key]) edgeMap[key] = e;
      });
    }
    addEdges(theirs.edges);
    addEdges(ours.edges);
    var mergedEdges = Object.values(edgeMap);

    // canvasBounds：取较大值
    var cb = ours.canvasBounds || theirs.canvasBounds || null;
    if (ours.canvasBounds && theirs.canvasBounds) {
      cb = {
        x: Math.min(ours.canvasBounds.x, theirs.canvasBounds.x),
        y: Math.min(ours.canvasBounds.y, theirs.canvasBounds.y),
        w: Math.max(ours.canvasBounds.w, theirs.canvasBounds.w),
        h: Math.max(ours.canvasBounds.h, theirs.canvasBounds.h),
      };
    }

    var merged = Object.assign({}, theirs, ours, {
      children: mergedChildren,
      edges: mergedEdges,
      canvasBounds: cb,
      // zoom/pan 取本地
      zoom: ours.zoom !== undefined ? ours.zoom : theirs.zoom,
      pan: ours.pan !== undefined ? ours.pan : theirs.pan,
    });

    return { ok: true, merged: JSON.stringify(merged, null, 2) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  checkGitAvailable: checkGitAvailable,
  initRepo: initRepo,
  getStatus: getStatus,
  getStatusBatch: getStatusBatch,
  isDirty: isDirty,
  commit: commit,
  generateCommitMessage: generateCommitMessage,
  getDiff: getDiff,
  getDiffStat: getDiffStat,
  getDiffFiles: getDiffFiles,
  getLog: getLog,
  getCommitDiffFiles: getCommitDiffFiles,
  getCommitFileDiff: getCommitFileDiff,
  getRemote: getRemote,
  setRemote: setRemote,
  fetchRemote: fetchRemote,
  push: push,
  pull: pull,
  getConflictList: getConflictList,
  getConflictContent: getConflictContent,
  resolveConflict: resolveConflict,
  completeConflictResolution: completeConflictResolution,
  autoMergeMetaJson: autoMergeMetaJson,
};
