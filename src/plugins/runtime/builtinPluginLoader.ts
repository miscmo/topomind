import devtoolsSampleManifest from '../builtin/devtools-sample/manifest.json' with { type: 'json' }
import learningStatisticsManifest from '../builtin/learning-statistics/manifest.json' with { type: 'json' }
import monitorManifest from '../builtin/monitor/manifest.json' with { type: 'json' }
import { validatePluginManifest } from '../host/pluginManifest.ts'
import type { BuiltinPluginDescriptor } from '../host/pluginTypes'
import type { TopoMindPluginModule } from '../public/plugin'

interface BuiltinPluginSource {
  manifestData: unknown
  loadModule: () => Promise<unknown>
}

const builtinPluginSources: BuiltinPluginSource[] = [
  {
    manifestData: devtoolsSampleManifest,
    loadModule: () => import('../builtin/devtools-sample/index.tsx'),
  },
  {
    manifestData: learningStatisticsManifest,
    loadModule: () => import('../builtin/learning-statistics/index.ts'),
  },
  {
    manifestData: monitorManifest,
    loadModule: () => import('../builtin/monitor/index.ts'),
  },
]

function normalizeBuiltinModule(candidate: unknown): TopoMindPluginModule {
  const moduleValue =
    candidate && typeof candidate === 'object' && 'default' in candidate
      ? (candidate as { default: unknown }).default
      : candidate

  if (
    !moduleValue ||
    typeof moduleValue !== 'object' ||
    typeof (moduleValue as TopoMindPluginModule).activate !== 'function'
  ) {
    throw new Error('Builtin plugin module must export a default object with an activate() function')
  }

  return moduleValue as TopoMindPluginModule
}

export class BuiltinPluginLoader {
  private readonly descriptorsByPluginId = new Map<string, BuiltinPluginDescriptor>()

  constructor(sources: BuiltinPluginSource[] = builtinPluginSources) {
    for (const source of sources) {
      const manifest = validatePluginManifest(source.manifestData)

      if (this.descriptorsByPluginId.has(manifest.id)) {
        throw new Error(`Duplicate builtin plugin id: ${manifest.id}`)
      }

      this.descriptorsByPluginId.set(manifest.id, {
        manifest,
        loadModule: async () => normalizeBuiltinModule(await source.loadModule()),
      })
    }
  }

  list(): BuiltinPluginDescriptor[] {
    return [...this.descriptorsByPluginId.values()]
  }

  get(pluginId: string): BuiltinPluginDescriptor | undefined {
    return this.descriptorsByPluginId.get(pluginId)
  }
}
