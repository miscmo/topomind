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
assert.equal(
  registry.getStaticWidget('learning.titlebar.overview')?.pluginId,
  'topomind.learning-statistics',
)
assert.equal(registry.listStaticRecords('topomind.learning-statistics').length, 3)

assert.equal(registry.getManifest('topomind.monitor')?.id, 'topomind.monitor')
assert.equal(registry.getStaticView('monitor.logs')?.pluginId, 'topomind.monitor')
assert.equal(registry.getStaticCommand('monitor.open')?.pluginId, 'topomind.monitor')
assert.equal(registry.listStaticRecords('topomind.monitor').length, 2)

console.log(
  `Static plugin discovery verified: ${loader.list().map((descriptor) => descriptor.manifest.id).join(', ')}`,
)
