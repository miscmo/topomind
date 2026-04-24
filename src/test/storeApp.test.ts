/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '../stores/appStore'
import { useRoomStore } from '../stores/roomStore'

// Note: Zustand stores are singletons — use getState() for vanilla (non-hook) access.
// Reset state in beforeEach so tests are fully isolated.

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      view: 'setup',
      selectedNodeId: null,
      edgeMode: false,
      edgeModeSourceId: null,
      showGitPanel: false,
      rightPanelCollapsed: false,
      rightPanelWidth: 320,
      showGrid: true,
      searchQuery: '',
      contextMenu: { visible: false, x: 0, y: 0, type: null, targetId: null },
      kbRefreshTrigger: 0,
    })
  })

  // --- View transitions ---
  it('defaults to setup view', () => {
    expect(useAppStore.getState().view).toBe('setup')
  })

  it('showGraph switches view to graph', () => {
    useAppStore.getState().showGraph()
    expect(useAppStore.getState().view).toBe('graph')
  })

  it('showHome switches view to home', () => {
    useAppStore.getState().showHome()
    expect(useAppStore.getState().view).toBe('home')
  })

  it('showSetup switches view to setup', () => {
    useAppStore.setState({ view: 'home' })
    useAppStore.getState().showSetup()
    expect(useAppStore.getState().view).toBe('setup')
  })

  // --- Selection ---
  it('selectNode sets selectedNodeId', () => {
    useAppStore.getState().selectNode('node-1')
    expect(useAppStore.getState().selectedNodeId).toBe('node-1')
  })

  it('selectNode with null clears selection', () => {
    useAppStore.setState({ selectedNodeId: 'node-1' })
    useAppStore.getState().selectNode(null)
    expect(useAppStore.getState().selectedNodeId).toBeNull()
  })

  it('clearSelection resets selectedNodeId and edgeMode', () => {
    useAppStore.setState({ selectedNodeId: 'node-1', edgeMode: true, edgeModeSourceId: 'node-2' })
    useAppStore.getState().clearSelection()
    const s = useAppStore.getState()
    expect(s.selectedNodeId).toBeNull()
    expect(s.edgeMode).toBe(false)
    expect(s.edgeModeSourceId).toBeNull()
  })

  // --- Edge mode ---
  it('enterEdgeMode sets edgeMode and sourceId', () => {
    useAppStore.getState().enterEdgeMode('node-3')
    const s = useAppStore.getState()
    expect(s.edgeMode).toBe(true)
    expect(s.edgeModeSourceId).toBe('node-3')
  })

  it('exitEdgeMode clears edgeMode state', () => {
    useAppStore.setState({ edgeMode: true, edgeModeSourceId: 'node-3' })
    useAppStore.getState().exitEdgeMode()
    const s = useAppStore.getState()
    expect(s.edgeMode).toBe(false)
    expect(s.edgeModeSourceId).toBeNull()
  })

  // --- Git panel ---
  it('toggleGitPanel flips showGitPanel', () => {
    const store = useAppStore.getState()
    expect(store.showGitPanel).toBe(false)
    store.toggleGitPanel()
    expect(useAppStore.getState().showGitPanel).toBe(true)
    useAppStore.getState().toggleGitPanel()
    expect(useAppStore.getState().showGitPanel).toBe(false)
  })

  // --- Right panel ---
  it('collapseRightPanel sets rightPanelCollapsed to true', () => {
    useAppStore.getState().collapseRightPanel()
    expect(useAppStore.getState().rightPanelCollapsed).toBe(true)
  })

  it('expandRightPanel sets rightPanelCollapsed to false', () => {
    useAppStore.setState({ rightPanelCollapsed: true })
    useAppStore.getState().expandRightPanel()
    expect(useAppStore.getState().rightPanelCollapsed).toBe(false)
  })

  it('setRightPanelWidth updates rightPanelWidth', () => {
    useAppStore.getState().setRightPanelWidth(480)
    expect(useAppStore.getState().rightPanelWidth).toBe(480)
  })

  // --- Context menu ---
  it('showContextMenu opens contextMenu at coordinates', () => {
    useAppStore.getState().showContextMenu(100, 200, 'node', 'node-5')
    const s = useAppStore.getState().contextMenu
    expect(s.visible).toBe(true)
    expect(s.x).toBe(100)
    expect(s.y).toBe(200)
    expect(s.type).toBe('node')
    expect(s.targetId).toBe('node-5')
  })

  it('showContextMenu defaults targetId to null', () => {
    useAppStore.getState().showContextMenu(50, 60, 'pane')
    expect(useAppStore.getState().contextMenu.targetId).toBeNull()
  })

  it('hideContextMenu closes contextMenu', () => {
    useAppStore.setState({
      contextMenu: { visible: true, x: 100, y: 200, type: 'node', targetId: 'n1' },
    })
    useAppStore.getState().hideContextMenu()
    const s = useAppStore.getState().contextMenu
    expect(s.visible).toBe(false)
    // Coordinates should be preserved (contextMenu object is spread, not replaced)
    expect(s.x).toBe(100)
    expect(s.y).toBe(200)
  })

  // --- KB refresh trigger ---
  it('triggerKBRefresh increments kbRefreshTrigger', () => {
    expect(useAppStore.getState().kbRefreshTrigger).toBe(0)
    useAppStore.getState().triggerKBRefresh()
    expect(useAppStore.getState().kbRefreshTrigger).toBe(1)
    useAppStore.getState().triggerKBRefresh()
    expect(useAppStore.getState().kbRefreshTrigger).toBe(2)
  })

  // --- Grid ---
  it('toggleGrid flips showGrid', () => {
    expect(useAppStore.getState().showGrid).toBe(true)
    useAppStore.getState().toggleGrid()
    expect(useAppStore.getState().showGrid).toBe(false)
    useAppStore.getState().toggleGrid()
    expect(useAppStore.getState().showGrid).toBe(true)
  })

  // --- Search ---
  it('setSearchQuery updates searchQuery', () => {
    useAppStore.getState().setSearchQuery('transformer')
    expect(useAppStore.getState().searchQuery).toBe('transformer')
  })

  it('setSearchQuery clears searchQuery with empty string', () => {
    useAppStore.setState({ searchQuery: 'transformer' })
    useAppStore.getState().setSearchQuery('')
    expect(useAppStore.getState().searchQuery).toBe('')
  })
})

describe('roomStore', () => {
  beforeEach(() => {
    useRoomStore.setState({
      currentKBPath: null,
      currentRoomPath: null,
      currentRoomName: '全局',
      roomHistory: [],
      loading: false,
    })
  })

  // --- Initial state ---
  it('defaults to global view', () => {
    const s = useRoomStore.getState()
    expect(s.currentRoomPath).toBeNull()
    expect(s.currentRoomName).toBe('全局')
    expect(s.roomHistory).toEqual([])
    expect(s.loading).toBe(false)
  })

  // --- enterRoom ---
  it('enterRoom from global sets current room and clears history', () => {
    useRoomStore.getState().enterRoom({ path: 'kb1/roomA', kbPath: 'kb1', name: 'Room A' })
    const s = useRoomStore.getState()
    expect(s.currentRoomPath).toBe('kb1/roomA')
    expect(s.currentKBPath).toBe('kb1')
    expect(s.currentRoomName).toBe('Room A')
    expect(s.roomHistory).toEqual([])
  })

  it('enterRoom from inside a room pushes current to history', () => {
    useRoomStore.setState({ currentRoomPath: 'kb1/roomA', currentKBPath: 'kb1', currentRoomName: 'Room A' })
    useRoomStore.getState().enterRoom({ path: 'kb1/roomA/sub', kbPath: 'kb1', name: 'Sub Room' })

    const s = useRoomStore.getState()
    expect(s.currentRoomPath).toBe('kb1/roomA/sub')
    expect(s.currentRoomName).toBe('Sub Room')
    expect(s.roomHistory).toHaveLength(1)
    expect(s.roomHistory[0].room.path).toBe('kb1/roomA')
  })

  // --- goBack ---
  it('goBack returns null when history is empty', () => {
    expect(useRoomStore.getState().goBack()).toBeNull()
  })

  it('goBack pops last history item and returns to global when history becomes empty', () => {
    // Directly set up: history = [roomA], current = roomA/sub
    useRoomStore.setState({
      currentRoomPath: 'kb1/roomA/sub',
      currentKBPath: 'kb1',
      currentRoomName: 'Sub',
      roomHistory: [{ room: { path: 'kb1/roomA', kbPath: 'kb1', name: 'Room A' } }],
    })
    const popped = useRoomStore.getState().goBack()
    const s = useRoomStore.getState()
    // goBack pops the room we were previously in: 'roomA' (the item IN history)
    expect(popped?.room.path).toBe('kb1/roomA')
    // newHistory is empty → return to global view (current becomes null)
    expect(s.currentRoomPath).toBeNull()
    expect(s.currentRoomName).toBe('全局')
    expect(s.roomHistory).toHaveLength(0)
  })

  it('goBack pops last history item and moves to previous room when history has items', () => {
    // Directly set up: history = [roomA, sub], current = deep
    useRoomStore.setState({
      currentRoomPath: 'kb1/roomA/sub/deep',
      currentKBPath: 'kb1',
      currentRoomName: 'Deep',
      roomHistory: [
        { room: { path: 'kb1/roomA', kbPath: 'kb1', name: 'Room A' } },
        { room: { path: 'kb1/roomA/sub', kbPath: 'kb1', name: 'Sub' } },
      ],
    })
    const popped = useRoomStore.getState().goBack()
    const s = useRoomStore.getState()
    // goBack pops the room we were previously in: 'sub' (the item IN history)
    expect(popped?.room.path).toBe('kb1/roomA/sub')
    // newHistory = [roomA], not empty → prevItem = newHistory[last] = roomA
    // Sets current to roomA (not sub!)
    expect(s.currentRoomPath).toBe('kb1/roomA')
    expect(s.currentRoomName).toBe('Room A')
    expect(s.roomHistory).toHaveLength(1)
    expect(s.roomHistory[0].room.path).toBe('kb1/roomA')
  })

  // --- exitToGlobal ---
  it('exitToGlobal returns to global and clears history', () => {
    useRoomStore.setState({
      currentRoomPath: 'kb1/roomA',
      currentKBPath: 'kb1',
      currentRoomName: 'Room A',
      roomHistory: [{ room: { path: 'kb1/roomB', kbPath: 'kb1', name: 'Room B' } }],
    })
    useRoomStore.getState().exitToGlobal()
    const s = useRoomStore.getState()
    expect(s.currentRoomPath).toBeNull()
    expect(s.currentRoomName).toBe('全局')
    expect(s.roomHistory).toEqual([])
  })

  // --- navigateToHistoryIndex ---
  it('navigateToHistoryIndex moves to target index and trims forward history', () => {
    useRoomStore.setState({
      currentRoomPath: 'kb1/roomA',
      currentKBPath: 'kb1',
      currentRoomName: 'Room A',
      roomHistory: [
        { room: { path: 'kb1/roomB', kbPath: 'kb1', name: 'Room B' } },
        { room: { path: 'kb1/roomC', kbPath: 'kb1', name: 'Room C' } },
      ],
    })
    useRoomStore.getState().navigateToHistoryIndex(1)
    const s = useRoomStore.getState()
    expect(s.currentRoomPath).toBe('kb1/roomC')
    expect(s.currentRoomName).toBe('Room C')
    expect(s.roomHistory).toHaveLength(1)
    expect(s.roomHistory[0].room.path).toBe('kb1/roomB')
  })

  it('navigateToHistoryIndex ignores out-of-bounds index', () => {
    useRoomStore.setState({
      currentRoomPath: 'kb1/roomA',
      currentKBPath: 'kb1',
      currentRoomName: 'Room A',
      roomHistory: [{ room: { path: 'kb1/roomB', kbPath: 'kb1', name: 'Room B' } }],
    })
    useRoomStore.getState().navigateToHistoryIndex(5)
    const s = useRoomStore.getState()
    expect(s.currentRoomPath).toBe('kb1/roomA')
    expect(s.currentRoomName).toBe('Room A')
  })

  it('navigateToHistoryIndex ignores negative index', () => {
    useRoomStore.setState({
      currentRoomPath: 'kb1/roomA',
      currentKBPath: 'kb1',
      currentRoomName: 'Room A',
      roomHistory: [{ room: { path: 'kb1/roomB', kbPath: 'kb1', name: 'Room B' } }],
    })
    useRoomStore.getState().navigateToHistoryIndex(-1)
    const s = useRoomStore.getState()
    expect(s.currentRoomPath).toBe('kb1/roomA')
  })

  // --- clearRoom ---
  it('clearRoom resets all room state to defaults', () => {
    useRoomStore.setState({
      currentRoomPath: 'kb1/roomA',
      currentKBPath: 'kb1',
      currentRoomName: 'Room A',
      roomHistory: [{ room: { path: 'kb1/roomB', kbPath: 'kb1', name: 'Room B' } }],
      loading: true,
    })
    useRoomStore.getState().clearRoom()
    const s = useRoomStore.getState()
    expect(s.currentRoomPath).toBeNull()
    expect(s.currentKBPath).toBeNull()
    expect(s.currentRoomName).toBe('全局')
    expect(s.roomHistory).toEqual([])
    expect(s.loading).toBe(false)
  })

  // --- setLoading ---
  it('setLoading updates loading flag', () => {
    expect(useRoomStore.getState().loading).toBe(false)
    useRoomStore.getState().setLoading(true)
    expect(useRoomStore.getState().loading).toBe(true)
    useRoomStore.getState().setLoading(false)
    expect(useRoomStore.getState().loading).toBe(false)
  })

  // --- setCurrentKB ---
  it('setCurrentKB updates currentKBPath', () => {
    useRoomStore.getState().setCurrentKB('kb2')
    expect(useRoomStore.getState().currentKBPath).toBe('kb2')
  })

  // --- restoreRoomState ---
  it('restoreRoomState restores full room state snapshot', () => {
    const snapshot = {
      kbPath: 'kb1',
      roomHistory: [
        { room: { path: 'kb1/roomA', kbPath: 'kb1', name: 'Room A' } },
        { room: { path: 'kb1/roomA/sub', kbPath: 'kb1', name: 'Sub' } },
      ],
      currentRoomPath: 'kb1/roomA/sub' as string | null,
      currentRoomName: 'Sub',
    }
    useRoomStore.getState().restoreRoomState(snapshot)
    const s = useRoomStore.getState()
    expect(s.currentKBPath).toBe('kb1')
    expect(s.currentRoomPath).toBe('kb1/roomA/sub')
    expect(s.currentRoomName).toBe('Sub')
    expect(s.roomHistory).toHaveLength(2)
  })

  // --- Computed helpers ---
  it('isInRoom returns true when currentRoomPath is not null', () => {
    useRoomStore.setState({ currentRoomPath: 'kb1/roomA' })
    expect(useRoomStore.getState().isInRoom()).toBe(true)
    useRoomStore.setState({ currentRoomPath: null })
    expect(useRoomStore.getState().isInRoom()).toBe(false)
  })

  it('isGlobalView returns true when currentRoomPath is null', () => {
    useRoomStore.setState({ currentRoomPath: null })
    expect(useRoomStore.getState().isGlobalView()).toBe(true)
    useRoomStore.setState({ currentRoomPath: 'kb1/roomA' })
    expect(useRoomStore.getState().isGlobalView()).toBe(false)
  })

  it('getBreadcrumbs returns history items plus current room if inside a room', () => {
    useRoomStore.setState({
      currentRoomPath: 'kb1/roomA',
      currentKBPath: 'kb1',
      currentRoomName: 'Room A',
      roomHistory: [{ room: { path: 'kb1/roomB', kbPath: 'kb1', name: 'Room B' } }],
    })
    const crumbs = useRoomStore.getState().getBreadcrumbs()
    expect(crumbs).toHaveLength(2)
    expect(crumbs[0].room.path).toBe('kb1/roomB')
    expect(crumbs[1].room.path).toBe('kb1/roomA')
  })

  it('getBreadcrumbs returns only history items when in global view', () => {
    useRoomStore.setState({
      currentRoomPath: null,
      currentKBPath: 'kb1',
      currentRoomName: '全局',
      roomHistory: [{ room: { path: 'kb1/roomB', kbPath: 'kb1', name: 'Room B' } }],
    })
    const crumbs = useRoomStore.getState().getBreadcrumbs()
    expect(crumbs).toHaveLength(1)
    expect(crumbs[0].room.path).toBe('kb1/roomB')
  })

  // --- goToRoom ---
  it('goToRoom navigates to a room in history by truncating history', () => {
    // Setup: current = roomA, history = [roomB, roomA/sub, roomA/sub/deep]
    useRoomStore.setState({
      currentRoomPath: 'kb1/roomA',
      currentKBPath: 'kb1',
      currentRoomName: 'Room A',
      roomHistory: [
        { room: { path: 'kb1/roomB', kbPath: 'kb1', name: 'Room B' } },
        { room: { path: 'kb1/roomA/sub', kbPath: 'kb1', name: 'Sub' } },
        { room: { path: 'kb1/roomA/sub/deep', kbPath: 'kb1', name: 'Deep' } },
      ],
    })
    // goToRoom truncates history up to and including the target idx=1
    // newHistory = history.slice(0, 1) = [roomB]
    // current becomes roomA/sub
    useRoomStore.getState().goToRoom({ room: { path: 'kb1/roomA/sub', kbPath: 'kb1', name: 'Sub' } })
    const s = useRoomStore.getState()
    expect(s.currentRoomPath).toBe('kb1/roomA/sub')
    expect(s.currentRoomName).toBe('Sub')
    expect(s.roomHistory).toHaveLength(1)
    expect(s.roomHistory[0].room.path).toBe('kb1/roomB')
  })

  it('goToRoom with unknown path calls enterRoom and appends', () => {
    useRoomStore.setState({
      currentRoomPath: 'kb1/roomA',
      currentKBPath: 'kb1',
      currentRoomName: 'Room A',
      roomHistory: [],
    })
    useRoomStore.getState().goToRoom({ room: { path: 'kb1/roomB', kbPath: 'kb1', name: 'Room B' } })
    const s = useRoomStore.getState()
    expect(s.currentRoomPath).toBe('kb1/roomB')
    expect(s.currentRoomName).toBe('Room B')
    expect(s.roomHistory).toHaveLength(1)
    expect(s.roomHistory[0].room.path).toBe('kb1/roomA')
  })
})
