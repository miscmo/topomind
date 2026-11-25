import { PluginRegistry } from '../src/plugins/host/pluginRegistry.ts'
import { BuiltinPluginLoader } from '../src/plugins/runtime/builtinPluginLoader.ts'
import assert from 'node:assert/strict'

const loader = new BuiltinPluginLoader()
const registry = new PluginRegistry()

for (const descriptor of loader.list()) {
  registry.indexManifest(descriptor.manifest)
}

assert.equal(registry.getManifest('topomind.devtools-sample')?.id, 'topomind.devtools-sample')
assert.equal(registry.getStaticView('devtools.sample')?.pluginId, 'topomind.devtools-sample')
assert.equal(registry.getStaticCommand('devtoolsSample.open')?.pluginId, 'topomind.devtools-sample')
assert.equal(registry.listStaticRecords('topomind.devtools-sample').length, 2)

assert.equal(registry.getManifest('topomind.learning-statistics')?.id, 'topomind.learning-statistics')
assert.equal(registry.getStaticView('learning.statistics')?.pluginId, 'topomind.learning-statistics')
assert.equal(registry.getStaticCommand('learning.open')?.pluginId, 'topomind.learning-statistics')
// 标题栏计时 widget 已下线：当日时长改由宿主 NavRail 的学习记录表盘承载，
// 学习统计插件只贡献 view + command + navItem，不再贡献任何 widget。
assert.equal(registry.getStaticWidget('learning.titlebar.overview'), undefined)
assert.equal(registry.listStaticRecords('topomind.learning-statistics').length, 2)

assert.equal(registry.getManifest('topomind.monitor')?.id, 'topomind.monitor')
assert.equal(registry.getStaticView('monitor.logs')?.pluginId, 'topomind.monitor')
assert.equal(registry.getStaticCommand('monitor.open')?.pluginId, 'topomind.monitor')
assert.equal(registry.listStaticRecords('topomind.monitor').length, 2)

// 导航项是纯静态发现，不进入 staticRecords（既有贡献点计数契约不变），
// 但必须能被宿主按 order 稳定列出并通过命令打开。
assert.equal(registry.getStaticNavItem('monitor.logs')?.pluginId, 'topomind.monitor')
assert.equal(registry.getStaticNavItem('learning.statistics')?.pluginId, 'topomind.learning-statistics')
assert.equal(registry.getStaticNavItem('devtools.sample'), undefined)
assert.equal(
  registry.listStaticNavItems().map((record) => record.contributionId).join(','),
  'learning.statistics,monitor.logs',
)

console.log(
  `Static plugin discovery verified: ${loader.list().map((descriptor) => descriptor.manifest.id).join(', ')}`,
)
