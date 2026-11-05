export function createCardService(deps) {
  const {
    readGraphMeta,
    requireValidWorkDir,
  } = deps;

  return {
    readCardChildren(rootDir, cardPath) {
      rootDir = requireValidWorkDir(rootDir);
      // P1：走逻辑读，v2 分片房间的 children 由 graphMetaService 组装；
      // 直接 readJsonFile(_graph.json) 只会拿到索引（version/zoom/pan）→ 子树整片消失。
      var parentGraph = readGraphMeta(rootDir, cardPath);
      return (parentGraph && parentGraph.children) || {};
    },
  };
}
