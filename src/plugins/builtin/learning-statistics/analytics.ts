/**
 * 学习统计算法入口。
 *
 * 实现已收敛到 @/shared/utils/learningAnalytics —— 插件边界禁止插件直接引用
 * features/、stores/ 等目录（见 scripts/verify-plugin-boundaries.mts），
 * 而这套算法同时被学习计时引擎与本页面共用，因此放在 shared 下由两侧共同引用。
 *
 * 本文件保留为转出口，插件内部各面板的 import 无需改动。
 */
// 用相对路径而非 "@/shared/..." 别名：verify-plugin-runtime-guards 等脚本以原生
// Node 加载插件模块，无法解析别名（边界规则对相对形式与别名形式一视同仁）。
export * from '../../../shared/utils/learningAnalytics.ts'
