# [OPEN] node-drag-lag

## Symptom
- Dragging nodes in the graph still feels laggy after removing smart guides and snapping.

## Scope
- Workspace: `d:\Code\topomind_cc`
- Area: graph canvas node dragging

## Hypotheses
- A. `onNodesChange` fires too frequently during dragging and triggers expensive graph-wide updates.
- B. Dragging still triggers layout persistence, sync, or other storage writes on the hot path.
- C. Knowledge card nodes re-render excessively while one node is being dragged.
- D. React Flow canvas move/selection/connection side effects are still doing high-frequency work during dragging.

## Plan
1. Add minimal runtime instrumentation only.
2. Reproduce drag lag and collect logs.
3. Analyze evidence before any business logic change.
4. Apply a minimal fix and verify with post-fix logs.
