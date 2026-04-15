# TopoMind 任务追踪

## Bug 修复

- [x] 1. [严重] 去掉工作目录设置，软件自动记录打开的知识库目录
- [x] 2. [严重] Markdown 图片自动适配宽度
- [x] 3. [严重] Markdown 链接默认浏览器打开
- [x] 4. [严重] Markdown 宽度记忆（关闭再打开保持上次宽度）
- [x] 5. [中等] 边框颜色修改不生效
- [x] 6. [中等] Tab 切换知识库后左右栏内容串页（每个 Tab 必须完全独立）
- [x] 7. [中等] 节点改名后详情页标题不更新
- [x] 8. [中等] 删除键全局返回首页，需禁用该快捷键，并检查所有不合理快捷键
- [x] 9. [中等] 切换知识库后图谱样式错乱（灰白、连线粗、节点椭圆）
- [x] 10. [轻微] 新节点添加文档后图标不实时显示
- [x] 11. [低] 软件重启后 MD 宽度重置问题
- [x] 12. [严重] 切换知识库后图谱样式丢失（cy-manager activate 后重新应用 stylesheet）

## 功能开发

- [x] 1. [高] 首页导入已存在知识库（验证知识库合法性）✅ 已有完整UI（openImportForm + selectExistingKB + importKB）
- [x] 2. [高] 图谱下方只保留放大缩小、显示比例，其他按钮全部删除 ✅ 仅有 + - 按钮和缩放比例显示
- [x] 3. [高] Git 面板迁移到左侧 Tab，包含：变更查看、提交、推送、拉取、合并、冲突解决 ✅ 已实现于 GraphView.vue
- [x] 4. [高] 主页知识库封面只展示 Git 状态，不提供操作按钮 ✅ 移除 openInFinder 按钮，保留设置按钮
- [x] 5. [高] 节点名统一使用 meta_data 中的 name 字段，文件夹名自动处理特殊字符、自动去重 ✅ file-service.js 的 safeSegment/uniqueFolderName 自动处理，移除前端非法字符拦截
- [x] 6. [中] 节点上调节大小、增加连线 ✅ 已完整实现（resizeHandleEl + connectHandleEl）
- [x] 7. [中] 编辑框内 MD 语法高亮 ✅ CodeMirror 6 已配置 syntaxHighlighting(defaultHighlightStyle)
- [x] 8. [中] 梳理并优化自动保存策略 ✅ 图谱 debounced 300ms + 关键操作立即 flush + before-quit 钩子
- [x] 9. [中] 合并卡片路径显示，只保留一条路径，顶层显示知识库名称 ✅ Breadcrumb 组件已正确实现
- [x] 10. [中] 主页知识库右上角增加设置按钮，封面设置、删除、重命名统一放弹窗，删除二次确认 ✅ 已添加 hover 显示的设置按钮（⚙）
- [x] 11. [中] 封面图片支持拖动裁剪选择区域（类头像裁剪）
- [x] 12. [中] 知识库支持自定义排序
- [x] 13. [低] 字体大小设置增加增减步进按钮，每次调整2 ✅ StylePanel.vue 已有 -/+ 按钮
- [x] 14. [低] 文档、子节点数等标记放到文字最前面同一行，不独占一行 ✅ HTML标签内 childCount 以 inline-flex 形式展示
- [x] 15. [低] 编辑器第一列与行号之间间距问题修复 ✅ detail.css 添加 gutter padding
- [x] 16. [待定] 图谱连线支持弯曲 ✅ edge 已使用 curve-style: bezier

## 架构优化

- [x] 架构优化（所有 bug 和功能完成后执行）

---

## 当前进度

当前处理: 全部完成 ✅
最后更新: 2026/04/15

## Bug 修复 #12 验证说明
- cy-manager.js: 在 activate() 函数中，mount() 成功后添加 cy.style(GRAPH_STYLE) 防御性重置样式表
- 根因：切换知识库时 Cytoscape 实例通过 mount/unmount 切换，styles 在某些场景下未被正确应用
- 修复：activate() 后重新调用 cy.style() 确保 stylesheet 始终生效
- 已提交: 635a588

## 架构优化验证说明
- useGraph.js: 移除所有 debug console.log 语句（generateNodeLabelHtml, _setupHtmlLabels, _refreshHtmlLabels, updateNodeStyle）
- useGraph.js: 移除 shadowOpacity 死代码（3 处：新建节点默认样式、toMeta、styleMap）
- useGraph.js: 优化 buildCurrentMetaFor —— 使用内存中的 currentMeta 替代冗余的 storage.readLayout + normalizeMeta 调用，节省一次 I/O 和重复归一化
- storage.js: 移除未使用的 INVALID_NAME_CHARS 常量
- GraphView.vue: 抽取 startStyleResize/startDetailResize 重复逻辑为 useResizeDrag composable（支持方向参数的统一拖拽处理器）
- 新增: src/composables/useResizeDrag.js（通用面板拖拽缩放逻辑，58 行）

## 功能开发验证说明
- #1: HomePage.vue lines 116-160 完整实现 selectExistingKB + importKB
- #2: GraphView.vue lines 69-72 仅 + - 按钮
- #3: GraphView.vue 已有左 Tab 结构 + GitPanel.vue
- #4: HomePage.vue 移除 path 显示 + 添加设置按钮
- #5: file-service.js safeSegment/uniqueFolderName + storage.js 移除非法字符检查
- #6: useGraph.js resizeHandleEl + connectHandleEl 已完整实现
- #7: DetailPanel.vue CodeMirror 已配置 syntaxHighlighting
- #8: storage.js saveGraphDebounced(300ms) + flushGraphSave + before-quit 钩子
- #9: Breadcrumb.vue + room.js breadcrumbs 已正确实现
- #10: HomePage.vue 添加设置按钮 + 设置弹窗含删除/重命名
- #11: HomePage.vue 裁剪弹窗模板 + JS函数（cropRect/onCropMouseDown/Move/Up + apply/cancelCoverCrop） + home.css 裁剪样式
- #12: file-service.js listChildren 排序 + createKB/importKB 分配 order + HomePage.vue 拖拽排序（dragKBIndex/dragOverIndex + onKBDragStart/Over/Leave/Drop/End） + home.css 拖拽样式
- #13: StylePanel.vue stepFontSize(-2/+2) 已实现
- #14: useGraph.js childCount inline-flex 展示
- #15: detail.css gutter padding 已修复
- #16: useGraph.js edge 已用 curve-style: bezier
