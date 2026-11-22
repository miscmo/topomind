/**
 * CardSpec 媒体资源路径规则（纯模块，无 electron / fs 依赖）。
 *
 * 主进程 electron/file-service.js 与门禁脚本共用同一份校验逻辑：
 * CardSpec 只认 <cardId>/_docs/assets/ 下的相对引用，拒绝 .. / 绝对路径 /
 * 反斜杠 / 协议头 / 未知扩展名，防止渲染层传入的路径逃逸出节点目录。
 */
export const CARD_ASSET_DIR = 'assets';
export const CARD_ASSET_MAX_SRC = 512;

export const CARD_ASSET_RULES = {
  image: { exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], maxBytes: 20 * 1024 * 1024, label: '20MB' },
  audio: { exts: ['mp3', 'wav', 'ogg', 'm4a', 'flac'], maxBytes: 200 * 1024 * 1024, label: '200MB' },
  video: { exts: ['mp4', 'webm', 'mov'], maxBytes: 200 * 1024 * 1024, label: '200MB' },
};

/** 合法时返回规范化后的相对引用；非法一律抛错，由调用方转成 null / 降级占位。 */
export function normalizeCardAssetRelPath(relPath) {
  var src = String(relPath || '');
  if (!src || src.length > CARD_ASSET_MAX_SRC) throw new Error('资源路径非法');
  if (src.indexOf(CARD_ASSET_DIR + '/') !== 0) throw new Error('资源路径必须位于 assets/ 内');
  if (src.indexOf('..') !== -1 || src.indexOf('\\') !== -1) throw new Error('资源路径非法');
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) throw new Error('资源路径非法');
  var fileName = src.slice(CARD_ASSET_DIR.length + 1);
  if (!fileName || fileName.indexOf('/') !== -1) throw new Error('资源路径非法');
  return src;
}

export function cardAssetCategory(fileName) {
  var dot = String(fileName).lastIndexOf('.');
  if (dot <= 0) return null;
  var ext = String(fileName).slice(dot + 1).toLowerCase();
  var categories = Object.keys(CARD_ASSET_RULES);
  for (var i = 0; i < categories.length; i++) {
    if (CARD_ASSET_RULES[categories[i]].exts.indexOf(ext) !== -1) return categories[i];
  }
  return null;
}
