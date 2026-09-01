/**
 * 给 BlockNote 默认块规格注入 `lastModified` 属性（副作用模块）。
 *
 * ⚠️ 加载顺序至关重要：本模块必须在本应用任何 `@blocknote/react` 被加载之前执行。
 *    `@blocknote/react` 在「模块加载时」就用 `defaultBlockSpecs` 的 `config.propSchema`
 *    为默认块创建 React 渲染规格，并把 `propSchema` 捕获进渲染闭包（见
 *    `blocknote-react.js` 顶层的 `Z(config, implementation)` → `Jr` 读 `config.propSchema`）。
 *    若 mutation 晚于 `@blocknote/react` 加载，则渲染层 captured 的 propSchema 不含
 *    `lastModified`，而 core 的 `nodeToBlock` 因 schema 含 `lastModified` 会把该属性写进
 *    `block.props`，二者不一致 → 渲染崩
 *    `TypeError: Cannot read properties of undefined (reading 'default')`。
 *
 *    因此把 mutation 放在入口（main.tsx）最先执行的副作用模块里，保证顺序：
 *    先改 `defaultBlockSpecs`，再让 `@blocknote/react` 加载并捕获带 `lastModified` 的 propSchema。
 *
 * 自定义块（codeBlock/mermaid/math）经由 schema.extend 传入，由 React 在
 * `useCreateBlockNote` 运行时转换，能拿到带 `lastModified` 的 config，无需在此处理。
 */
import { defaultBlockSpecs } from '@blocknote/core'

export const lastModifiedPropSpec = { default: 0 }

for (const spec of Object.values(defaultBlockSpecs as Record<string, any>)) {
  const config = (spec as any).config
  if (config && config.propSchema && !('lastModified' in config.propSchema)) {
    config.propSchema = { ...config.propSchema, lastModified: lastModifiedPropSpec }
  }
}
