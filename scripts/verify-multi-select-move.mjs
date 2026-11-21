/**
 * 专项验证：多选节点批量移动到目标房间（本次需求，仅覆盖这一条链路）。
 *
 *   node scripts/verify-multi-select-move.mjs
 *
 * 真跑内容：
 *  1) room-placement-service 纯函数（空白区落点 / 相对布局不变）；
 *  2) 主进程 fileService.moveTopoNodesToRoom：真实临时工作目录 + v1 _graph.json，
 *     验证保留内部连线、断开跨界连线、整批落到空白区域、撤销恢复原坐标；
 *  3) fileService.listRoomNodeTargets：全库节点枚举（含深层节点 / 面包屑）；
 *  4) 渲染层接线源码断言（搜索框 / 多选入口 / IPC 白名单）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-multi-select-move-'))
const read = (rel) => fs.readFileSync(path.join(projectRoot, rel), 'utf-8')
const rectOf = (c) => ({ x: c.x, y: c.y, w: c.width, h: c.height })
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

try {
  // ===== 1) 落点纯函数 =====
  const placement = await import(pathToFileURL(path.join(projectRoot, 'electron/services/room-placement-service.js')).href)
  const { planRoomPlacement, childRect, PLACEMENT_GAP } = placement
  assert.equal(planRoomPlacement([{ x: 0, y: 0, w: 100, h: 50 }], []).relocated, false,
    '目标房间为空时不得平移')
  assert.equal(planRoomPlacement(
    [{ x: 0, y: 0, w: 100, h: 50 }],
    [{ x: 600, y: 0, w: 100, h: 50 }],
  ).relocated, false, '原位本就是空白区域时不得平移')
  const batch = [{ x: 100, y: 100, w: 160, h: 80 }, { x: 320, y: 100, w: 160, h: 80 }, { x: 100, y: 250, w: 160, h: 80 }]
  const occupied = [{ x: 100, y: 100, w: 160, h: 80 }]
  const plan = planRoomPlacement(batch, occupied)
  assert.equal(plan.relocated, true, '与已有节点重叠时必须整体挪到空白区域')
  assert.equal(plan.dy, 0, '只做水平整体平移，垂直相对布局不动')
  assert.ok(plan.dx >= PLACEMENT_GAP, '平移后必须留出空白间距')
  const moved = batch.map((r) => ({ ...r, x: r.x + plan.dx, y: r.y + plan.dy }))
  assert.ok(moved.every((r) => occupied.every((o) => !overlaps(r, o))), '平移后不得与已有节点重叠')
  assert.equal(moved[1].x - moved[0].x, batch[1].x - batch[0].x, '整体平移必须保持相对布局（x）')
  assert.equal(moved[2].y - moved[0].y, batch[2].y - batch[0].y, '整体平移必须保持相对布局（y）')
  assert.deepEqual(childRect({}), { x: 0, y: 0, w: 120, h: 52 }, '缺省坐标/尺寸必须走卡片默认值')

  // 房间里有分布很宽的节点时，不能把整批推到「全房间包围盒右侧」的极远处。
  const wideOccupied = [...occupied, { x: 100000, y: 0, w: 120, h: 52 }]
  const widePlan = planRoomPlacement(batch, wideOccupied)
  assert.equal(widePlan.relocated, true, '重叠时必须挪位')
  assert.ok(Math.abs(widePlan.dx) < 1000 && Math.abs(widePlan.dy) < 1000,
    '落点必须就近，不得因远处节点被推到画布边缘')
  const wideMoved = batch.map((r) => ({ ...r, x: r.x + widePlan.dx, y: r.y + widePlan.dy }))
  assert.ok(wideMoved.every((r) => wideOccupied.every((o) => !overlaps(r, o))),
    '就近落点同样不得与任何已有节点重叠')

  // ===== 打包主进程 file-service（顶层 import electron 的 shell，用 stub 内联）=====
  const outfile = path.join(tmp, 'file-service.bundle.mjs')
  await build({
    entryPoints: [path.join(projectRoot, 'electron/file-service.js')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'stub-electron',
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'tm-stub' }))
        b.onLoad({ filter: /.*/, namespace: 'tm-stub' }, () => ({
          contents: 'export const shell = { openPath: async () => {} };',
          loader: 'js',
        }))
      },
    }],
  })
  const { fileService } = await import(pathToFileURL(outfile).href)
  assert.equal(typeof fileService.moveTopoNodesToRoom, 'function')
  assert.equal(typeof fileService.listRoomNodeTargets, 'function')

  // ===== 构造工作目录 =====
  const workDir = path.join(tmp, 'workspace')
  const kbs = path.join(workDir, 'kbs')
  fs.mkdirSync(kbs, { recursive: true })
  fs.mkdirSync(path.join(workDir, 'logs'), { recursive: true })
  fs.writeFileSync(path.join(workDir, '_config.json'), '{}')

  const node = (name, x, y) => ({ name, x, y, width: 160, height: 80 })
  const edge = (id, source, target) => ({ id, source, target, relation: 'related', weight: 'minor' })
  const writeRoom = (roomPath, meta) => {
    const dir = path.join(kbs, ...roomPath.split('/'))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '_graph.json'), JSON.stringify(meta))
  }
  const readRoom = (roomPath) => JSON.parse(
    fs.readFileSync(path.join(kbs, ...roomPath.split('/'), '_graph.json'), 'utf-8'),
  )

  // 源房间 KB1：选中 A/B/C，外部未选中 X/Y；A→B、B→C 是内部连线，C→X 跨界，X→Y 完全外部。
  writeRoom('KB1', {
    children: {
      A: node('节点 A', 100, 100),
      B: node('节点 B', 320, 100),
      C: node('节点 C', 100, 250),
      X: node('节点 X', 600, 100),
      Y: node('节点 Y', 800, 100),
      Dest: node('目标房间节点', 1000, 100),
    },
    edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'C'), edge('e3', 'C', 'X'), edge('e4', 'X', 'Y')],
    zoom: 1, pan: { x: 0, y: 0 },
  })
  for (const id of ['A', 'B', 'C', 'X', 'Y']) fs.mkdirSync(path.join(kbs, 'KB1', id), { recursive: true })

  // ===== 容器载荷 + 旧 X6 兼容：节点目录整体搬运必须零损失 =====
  // tree.json 里同时放 excalidraw 新载荷与 flowchart 旧条目，
  // 真跑 listTopoDocuments 会触发主进程 normalize + reconcile（历史上会静默删 flowchart）。
  const docsA = path.join(kbs, 'KB1', 'A', '_docs')
  fs.mkdirSync(docsA, { recursive: true })
  const now = Date.now()
  const treeItem = (id, type, title, file, order) => ({
    id, type, title, path: file, parentId: null, sortOrder: order,
    createdAt: now, updatedAt: now, version: 1,
  })
  fs.writeFileSync(path.join(docsA, 'doc_a.tdoc.json'), JSON.stringify({ schema: 'topomind.smart-document', title: '智能文档' }))
  fs.writeFileSync(path.join(docsA, 'scene_a.exdraw.json'), JSON.stringify({
    schema: 'topomind.excalidraw-document', version: 1, title: '白板',
    scene: { elements: [{ id: 'e1', type: 'rectangle' }], appState: { viewBackgroundColor: '#ffffff' } },
  }))
  fs.writeFileSync(path.join(docsA, 'legacy_a.tflow.json'), JSON.stringify({ schema: 'topomind.flowchart-document', title: '旧流程图' }))
  fs.writeFileSync(path.join(docsA, 'tree.json'), JSON.stringify({
    version: 2,
    documents: {
      doc_a: treeItem('doc_a', 'smart', '智能文档', 'doc_a.tdoc.json', 1),
      doc_b: treeItem('doc_b', 'excalidraw', '白板', 'scene_a.exdraw.json', 2),
      doc_c: treeItem('doc_c', 'flowchart', '旧流程图', 'legacy_a.tflow.json', 3),
    },
  }))
  const listDocIds = (cardPath) => fileService.listTopoDocuments(workDir, cardPath).map((d) => d.id).sort()
  assert.deepEqual(listDocIds('KB1/A'), ['doc_a', 'doc_b', 'doc_c'],
    '【容器 compat】主进程 normalize/reconcile 后 tree.json 三条都必须在（flowchart 不得被静默丢弃）')
  const treeAfterRead = JSON.parse(fs.readFileSync(path.join(docsA, 'tree.json'), 'utf-8'))
  assert.ok(treeAfterRead.documents.doc_b && treeAfterRead.documents.doc_c,
    '【容器 compat】读文档不得写回删除 .exdraw.json / .tflow.json 条目')
  const readDocAsText = (cardPathParts, file) => fs.readFileSync(
    path.join(kbs, ...cardPathParts, '_docs', file), 'utf-8',
  )
  assert.ok(readDocAsText(['KB1', 'A'], 'scene_a.exdraw.json').includes('topomind.excalidraw-document'))
  assert.ok(readDocAsText(['KB1', 'A'], 'legacy_a.tflow.json').includes('topomind.flowchart-document'))

  // 目标房间 Dest 已有节点 D，且坐标与 A 完全相同 → 必然触发空白区平移。
  writeRoom('KB1/Dest', {
    children: { D: node('已有节点 D', 100, 100) },
    edges: [], zoom: 1, pan: { x: 0, y: 0 },
  })

  // ===== 2) 批量移动 =====
  const result = fileService.moveTopoNodesToRoom(workDir, 'KB1', ['A', 'B', 'C'], 'KB1/Dest')
  assert.equal(result.moved.length, 3, '必须移动整批多选节点')
  assert.equal(result.keptEdges, 2, '两端都在选中集合内的连线必须保留')
  assert.equal(result.droppedEdges, 1, '与外部未选中节点的连线必须断开')

  const sourceAfter = readRoom('KB1')
  assert.deepEqual(Object.keys(sourceAfter.children).sort(), ['Dest', 'X', 'Y'], '源房间只留下未选中节点')
  assert.deepEqual(sourceAfter.edges.map((e) => e.id), ['e4'], '完全外部的连线留在源房间')
  assert.deepEqual(sourceAfter.edges.map((e) => e.id).filter((id) => id === 'e3'), [], '跨界连线必须删除')

  const targetAfter = readRoom('KB1/Dest')
  for (const id of ['A', 'B', 'C', 'D']) {
    assert.ok(targetAfter.children[id], `目标房间必须包含 ${id}`)
  }
  assert.equal(targetAfter.edges.length, 2, '目标房间必须带上 2 条内部连线')
  assert.deepEqual(
    targetAfter.edges.map((e) => `${e.source}->${e.target}`).sort(),
    ['A->B', 'B->C'],
    '内部连线引用必须随迁入保持有效（含改名映射）',
  )
  assert.equal(targetAfter.children.D.x, 100, '目标房间已有节点坐标不得被改动')
  assert.ok(readDocAsText(['KB1', 'Dest', 'A'], 'scene_a.exdraw.json').includes('topomind.excalidraw-document'),
    '【容器载荷】跨房间移动后 .exdraw.json 必须随整目录一起搬走')
  assert.ok(readDocAsText(['KB1', 'Dest', 'A'], 'legacy_a.tflow.json').includes('topomind.flowchart-document'),
    '【容器 compat】跨房间移动后旧 .tflow.json 物理文件仍在')
  assert.deepEqual(listDocIds('KB1/Dest/A'), ['doc_a', 'doc_b', 'doc_c'],
    '【容器 compat】跨房间移动后 tree.json 三条索引仍完整')

  const before = { A: node('节点 A', 100, 100), B: node('节点 B', 320, 100), C: node('节点 C', 100, 250) }
  const dxA = targetAfter.children.A.x - before.A.x
  const dyA = targetAfter.children.A.y - before.A.y
  assert.equal(dxA, targetAfter.children.B.x - before.B.x, '所有选中节点必须同一个 dx')
  assert.equal(dyA, targetAfter.children.C.y - before.C.y, '所有选中节点必须同一个 dy')
  assert.equal(targetAfter.children.B.x - targetAfter.children.A.x, 220, '内部相对布局（x）不变')
  assert.equal(targetAfter.children.C.y - targetAfter.children.A.y, 150, '内部相对布局（y）不变')
  assert.ok(dxA > 0, '与目标房间已有节点重叠时必须挪到空白区域')
  for (const id of ['A', 'B', 'C']) {
    assert.equal(overlaps(rectOf(targetAfter.children[id]), rectOf(targetAfter.children.D)), false,
      `${id} 不得压在目标房间已有节点上`)
  }
  assert.deepEqual(result.positions.A, { x: 100, y: 100 }, '结果必须带回原坐标供撤销使用')
  assert.equal(Object.keys(result.positions).length, 3, '每个被移动节点都要有原坐标')

  // 撤销：按原坐标移回源房间，位置必须精确复原（不能再次被平移）。
  const undoResult = fileService.moveTopoNodesToRoom(workDir, 'KB1/Dest', result.moved, 'KB1', {
    positionsByNode: result.positions,
  })
  const restored = readRoom('KB1')
  for (const id of ['A', 'B', 'C']) {
    assert.deepEqual({ x: restored.children[id].x, y: restored.children[id].y }, { x: before[id].x, y: before[id].y },
      `撤销后 ${id} 必须回到原坐标`)
  }
  assert.equal(readRoom('KB1/Dest').children.D.x, 100, '撤销不得改动目标房间已有节点')
  assert.deepEqual(restored.edges.map((e) => e.id).sort(), ['e1', 'e2', 'e4'], '撤销后内部连线回到源房间')
  assert.ok(readDocAsText(['KB1', 'A'], 'scene_a.exdraw.json').includes('topomind.excalidraw-document'),
    '【容器载荷】撤销移动后 .exdraw.json 必须跟着目录回来')
  assert.deepEqual(listDocIds('KB1/A'), ['doc_a', 'doc_b', 'doc_c'],
    '【容器 compat】撤销移动后 tree.json 索引仍完整')

  // ===== 3) 全库节点搜索清单 =====
  writeRoom('KB1/A', {
    children: { A1: node('深层节点 A1', 10, 10) }, edges: [], zoom: 1, pan: { x: 0, y: 0 },
  })
  const targets = fileService.listRoomNodeTargets(workDir)
  const byPath = new Map(targets.map((t) => [t.path, t]))
  assert.ok(byPath.get('KB1')?.isRoot === true, '必须包含知识库根房间')
  for (const p of ['KB1/A', 'KB1/B', 'KB1/C', 'KB1/X', 'KB1/Y', 'KB1/Dest', 'KB1/Dest/D', 'KB1/A/A1']) {
    assert.ok(byPath.has(p), `节点清单必须包含 ${p}`)
  }
  assert.equal(byPath.get('KB1/A/A1').name, '深层节点 A1', '搜索结果必须带显示名')
  assert.equal(byPath.get('KB1/A/A1').breadcrumb, 'KB1 / 节点 A', '搜索结果必须带父链面包屑')
  assert.equal(byPath.get('KB1/A').breadcrumb, 'KB1', '直接子节点面包屑为知识库名')
  assert.ok(!targets.some((t) => t.path.includes('_graph') || t.path.includes('_docs')),
    '内部目录不得混进节点清单')

  // ===== 3.5) 前进（重做）：撤销后重新搬回目标房间，落点必须与第一次完全一致 =====
  // 撤销已把目标房间恢复到移动前状态，后端重新计算的空白落点应给出同一个 (dx,dy)。
  const redoResult = fileService.moveTopoNodesToRoom(workDir, 'KB1', undoResult.moved, 'KB1/Dest')
  const redone = readRoom('KB1/Dest')
  for (const id of ['A', 'B', 'C']) {
    assert.deepEqual(
      { x: redone.children[id].x, y: redone.children[id].y },
      { x: targetAfter.children[id].x, y: targetAfter.children[id].y },
      `前进后 ${id} 必须与第一次移动后的坐标完全一致`,
    )
  }
  assert.equal(redone.edges.length, 2, '前进后内部连线必须恢复')
  assert.deepEqual(Object.keys(readRoom('KB1').children).sort(), ['Dest', 'X', 'Y'],
    '前进后源房间只留下未选中节点')

  // 再撤销一次（用户反复点撤销/前进）：用前进返回的原坐标写回，仍须精确复原。
  fileService.moveTopoNodesToRoom(workDir, 'KB1/Dest', redoResult.moved, 'KB1', {
    positionsByNode: redoResult.positions,
  })
  const restoredAgain = readRoom('KB1')
  for (const id of ['A', 'B', 'C']) {
    assert.deepEqual(
      { x: restoredAgain.children[id].x, y: restoredAgain.children[id].y },
      { x: before[id].x, y: before[id].y },
      `反复撤销后 ${id} 仍须回到原坐标`,
    )
  }

  // ===== 4) 多选右键：真跑「保留整批选中」的决策 + 复现旧实现的破坏 =====
  const selectionOutfile = path.join(tmp, 'selection.bundle.mjs')
  await build({
    stdin: {
      contents: [
        "export { shouldResetSelectionOnContextMenu } from './src/hooks/useGraph/contextMenuSelection.ts'",
        "export { buildSelectionOperations } from './src/hooks/useGraph/selectionOperations.ts'",
      ].join('\n'),
      resolveDir: projectRoot,
      sourcefile: 'selection-entry.ts',
      loader: 'ts',
    },
    outfile: selectionOutfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'stub-log-backend',
      setup(b) {
        b.onResolve({ filter: /log-backend$/ }, () => ({ path: 'log', namespace: 'tm-sel-stub' }))
        b.onLoad({ filter: /.*/, namespace: 'tm-sel-stub' }, () => ({
          contents: 'export const logAction = () => {};',
          loader: 'js',
        }))
      },
    }],
  })
  const { shouldResetSelectionOnContextMenu, buildSelectionOperations } = await import(pathToFileURL(selectionOutfile).href)
  assert.equal(shouldResetSelectionOnContextMenu(['A', 'B', 'C'], 'B'), false,
    '右键落在多选集合内必须保留整批选中')
  assert.equal(shouldResetSelectionOnContextMenu(['A', 'B', 'C'], 'X'), true,
    '右键落在集合外才切到单选')
  assert.equal(shouldResetSelectionOnContextMenu([], 'A'), true, '没有选中时右键必须单选该节点')

  const makeSelectionStore = () => {
    const state = {
      nodes: ['A', 'B', 'C', 'X'].map((id) => ({ id, selected: id !== 'X' })),
      selectedNodeIds: ['A', 'B', 'C'],
      nodesMap: new Map(),
      setNodes(next) {
        state.nodes = next
        state.selectedNodeIds = next.filter((n) => n.selected).map((n) => n.id)
      },
    }
    return state
  }
  const selectionState = makeSelectionStore()
  const selectionOps = buildSelectionOperations({ tabId: 'test', storeApi: { getState: () => selectionState } })
  if (shouldResetSelectionOnContextMenu(selectionState.selectedNodeIds, 'B')) selectionOps.selectNode('B')
  assert.deepEqual(selectionState.selectedNodeIds, ['A', 'B', 'C'],
    '修复路径：右键选中集合内节点后多选必须原样保留')
  selectionOps.selectNode('B')
  assert.deepEqual(selectionState.selectedNodeIds, ['B'],
    '旧实现复现：无条件 selectNode 会把整批多选重置成单选（这正是原 bug 根因）')

  // ===== 4.5) 移动历史栈真跑：撤销 / 前进 / 新操作清空重做分支 =====
  const historyOutfile = path.join(tmp, 'history.bundle.mjs')
  await build({
    entryPoints: [path.join(projectRoot, 'src/features/graph/GraphPage/model/nodeMoveHistoryStore.ts')],
    outfile: historyOutfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'stub-zustand',
      setup(b) {
        b.onResolve({ filter: /^zustand$/ }, () => ({ path: 'zustand', namespace: 'tm-hist-stub' }))
        b.onLoad({ filter: /.*/, namespace: 'tm-hist-stub' }, () => ({
          contents: [
            'export function create(init) {',
            '  let state;',
            '  const set = (partial) => { state = Object.assign({}, state, typeof partial === "function" ? partial(state) : partial); };',
            '  const getState = () => state;',
            '  state = init(set);',
            '  return { getState, setState: set };',
            '}',
          ].join('\n'),
          loader: 'js',
        }))
      },
    }],
  })
  const { useNodeMoveHistoryStore, describeMoveEntry } = await import(pathToFileURL(historyOutfile).href)
  const makeEntry = (id) => ({
    moved: [id], keptEdges: 0, droppedEdges: 0,
    targetRoomPath: 'KB1/Dest', sourceRoomPath: 'KB1',
    renamed: {}, positions: { [id]: { x: 1, y: 2 } },
    targetLabel: 'Dest', at: 1,
  })
  const hist = useNodeMoveHistoryStore.getState()
  hist.pushMove(makeEntry('A'))
  hist.pushMove(makeEntry('B'))
  assert.equal(useNodeMoveHistoryStore.getState().undoStack.length, 2, '两次移动都要进撤销栈')
  hist.setBusy(true)
  assert.equal(useNodeMoveHistoryStore.getState().busy, true, '后端操作期间必须锁住按钮')
  hist.setBusy(false)
  hist.commitUndo({ ...makeEntry('B'), moved: ['B-1'] })
  assert.equal(useNodeMoveHistoryStore.getState().undoStack.length, 1, '撤销后 undo 栈出栈')
  assert.equal(useNodeMoveHistoryStore.getState().redoStack[0].moved[0], 'B-1',
    '撤销后必须用后端返回的真实 basename 更新条目，前进才能找到节点')
  hist.pushMove(makeEntry('C'))
  assert.equal(useNodeMoveHistoryStore.getState().redoStack.length, 0,
    '新移动必须让重做分支失效（标准 undo/redo 语义）')
  hist.commitUndo({ ...makeEntry('C'), moved: ['C'] })
  hist.commitRedo({ ...makeEntry('C'), positions: { C: { x: 9, y: 9 } } })
  assert.equal(useNodeMoveHistoryStore.getState().redoStack.length, 0, '前进后 redo 栈出栈')
  assert.equal(useNodeMoveHistoryStore.getState().undoStack.at(-1).positions.C.x, 9,
    '前进后必须带回移动前坐标供下一次撤销写回')
  assert.match(describeMoveEntry(makeEntry('A'), 'undo'), /撤销：移动 1 个节点到「Dest」/,
    '按钮 tooltip 必须说清这一步撤销的是什么')
  assert.match(describeMoveEntry(undefined, 'redo'), /暂无可前进/, '空栈 tooltip 必须给出提示')

  // ===== 4.6) 撤销 / 前进不得切换视角房间：真跑协调器 =====
  // bug 复现条件：用户移动 A→B 后手动进入 B，再点撤销；旧实现 loadRoom(sourceRoomPath)
  // 会把画布切回 A，而 tab 会话 roomPath 仍是 B（面包屑显示 B），
  // navigateToChildRoom 按 B 解析路径 → 再也进不去 B。
  const moveModelOutfile = path.join(tmp, 'move-model.bundle.mjs')
  await build({
    stdin: {
      contents: "export { useNodeMoveToRoom } from './src/features/graph/GraphPage/model/useNodeMoveToRoom.ts'",
      resolveDir: projectRoot,
      sourcefile: 'move-model-entry.ts',
      loader: 'ts',
    },
    outfile: moveModelOutfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'stub-move-model-deps',
      setup(b) {
        const stubs = {
          react: "export const useCallback = (fn) => fn; export const useState = (v) => [globalThis.__TM_TEST__.moveState ?? v, () => {}];",
          storage: "export const useStorage = () => globalThis.__TM_TEST__.storage;",
          graphStore: "export const useGraphStoreApi = () => globalThis.__TM_TEST__.graphStoreApi;",
          toast: "export const toast = (t) => { globalThis.__TM_TEST__.toasts.push(t); };",
          log: "export const logAction = () => {};",
          history: "export const useNodeMoveHistoryStore = { getState: () => globalThis.__TM_TEST__.historyState };",
        }
        const rules = [
          [/^react$/, 'react'],
          [/core\/storage$/, 'storage'],
          [/stores\/graphStore$/, 'graphStore'],
          [/toastStore$/, 'toast'],
          [/log-backend$/, 'log'],
          [/nodeMoveHistoryStore$/, 'history'],
        ]
        for (const [filter, key] of rules) {
          b.onResolve({ filter }, () => ({ path: key, namespace: 'tm-move-stub' }))
        }
        b.onLoad({ filter: /.*/, namespace: 'tm-move-stub' }, (args) => ({
          contents: stubs[args.path], loader: 'js',
        }))
      },
    }],
  })
  const { useNodeMoveToRoom } = await import(pathToFileURL(moveModelOutfile).href)

  const moveEntry = {
    moved: ['A', 'B'], keptEdges: 1, droppedEdges: 0,
    sourceRoomPath: 'KB1', targetRoomPath: 'KB1/Dest',
    renamed: {}, positions: { A: { x: 1, y: 2 }, B: { x: 3, y: 4 } },
    targetLabel: 'Dest', at: 1,
  }
  const makeMoveHistory = (stack) => ({
    busy: false,
    undoStack: stack === 'undo' ? [moveEntry] : [],
    redoStack: stack === 'redo' ? [moveEntry] : [],
    setBusy(v) { this.busy = v },
    commitUndo() {}, commitRedo() {}, pushMove() {},
  })
  const calls = []
  const storageCalls = []
  globalThis.__TM_TEST__ = {
    storage: {
      moveTopoNodesToRoom: async (...args) => {
        storageCalls.push(args)
        return {
          moved: ['A', 'B'], keptEdges: 1, droppedEdges: 0,
          sourceRoomPath: 'KB1', targetRoomPath: 'KB1/Dest',
          renamed: {}, positions: moveEntry.positions,
        }
      },
    },
    graphStoreApi: { getState: () => ({ nodesMap: new Map(), selectedNodeIds: [] }) },
    toasts: [],
    // useState 桩在 hook 创建时取值，移动对话框状态必须先就位。
    moveState: { nodeIds: ['A', 'B'], sourceRoomPath: 'KB1', kbPath: 'KB1' },
    historyState: makeMoveHistory('undo'),
  }
  const recordedGraph = {
    loadRoom: async (p) => { calls.push({ kind: 'loadRoom', path: p }) },
    refreshCurrentRoom: async () => { calls.push({ kind: 'refresh' }) },
  }
  const moveModelRuntime = useNodeMoveToRoom({ graph: recordedGraph })

  await moveModelRuntime.onMoveUndo()
  assert.equal(calls.filter((c) => c.kind === 'refresh').length, 1, '撤销后必须原地刷新一次')
  assert.equal(calls.filter((c) => c.kind === 'loadRoom').length, 0,
    '撤销绝不能调用 loadRoom 切到源房间（正是本 bug 根因）')
  assert.deepEqual(storageCalls[0].slice(0, 3), ['KB1/Dest', ['A', 'B'], 'KB1'],
    '撤销的后端移动方向仍是 target → source')
  assert.deepEqual(storageCalls[0][3], { positionsByNode: moveEntry.positions },
    '撤销仍须写回原坐标')

  calls.length = 0
  storageCalls.length = 0
  globalThis.__TM_TEST__.historyState = makeMoveHistory('redo')
  await moveModelRuntime.onMoveRedo()
  assert.equal(calls.filter((c) => c.kind === 'refresh').length, 1, '前进后必须原地刷新一次')
  assert.equal(calls.filter((c) => c.kind === 'loadRoom').length, 0, '前进也不能切换视角房间')
  assert.deepEqual(storageCalls[0].slice(0, 3), ['KB1', ['A', 'B'], 'KB1/Dest'],
    '前进的后端移动方向仍是 source → target')

  calls.length = 0
  storageCalls.length = 0
  await moveModelRuntime.handleMoveNodesToRoom('KB1/Dest')
  assert.equal(calls.filter((c) => c.kind === 'loadRoom').length, 0, '移动本身也不能硬切房间')
  assert.equal(calls.filter((c) => c.kind === 'refresh').length, 1, '移动后原地刷新当前房间')
  delete globalThis.__TM_TEST__

  // ===== 5) 渲染层接线 =====
  const dialog = read('src/features/graph/GraphPage/components/NodeMoveToRoomDialog.tsx')
  assert.ok(dialog.includes('storage.listRoomNodeTargets()'), '移动控件必须接入全库节点清单')
  assert.ok(dialog.includes('placeholder="搜索节点'), '移动控件必须提供搜索框')
  assert.ok(dialog.includes('onKeyDown={handleSearchKeyDown}'), '搜索必须支持键盘操作')
  assert.ok(dialog.includes('会成环'), '搜索结果必须做防环过滤')
  const menu = read('src/features/graph/GraphPage/components/GraphPageContextMenu.tsx')
  assert.ok(menu.includes('移动选中 ${selectedCount} 个节点到房间…'), '右键菜单必须有多选批量移动入口')
  const actions = read('src/features/graph/GraphPage/model/useGraphPageActions.ts')
  assert.ok(actions.includes('onMoveSelectionToRoom'), '多选入口必须接线到协调器')
  const moveModel = read('src/features/graph/GraphPage/model/useNodeMoveToRoom.ts')
  assert.ok(moveModel.includes('selectedNodeIds'), '协调器必须按当前选中集合整批移动')
  assert.ok(moveModel.includes('positionsByNode: entry.positions'), '撤销必须恢复原坐标')
  assert.ok(read('electron/preload.js').includes("'fs:listRoomNodeTargets'"), 'preload 必须放行新 IPC')
  assert.ok(read('electron/main.js').includes("ipcMain.handle('fs:listRoomNodeTargets'"), '主进程必须注册新 IPC')

  // ---- 本次修复：多选右键统一接线 ----
  const eventHandlers = read('src/hooks/useGraph/graphEventHandlers.ts')
  assert.ok(eventHandlers.includes('shouldResetSelectionOnContextMenu(selectedIds, node.id)'),
    '节点右键必须走「集合内保留多选」的决策，不得再无条件 selectNode')
  assert.ok(!/if \(!selectedIds\.includes\(node\.id\)\) ops\.selectNode/.test(eventHandlers),
    '不得回退成内联判断（唯一真源是 contextMenuSelection.ts）')

  const canvas = read('src/features/graph/GraphCanvas/GraphCanvas.tsx')
  assert.ok(canvas.includes('onSelectionContextMenu={handleSelectionContextMenu}'),
    '必须接通 xyflow 多选选区包围盒的右键回调，否则框选后右键被 rect 吞掉')
  assert.ok(canvas.includes('onContextMenu={actions.handleCanvasContextMenuFallback}'),
    '必须有容器级兜底，保证任何内部覆盖层吞事件时仍能呼出菜单')

  const canvasModel = read('src/features/graph/GraphCanvas/model/useGraphCanvasModel.ts')
  assert.ok(canvasModel.includes('selectedNodes.map((node) => node.id)'),
    '选区右键必须把 xyflow 的选中集合交给页面层做单选回落')
  assert.ok(canvasModel.includes('handleCanvasContextMenuFallback'),
    '兜底 handler 必须在画布 model 中定义')
  assert.ok(canvasModel.includes('isCanvasReadOnly(tabId)'),
    '右键回调必须遵守画布只读闸门')

  assert.ok(actions.includes('onSelectionContextMenu: openSelectionMenu'), '选区右键必须接到页面层')
  assert.ok(actions.includes('selectedIds: string[]'), '菜单状态必须冻结选中集合快照')
  assert.ok(actions.includes('openMoveToRoom(nodeId, contextMenu.selectedIds)'),
    '节点右键必须用冻结快照，不能回读 store')
  assert.ok(actions.includes('openMoveIdsToRoom(contextMenu.selectedIds)'),
    '空白 / 选区右键必须用冻结快照整批移动')
  assert.ok(actions.includes('const singleId = selectedIds.length === 1'),
    '选区层在单选时必须回落到完整节点菜单，不能让菜单项变少')

  assert.ok(/selectionMenu\s*\?\s*selectionItems/.test(menu), '多选选区必须渲染批量菜单')
  assert.ok(menu.includes('onClearSelection'), '批量菜单必须提供取消选择')
  assert.ok(moveModel.includes('openMoveIdsToRoom'), '协调器必须支持按显式集合打开移动控件')
  assert.ok(moveModel.includes('buildMoveState'), '移动集合必须只由显式 nodeIds 构造')
  assert.ok(!moveModel.includes('openMoveSelectionToRoom'), '不得残留回读 store 的旧入口')

  // ---- 本次新增：常驻撤销 / 前进入口 ----
  const toastStore = read('src/shared/ui/Toaster/toastStore.ts')
  assert.ok(/pushToast: \(\{[^}]*\baction\b/.test(toastStore),
    'toast 必须把 action 原样带进条目，否则「撤销」按钮永远不会渲染')
  assert.ok(/toasts: \[[^\]]*action/.test(toastStore), 'toast 状态里必须写入 action')

  const historyStore = read('src/features/graph/GraphPage/model/nodeMoveHistoryStore.ts')
  assert.ok(historyStore.includes('undoStack') && historyStore.includes('redoStack'),
    '移动历史必须同时维护撤销栈与前进栈')
  assert.ok(historyStore.includes('redoStack: []'), '新移动必须清空重做分支')

  assert.ok(moveModel.includes('pushMove(entry)'), '每次成功移动都要压入历史栈')
  assert.ok(moveModel.includes('commitUndo({ ...entry, moved: result.moved })'),
    '撤销后必须用真实 basename 更新条目，前进才能找到节点')
  assert.ok(moveModel.includes('commitRedo({') && moveModel.includes('positions: result.positions'),
    '前进后必须带回移动前坐标供下一次撤销写回')
  assert.ok(moveModel.includes("action: { label: '撤销', onClick: () => void undoMove() }"),
    'toast 的撤销必须与常驻按钮共用同一个历史入口')
  assert.ok(moveModel.includes('onMoveUndo: undoMove') && moveModel.includes('onMoveRedo: redoMove'),
    '协调器必须把撤销 / 前进回调暴露给画布面板')

  assert.ok(actions.includes('onMoveUndo,') && actions.includes('onMoveRedo,'),
    '画布 props 必须带上下两个回调')
  assert.ok(canvas.includes('onMoveUndo={onMoveUndo}') && canvas.includes('onMoveRedo={onMoveRedo}'),
    'GraphCanvas 必须把回调转交给左侧画布状态面板')
  const lodControl = read('src/features/graph/GraphCanvas/components/LodControl.tsx')
  assert.ok(lodControl.includes('data-tm-move-undo=""') && lodControl.includes('data-tm-move-redo=""'),
    '左侧画布状态面板必须有常驻的撤销 / 前进按钮')
  assert.ok(lodControl.includes('data-tm-move-history-undo-count={undoStack.length}'),
    '按钮必须显示可撤销的步数')
  assert.ok(lodControl.includes('data-tm-canvas-status-body=""'),
    '新增工具条不能挤掉原有抽屉主体（GUI 回归依赖它）')
  assert.ok(lodControl.includes('readOnlyState.readOnly'), '撤销 / 前进必须遵守画布只读闸门')
  // 工具条必须在抽屉主体之前：折叠抽屉后按钮仍然可见可点。
  assert.ok(lodControl.indexOf('data-tm-move-history=""') < lodControl.indexOf('data-tm-canvas-status-body=""'),
    '撤销 / 前进工具条必须常驻在折叠区之外')

  // ---- 本次修复：撤销 / 前进不切房间，画布与面包屑保持一致 ----
  assert.ok(!/graph\.loadRoom\(/.test(moveModel),
    '协调器不得再出现任何 loadRoom(...) 调用：loadRoom 不改 tab 会话 roomPath，硬传房间路径会让画布与面包屑错位')
  assert.equal((moveModel.match(/await graph\.refreshCurrentRoom\(\)/g) || []).length, 3,
    '移动 / 撤销 / 前进三处都必须走原地刷新')

  const graphHook = read('src/hooks/useGraph.ts')
  assert.ok(graphHook.includes('const refreshCurrentRoom = useCallback('),
    '原地刷新必须是 useGraph 暴露的唯一入口')
  assert.ok(graphHook.includes('session.roomPath || session.kbPath'),
    '原地刷新只能按 tab 会话当前显示的房间取路径，不能传源 / 目标房间')
  assert.ok(graphHook.includes('await loadRoom(dirPath, true, true)'),
    '原地刷新必须保留当前节点布局与相机视口，避免视角跳动')
  assert.ok(read('src/contexts/GraphContext.tsx').includes('refreshCurrentRoom: graph.refreshCurrentRoom'),
    'refreshCurrentRoom 必须贯通到 GraphContext')

  const roomLoader = read('src/hooks/useGraph/useGraphRoomLoader.ts')
  assert.ok(roomLoader.includes('preserveViewport = false'), 'loadRoom 必须支持保留视口')
  assert.ok(roomLoader.includes('currentViewport ?? {'), '保留视口时不得套用磁盘里的旧 pan/zoom')
  assert.ok(!roomLoader.includes('enterRoomInTab') && !roomLoader.includes('restoreRoomStateToTab'),
    'loadRoom 只换图状态，不得擅自改写 tab 会话房间')

  console.log('Multi-select move checks verified')
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* Windows 文件句柄占用时忽略清理 */ }
}
