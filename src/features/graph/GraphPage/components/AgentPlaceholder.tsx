/**
 * Left Dock 的 'agent' 页面入口（P0 起为真实会话面板）。
 *
 * 文件名保持不变：NodeTreePanel.tsx 的引用、NavRail 的竖 tab、Dock 外壳、
 * GUI 稳定选择器与 verify-critical 静态锁都依赖这个路径。真正实现放在
 * src/features/ai-agent/AgentPanel.tsx（host feature，不是插件），
 * 这样 Dock 外壳零改动，也不让 features/graph 反向依赖 AI 模块内部。
 */
export { default } from '@/features/ai-agent/AgentPanel'
