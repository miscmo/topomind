# Debug Session: smart-doc-save-loop
- **Status**: [OPEN]
- **Issue**: 打开智能文档后即出现底部状态栏“未保存 / 保存中”来回切换，版本号持续递增，即使用户未进行任何编辑。
- **Debug Server**: Pending
- **Log File**: .dbg/trae-debug-log-smart-doc-save-loop.ndjson

## Reproduction Steps
1. 打开前端并进入包含智能文档的节点详情。
2. 不做任何编辑，只打开文档。
3. 观察底部状态栏在“未保存 / 保存中”之间持续切换。
4. 观察版本号持续增长。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | 文档初始化阶段存在重复 `onChange` 回写，导致无编辑也持续产出新草稿 | High | Low | Inconclusive |
| B | 智能文档运行时结构（schema/title/version 等）与持久化结构不一致，被误计入内容比较 | High | Medium | Confirmed |
| C | 自动保存成功后，`savedContent`/dirty 基线未及时更新，导致始终判脏 | High | Medium | Confirmed |
| D | 打开文档时有两条保存链或重复 flush 并发执行，导致版本持续上涨 | Medium | Medium | Rejected |

## Log Evidence
- 日志 [trae-debug-log-smart-doc-save-loop.ndjson:L72-L80](file:///d:/Code/topomind_cc/.dbg/trae-debug-log-smart-doc-save-loop.ndjson#L72-L80) 显示：
  - 文档刚打开时 `draft` 为带 `schema/title/version` 的 5-block 结构，而 `saved` 先是 `{}`，随后加载为仅含持久化字段的 5-block 结构。
  - 在 [L74](file:///d:/Code/topomind_cc/.dbg/trae-debug-log-smart-doc-save-loop.ndjson#L74-L74) 中，`draft` 与 `saved` 的 `serializedLength`、`blocks`、`updatedAt` 都一致，但 `isEqual` 仍为 `false`，说明比较命中了未被规范化的结构差异。
- 日志 [L77-L87](file:///d:/Code/topomind_cc/.dbg/trae-debug-log-smart-doc-save-loop.ndjson#L77-L87) 显示：
  - `autosave` 因 `isDirty=true` 被调度。
  - 每次 `handleSave` 成功后版本递增，但下一轮 `isEqualBeforeSave` 仍为 `false`，说明不是保存失败，而是保存后的 dirty 基线仍不相等。
- 日志 [L2-L19](file:///d:/Code/topomind_cc/.dbg/trae-debug-log-smart-doc-save-loop.ndjson#L2-L19) 显示多次保存呈严格串行，每次都是前一次成功后再进入下一次调度，没有重叠中的冲突信号。

## Verification Conclusion
- 根因是智能文档的“编辑器运行时结构”和“数据库持久化结构”不一致，导致 `areDocumentContentsEqual()` 永远返回 `false`，从而持续触发 autosave，带动版本号不断增长。
- 下一步最小修复：
  1. 在内容比较层统一剥离智能文档的运行时装饰字段。
  2. 在智能文档持久化层只写入稳定的持久化结构，避免后续再次产生富结构草稿。
