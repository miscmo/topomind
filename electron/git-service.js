/**
 * Git Service - Git 操作服务
 * 封装知识库 Git 仓库的初始化、状态、提交、diff 和远程同步能力。
 */
import nodePath from 'path';
import nodeFs from 'fs';
import { execFile } from 'child_process';
import { simpleGit } from 'simple-git';

let _gitAvailable = null;

function _git_checkAvailable() {
  if (_gitAvailable !== null) return Promise.resolve(_gitAvailable);
  return new Promise(function(resolve) {
    execFile('git', ['--version'], { timeout: 5000 }, function(err) {
      _gitAvailable = !err;
      resolve(!err);
    });
  });
}

function _git_withTimeout(promise, ms, operation) {
  var timeout = new Promise(function(_, reject) {
    setTimeout(function() {
      reject(new Error((operation || 'git') + ' 超时（' + (ms / 1000) + 's）'));
    }, ms);
  });
  return Promise.race([promise, timeout]);
}

function _git_toGitPath(p) {
  return p.split(nodePath.sep).join('/');
}

function _git_sg(absPath, env) {
  if (!nodeFs.existsSync(absPath)) {
    throw new Error('Directory does not exist: ' + absPath);
  }
  return simpleGit(absPath).env(Object.assign({}, process.env, env || {}));
}

function _git_getRemoteState(git) {
  return git.raw(['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
    .then(function(out) {
      var parts = out.trim().split(/\s+/);
      return { ahead: parseInt(parts[0]) || 0, behind: parseInt(parts[1]) || 0 };
    })
    .catch(function() { return { ahead: 0, behind: 0 }; });
}

function _git_generateCommitMessage(kbName, status) {
  var created = (status.not_added || []).filter(function(f) { return f.endsWith('README.md'); });
  var deleted = (status.deleted || []).filter(function(f) { return f.endsWith('README.md'); });
  var modified = status.modified || [];
  var renamed = status.renamed || [];
  if (created.length > 0 && deleted.length === 0) {
    if (created.length === 1) {
      var name = created[0].split('/').slice(-2, -1)[0] || created[0];
      return 'feat: 新增「' + name + '」';
    }
    return 'feat: 新增 ' + created.length + ' 张卡片';
  }
  if (deleted.length > 0 && created.length === 0) {
    if (deleted.length === 1) {
      var name2 = deleted[0].split('/').slice(-2, -1)[0] || deleted[0];
      return 'chore: 删除「' + name2 + '」';
    }
    return 'chore: 删除 ' + deleted.length + ' 张卡片';
  }
  var onlyDocs = (status.files || []).every(function(f) { return f.nodePath.endsWith('README.md'); });
  if (onlyDocs && modified.length > 0) {
    var docNames = modified.slice(0, 2).map(function(f) { return '「' + (f.split('/').slice(-2, -1)[0] || f) + '」'; });
    var suffix = modified.length > 2 ? ' 等 ' + modified.length + ' 个' : '';
    return 'docs: 更新 ' + docNames.join('、') + suffix;
  }
  var onlyMeta = (status.files || []).every(function(f) { return f.nodePath.endsWith('_graph.json'); });
  if (onlyMeta) {
    return 'chore: 调整节点布局（' + (status.files || []).length + ' 处）';
  }
  if (renamed.length > 0) {
    var r = renamed[0];
    var fromName = (r.from || '').split('/').slice(-2, -1)[0] || r.from;
    var toName = (r.to || '').split('/').slice(-2, -1)[0] || r.to;
    return 'refactor: 重命名「' + fromName + '」→「' + toName + '」';
  }
  var parts = [];
  if ((status.not_added || []).length) parts.push('+' + status.not_added.length);
  if (modified.length) parts.push('~' + modified.length);
  if ((status.deleted || []).length) parts.push('-' + status.deleted.length);
  return 'update: ' + parts.join(' ') + ' 个文件';
}

function createGitService() {
  return {
    checkGitAvailable: function() { return _git_checkAvailable(); },

    initRepo: function(absKbPath) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        var git = _git_sg(absKbPath);
        return git.checkIsRepo().catch(function() { return false; })
          .then(function(isRepo) {
            if (isRepo) return { ok: true, alreadyInit: true };
            return git.init()
              .then(function() {
                var gitignorePath = nodePath.join(absKbPath, '.gitignore');
                if (!nodeFs.existsSync(gitignorePath)) {
                  nodeFs.writeFileSync(gitignorePath, [
                    '# TopoMind auto-generated', '.DS_Store', 'Thumbs.db', '*.tmp', '.git-credentials',
                  ].join('\n'), 'utf-8');
                }
                return git.add('.');
              })
              .then(function() { return git.status(); })
              .then(function(status) {
                if (!status.isClean()) return git.commit('init: initialize TopoMind knowledge base');
                return null;
              })
              .then(function() { return { ok: true, alreadyInit: false }; });
          });
      });
    },

    getStatus: function(absKbPath) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { state: 'git-unavailable', ahead: 0, behind: 0 };
        var git = _git_sg(absKbPath);
        return git.checkIsRepo().catch(function() { return false; })
          .then(function(isRepo) {
            if (!isRepo) return { state: 'uninit', ahead: 0, behind: 0 };
            return git.raw(['rev-list', '--count', 'HEAD'])
              .then(function(o) { return parseInt(o.trim()) > 0; })
              .catch(function() { return false; });
          })
          .then(function(hasCommits) {
            if (!hasCommits) return { state: 'uninit', ahead: 0, behind: 0 };
            return git.status().then(function(status) {
              var conflictFiles = status.conflicted || [];
              var dirtyFiles = status.files.length;
              var hasUncommitted = !status.isClean();
              if (conflictFiles.length > 0) {
                return { state: 'conflict', ahead: 0, behind: 0, hasUncommitted: true,
                         dirtyFiles: dirtyFiles, conflictFiles: conflictFiles };
              }
              if (hasUncommitted) {
                return _git_getRemoteState(git).then(function(remoteState) {
                  return Object.assign({ state: 'dirty', dirtyFiles: dirtyFiles,
                                 hasUncommitted: true, conflictFiles: [] }, remoteState);
                });
              }
              return git.getRemotes(false).catch(function() { return []; })
                .then(function(remotes) {
                  if (remotes.length === 0) {
                    return { state: 'no-remote', ahead: 0, behind: 0, hasUncommitted: false,
                             dirtyFiles: 0, conflictFiles: [] };
                  }
                  return git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
                    .catch(function() { return ''; })
                    .then(function(tracking) {
                      if (!tracking.trim()) {
                        return { state: 'no-remote', ahead: 0, behind: 0, hasUncommitted: false,
                                 dirtyFiles: 0, conflictFiles: [] };
                      }
                      return _git_getRemoteState(git).then(function(remoteState) {
                        var state;
                        if (remoteState.ahead > 0 && remoteState.behind > 0) state = 'diverged';
                        else if (remoteState.ahead > 0) state = 'ahead';
                        else if (remoteState.behind > 0) state = 'behind';
                        else state = 'clean';
                        return Object.assign({ state: state, hasUncommitted: false,
                                       dirtyFiles: 0, conflictFiles: [] }, remoteState);
                      });
                    });
                });
            });
          });
      });
    },

    getStatusBatch: function(absKbPaths) {
      var results = {};
      var CONCURRENCY = 3;
      var process = function(i) {
        if (i >= absKbPaths.length) return Promise.resolve();
        var chunk = absKbPaths.slice(i, i + CONCURRENCY);
        return Promise.allSettled(
          chunk.map(function(p) {
            return gitService.getStatus(p).then(function(s) { return [p, s]; });
          })
        ).then(function(chunkResults) {
          chunkResults.forEach(function(r) {
            if (r.status === 'fulfilled') {
              results[r.value[0]] = r.value[1];
            }
          });
          return process(i + CONCURRENCY);
        });
      };
      return process(0).then(function() { return results; });
    },

    isDirty: function(absKbPath) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return false;
        var git = _git_sg(absKbPath);
        return git.checkIsRepo().catch(function() { return false; })
          .then(function(isRepo) {
            if (!isRepo) return false;
            return git.status().catch(function() { return { isClean: function() { return true; } }; })
              .then(function(status) { return !status.isClean(); });
          });
      });
    },

    commit: function(absKbPath, message) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        var git = _git_sg(absKbPath);
        return git.checkIsRepo().catch(function() { return false; })
          .then(function(isRepo) {
            if (!isRepo) return { ok: false, code: 'NOT_GIT_REPO', error: '尚未初始化 Git，请先初始化。' };
            return git.status().then(function(status) {
              if (status.isClean()) return { ok: true, skipped: true, message: '无变更可提交' };
              var kbName = nodePath.basename(absKbPath);
              var msg = message || _git_generateCommitMessage(kbName, status);
              return git.add('.').then(function() {
                return git.commit(msg);
              }).then(function(result) {
                return { ok: true, hash: result.commit, message: msg };
              });
            });
          });
      });
    },

    getDiff: function(absKbPath, opts) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        opts = opts || {};
        var git = _git_sg(absKbPath);
        var args = [];
        if (opts.from && opts.to) {
          args.push(opts.from + '..' + opts.to);
        } else {
          args.push('HEAD');
        }
        if (opts.file) args.push('--', _git_toGitPath(opts.file));
        return git.diff(args).catch(function() { return ''; })
          .then(function(diffText) {
            if (!opts.from && !opts.to) {
              return git.diff(['--cached'].concat(args.slice(1))).catch(function() { return ''; })
                .then(function(untrackedDiff) {
                  return { ok: true, diff: (untrackedDiff + '\n' + diffText).trim() };
                });
            }
            return { ok: true, diff: diffText };
          });
      });
    },

    getDiffStat: function(absKbPath, opts) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        opts = opts || {};
        var git = _git_sg(absKbPath);
        var args = ['--stat'];
        if (opts.from && opts.to) args.unshift(opts.from + '..' + opts.to);
        else args.unshift('HEAD');
        return git.diff(args).catch(function() { return ''; })
          .then(function(stat) {
            return git.diff(['--cached', '--stat', opts.from || 'HEAD']).catch(function() { return ''; })
              .then(function(statCached) {
                return { ok: true, stat: (statCached + '\n' + stat).trim() };
              });
          });
      });
    },

    getDiffFiles: function(absKbPath, opts) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        opts = opts || {};
        var git = _git_sg(absKbPath);
        var args = ['--numstat'];
        if (opts.from && opts.to) args.unshift(opts.from + '..' + opts.to);
        else args.unshift('HEAD');
        return git.diff(args).catch(function() { return ''; })
          .then(function(numstat) {
            return git.diff(['--cached', '--numstat', opts.from || 'HEAD']).catch(function() { return ''; })
              .then(function(numstatCached) {
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
                    nodePath: fp, insertions: ins, deletions: del,
                    isMeta: fp.endsWith('_graph.json'),
                    isDoc: fp.endsWith('README.md'),
                    isImage: /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(fp),
                  };
                  seen[fp] = fileInfo;
                  files.push(fileInfo);
                });
                return git.status().then(function(status) {
                  (status.not_added || []).forEach(function(fp) {
                    if (!seen[fp]) {
                      var fileInfo = {
                        nodePath: fp, insertions: 0, deletions: 0, isNew: true,
                        isMeta: fp.endsWith('_graph.json'),
                        isDoc: fp.endsWith('README.md'),
                        isImage: /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(fp),
                      };
                      seen[fp] = fileInfo;
                      files.push(fileInfo);
                    }
                  });
                  return { ok: true, files: files };
                });
              });
          });
      });
    },

    getLog: function(absKbPath, opts) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        opts = opts || {};
        var git = _git_sg(absKbPath);
        return git.checkIsRepo().catch(function() { return false; })
          .then(function(isRepo) {
            if (!isRepo) return { ok: true, commits: [] };
            return git.raw(['rev-list', '--count', 'HEAD'])
              .then(function(o) { return parseInt(o.trim()) > 0; })
              .catch(function() { return false; });
          })
          .then(function(hasCommits) {
            if (!hasCommits) return { ok: true, commits: [] };
            return git.log({ maxCount: opts.limit || 20 }).then(function(log) {
              return {
                ok: true,
                commits: (log.all || []).map(function(c) {
                  return {
                    hash: c.hash, shortHash: c.hash.slice(0, 7),
                    message: c.message, date: c.date, author: c.author_name,
                  };
                })
              };
            });
          });
      });
    },

    getCommitDiffFiles: function(absKbPath, hash) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        var git = _git_sg(absKbPath);
        return git.raw(['diff', '--numstat', hash + '^', hash])
          .catch(function() {
            return git.raw(['show', '--numstat', '--format=', hash]).catch(function() { return ''; });
          })
          .then(function(numstat) {
            var files = [];
            (numstat || '').trim().split('\n').forEach(function(line) {
              line = line.trim();
              if (!line) return;
              var parts = line.split('\t');
              if (parts.length < 3) return;
              files.push({
                nodePath: parts[2],
                insertions: parseInt(parts[0]) || 0,
                deletions: parseInt(parts[1]) || 0,
                isMeta: parts[2].endsWith('_graph.json'),
                isDoc: parts[2].endsWith('README.md'),
                isImage: /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(parts[2]),
              });
            });
            return { ok: true, files: files };
          });
      });
    },

    getCommitFileDiff: function(absKbPath, hash, filePath) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        var git = _git_sg(absKbPath);
        return git.raw(['diff', hash + '^', hash, '--', _git_toGitPath(filePath)])
          .catch(function() {
            return git.raw(['show', hash, '--', _git_toGitPath(filePath)]).catch(function() { return ''; });
          })
          .then(function(diffText) { return { ok: true, diff: diffText }; });
      });
    },

    getRemote: function(absKbPath) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        var git = _git_sg(absKbPath);
        return git.getRemotes(true).catch(function() { return []; })
          .then(function(remotes) {
            var origin = remotes.find(function(r) { return r.name === 'origin'; });
            return { ok: true, url: origin ? (origin.fs.fetch || origin.fs.push || '') : '' };
          });
      });
    },

    setRemote: function(absKbPath, url) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        var git = _git_sg(absKbPath);
        return git.getRemotes(false).catch(function() { return []; })
          .then(function(remotes) {
            var hasOrigin = remotes.some(function(r) { return r.name === 'origin'; });
            if (hasOrigin) return git.remote(['set-url', 'origin', url]);
            return git.addRemote('origin', url);
          })
          .then(function() { return { ok: true }; });
      });
    },

    fetchRemote: function(absKbPath, env) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        var git = _git_sg(absKbPath, env || {});
        return _git_withTimeout(git.fetch(), 15000, 'git fetch')
          .then(function() { return { ok: true }; })
          .catch(function(e) {
            if (e.message.includes('超时')) return { ok: false, code: 'TIMEOUT', error: e.message };
            if (/Authentication|authentication|auth/i.test(e.message)) {
              return { ok: false, code: 'AUTH_FAILED', error: '认证失败，请检查 Token 是否有效。' };
            }
            return { ok: false, code: 'FETCH_ERROR', error: e.message };
          });
      });
    },

    push: function(absKbPath, env) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        var git = _git_sg(absKbPath, env || {});
        return git.raw(['symbolic-ref', '--short', 'HEAD'])
          .catch(function() { return 'main'; })
          .then(function(branch) {
            branch = branch.trim();
            return _git_withTimeout(git.push('origin', branch, ['--set-upstream']), 60000, 'git push');
          })
          .then(function() { return { ok: true }; })
          .catch(function(e) {
            if (e.message.includes('超时')) return { ok: false, code: 'TIMEOUT', error: e.message };
            if (/rejected|non-fast-forward/i.test(e.message)) {
              return { ok: false, code: 'PUSH_REJECTED', error: '推送被拒绝，远程有新提交，请先拉取再推送。' };
            }
            if (/Authentication|authentication|auth/i.test(e.message)) {
              return { ok: false, code: 'AUTH_FAILED', error: '认证失败，请检查 Token 或 SSH 密钥。' };
            }
            return { ok: false, code: 'PUSH_ERROR', error: e.message };
          });
      });
    },

    pull: function(absKbPath, env) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        var git = _git_sg(absKbPath, env || {});
        return _git_withTimeout(git.pull(), 60000, 'git pull')
          .then(function() { return { ok: true }; })
          .catch(function(e) {
            if (e.message.includes('超时')) return { ok: false, code: 'TIMEOUT', error: e.message };
            if (/CONFLICT|conflict/i.test(e.message)) {
              return { ok: false, code: 'CONFLICT', error: '拉取后出现冲突，请手动解决。' };
            }
            if (/Authentication|authentication|auth/i.test(e.message)) {
              return { ok: false, code: 'AUTH_FAILED', error: '认证失败，请检查 Token 或 SSH 密钥。' };
            }
            return { ok: false, code: 'PULL_ERROR', error: e.message };
          });
      });
    },

    getConflictList: function(absKbPath) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        var git = _git_sg(absKbPath);
        return git.status().then(function(status) {
          return { ok: true, files: status.conflicted || [] };
        });
      });
    },

    getConflictContent: function(absKbPath, filePath) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        var git = _git_sg(absKbPath);
        var gitFp = _git_toGitPath(filePath);
        var absFilePath = nodePath.join(absKbPath, filePath);
        var isBinary = /\.(png|jpg|jpeg|gif|webp|svg|pdf|zip|mp4|mp3)$/i.test(filePath);
        var ours = '', theirs = '', current = '';
        if (!isBinary) {
          return git.show(['HEAD:' + gitFp]).catch(function() { return ''; })
            .then(function(oursVal) {
              ours = oursVal;
              return git.show(['MERGE_HEAD:' + gitFp]).catch(function() { return ''; });
            })
            .then(function(theirsVal) {
              theirs = theirsVal;
              return new Promise(function(resolve) {
                nodeFs.readFile(absFilePath, 'utf-8', function(err, data) { resolve(err ? '' : data); });
              });
            })
            .then(function(currentVal) {
              current = currentVal;
              return { ok: true, ours: ours, theirs: theirs, current: current, isBinary: isBinary };
            });
        }
        return Promise.resolve({ ok: true, ours: ours, theirs: theirs, current: current, isBinary: isBinary });
      });
    },

    resolveConflict: function(absKbPath, filePath, resolvedContent) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        var absFilePath = nodePath.join(absKbPath, filePath);
        nodeFs.writeFileSync(absFilePath, resolvedContent, 'utf-8');
        var git = _git_sg(absKbPath);
        return git.add(_git_toGitPath(filePath)).then(function() { return { ok: true }; });
      });
    },

    completeConflictResolution: function(absKbPath) {
      return _git_checkAvailable().then(function(available) {
        if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
        var git = _git_sg(absKbPath);
        return git.status().then(function(status) {
          if (status.conflicted.length > 0) {
            return { ok: false, code: 'STILL_CONFLICTED', error: '还有 ' + status.conflicted.length + ' 个文件未解决。' };
          }
          return git.commit('merge: resolve conflicts manually')
            .then(function(result) { return { ok: true, hash: result.commit }; });
        });
      });
    },

    autoMergeMetaJson: function(oursStr, theirsStr) {
      try {
        var ours = JSON.parse(oursStr);
        var theirs = JSON.parse(theirsStr);
        var mergedChildren = Object.assign({}, theirs.children || {}, ours.children || {});
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
          children: mergedChildren, edges: mergedEdges, canvasBounds: cb,
          zoom: ours.zoom !== undefined ? ours.zoom : theirs.zoom,
          pan: ours.pan !== undefined ? ours.pan : theirs.pan,
        });
        return { ok: true, merged: JSON.stringify(merged, null, 2) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  };
}

// Singleton instance — internal methods use this instead of re-creating via factory
const gitService = createGitService();

export { createGitService, gitService };
export default gitService;
