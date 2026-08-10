import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'vite'

import type { KnowledgeEdge, KnowledgeNode } from '../src/types/index.ts'
import type { GraphState } from '../src/stores/graphStore.tsx'

const projectRoot = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const tempRoot = join(projectRoot, 'node_modules/.cache/topomind-graph-store-test')
await mkdir(tempRoot, { recursive: true })
const entryFile = join(projectRoot, 'src/stores/graphStore.tsx')
const outputFile = join(tempRoot, 'graph-store.mjs')

function node(id: string, selected = false): KnowledgeNode {
  return {
    id,
    type: 'knowledgeCard',
    position: { x: 0, y: 0 },
    selected,
    data: { label: id },
  }
}

function edge(id: string, source: string, target: string): KnowledgeEdge {
  return {
    id,
    source,
    target,
    data: { relation: '相关', weight: 'minor' },
  }
}

function assertDerivedState(state: GraphState) {
  assert.equal(state.nodesMap.size, state.nodes.length)
  assert.equal(state.edgesMap.size, state.edges.length)
  for (const item of state.nodes) assert.equal(state.nodesMap.get(item.id), item)
  for (const item of state.edges) assert.equal(state.edgesMap.get(item.id), item)

  const selectedNodes = state.nodes.filter((item) => item.selected)
  assert.equal(state.selectedNodeCount, selectedNodes.length)
  assert.equal(state.selectedNodeId, selectedNodes[0]?.id ?? null)
  assert.deepEqual(state.selectedNodeIds, selectedNodes.map((item) => item.id))
  assert.deepEqual(state.selectedNodes, selectedNodes)
  assert.equal(state.derivedNodesRef, state.nodes)
  assert.equal(state.derivedEdgesRef, state.edges)
}

await build({
  configFile: false,
  root: projectRoot,
  logLevel: 'silent',
  build: {
    ssr: entryFile,
    outDir: tempRoot,
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      external: ['react', 'zustand', 'zundo'],
      output: {
        entryFileNames: 'graph-store.mjs',
      },
    },
  },
})

const {
    captureGraphHistorySnapshot,
    commitGraphHistorySnapshot,
    createGraphStore,
    replaceGraphSession,
    setupTemporalMapSync,
  } = await import(
    `${pathToFileURL(outputFile).href}?t=${Date.now()}`
  ) as typeof import('../src/stores/graphStore.tsx')

  const store = createGraphStore()
  const stopDerivedSync = setupTemporalMapSync(store)
  const temporalStore = store.temporal

  const a = node('a', true)
  const b = node('b')
  const ab = edge('ab', 'a', 'b')
  let notifications = 0
  const stopCounting = store.subscribe(() => {
    notifications += 1
  })

  replaceGraphSession(store, [a, b], [ab])
  assert.equal(notifications, 1)
  assertDerivedState(store.getState())

  const movedA = { ...a, position: { x: 80, y: 40 } }
  notifications = 0
  store.getState().setNodesPreservingSelection([movedA, b])
  assert.equal(notifications, 1)
  assert.equal(store.getState().selectedNodes[0], movedA)
  assertDerivedState(store.getState())

  const selectedB = { ...b, selected: true }
  notifications = 0
  store.getState().setNodes([movedA, selectedB])
  assert.equal(notifications, 1)
  assertDerivedState(store.getState())

  notifications = 0
  store.getState().updateNode('b', (current) => ({
    ...current,
    data: { ...current.data, label: 'updated' },
  }))
  assert.equal(notifications, 1)
  assert.equal(store.getState().nodesMap.get('b')?.data.label, 'updated')
  assertDerivedState(store.getState())

  const ba = edge('ba', 'b', 'a')
  notifications = 0
  store.getState().setEdges([ab, ba])
  assert.equal(notifications, 1)
  assertDerivedState(store.getState())

  notifications = 0
  store.getState().removeEdgesByNodeIds(['a'])
  assert.equal(notifications, 1)
  assert.deepEqual(store.getState().edges, [])
  assertDerivedState(store.getState())

  notifications = 0
  temporalStore.getState().undo()
  assert.equal(notifications, 1)
  assert.deepEqual(store.getState().edges.map((item) => item.id), ['ab', 'ba'])
  assertDerivedState(store.getState())

  notifications = 0
  temporalStore.getState().undo()
  assert.equal(notifications, 1)
  assert.deepEqual(store.getState().edges.map((item) => item.id), ['ab'])
  assertDerivedState(store.getState())

  notifications = 0
  temporalStore.getState().redo(2)
  assert.equal(notifications, 1)
  assert.deepEqual(store.getState().edges, [])
  assertDerivedState(store.getState())

  notifications = 0
  store.getState().removeNodes(['a'])
  assert.equal(notifications, 1)
  assert.deepEqual(store.getState().nodes.map((item) => item.id), ['b'])
  assertDerivedState(store.getState())

  notifications = 0
  temporalStore.getState().undo()
  assert.equal(notifications, 1)
  assert.deepEqual(store.getState().nodes.map((item) => item.id), ['a', 'b'])
  assertDerivedState(store.getState())

  notifications = 0
  temporalStore.getState().redo()
  assert.equal(notifications, 1)
  assert.deepEqual(store.getState().nodes.map((item) => item.id), ['b'])
  assertDerivedState(store.getState())

  // Runtime selection changes do not consume undo history.
  replaceGraphSession(store, [node('selection')], [])
  const selectionNode = store.getState().nodes[0]
  store.getState().setNodes([{ ...selectionNode, selected: true }])
  assert.equal(temporalStore.getState().pastStates.length, 0)

  // Persisted business data still creates an undo record.
  store.getState().updateNode('selection', (current) => ({
    ...current,
    data: { ...current.data, label: 'business-change' },
  }))
  assert.equal(temporalStore.getState().pastStates.length, 1)
  temporalStore.getState().undo()
  assert.equal(store.getState().nodes[0].data.label, 'selection')
  assertDerivedState(store.getState())

  // A room replacement is a session boundary and cannot undo into the previous graph.
  replaceGraphSession(store, [node('old-room')], [])
  store.getState().updateNode('old-room', (current) => ({ ...current, position: { x: 12, y: 8 } }))
  assert.equal(temporalStore.getState().pastStates.length, 1)
  replaceGraphSession(store, [node('new-room')], [])
  assert.equal(temporalStore.getState().pastStates.length, 0)
  assert.equal(temporalStore.getState().futureStates.length, 0)
  temporalStore.getState().undo()
  assert.deepEqual(store.getState().nodes.map((item) => item.id), ['new-room'])

  // A paused interaction commits exactly one undo transaction.
  replaceGraphSession(store, [node('drag')], [])
  const dragBaseline = captureGraphHistorySnapshot(store.getState())
  temporalStore.getState().pause()
  store.getState().setNodesPreservingSelection([
    { ...store.getState().nodes[0], position: { x: 40, y: 24 } },
  ])
  temporalStore.getState().resume()
  assert.equal(commitGraphHistorySnapshot(store, dragBaseline), true)
  assert.equal(temporalStore.getState().pastStates.length, 1)
  temporalStore.getState().undo()
  assert.deepEqual(store.getState().nodes[0].position, { x: 0, y: 0 })
  assertDerivedState(store.getState())

  stopCounting()
  stopDerivedSync()
  console.log('Graph store regression checks verified')
