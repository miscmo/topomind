import { useRightPanelStore } from '@/features/right-panel/model/rightPanelStore'
import type { StaticContributionRecord } from '@/plugins'
import { toDisposable } from '@/plugins/public/disposables.ts'
import type { Disposable } from '@/plugins/public/disposables'
import { useTabStore } from '@/stores/tabs/tabStore'
import { useThemeStore, type ThemeMode } from '@/stores/themeStore'
import type { RightPanelTab } from '@/types/uiStoreTypes'

type CommandSource = 'host' | 'plugin'

interface HostCommandDefinition {
  id: string
  title: string
  shortcut?: string
  execute: (args?: unknown) => void | Promise<void>
}

interface PluginCommandBridge {
  execute(commandId: string, args?: unknown): Promise<void>
  getStaticCommand(commandId: string): StaticContributionRecord | undefined
  listStaticCommands(): StaticContributionRecord[]
}

export interface RegisteredCommand {
  id: string
  title: string
  shortcut?: string
  source: CommandSource
  pluginId?: string
}

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string'
}

function isRightPanelTab(value: unknown): value is RightPanelTab {
  return value === 'detail' || value === 'style'
}

function readThemeArg(args: unknown): ThemeMode {
  const theme = (args as { theme?: unknown } | undefined)?.theme

  if (!isThemeMode(theme)) {
    throw new Error('theme.set requires args.theme')
  }

  return theme
}

function readRightPanelTabArg(args: unknown): RightPanelTab {
  const tab = (args as { tab?: unknown } | undefined)?.tab

  if (!isRightPanelTab(tab)) {
    throw new Error('rightPanel.reveal requires args.tab')
  }

  return tab
}

async function invokeElectron(channel: string): Promise<void> {
  await (window.electronAPI?.invoke(channel) ?? Promise.resolve(undefined))
}

function createDefaultHostCommands(): HostCommandDefinition[] {
  return [
    {
      id: 'workspace.switch',
      title: '切换工作目录',
      execute: () => invokeElectron('app:switchWorkDir'),
    },
    {
      id: 'home.open',
      title: '返回首页',
      execute: () => {
        useTabStore.getState().activateTab('home')
      },
    },
    {
      id: 'window.minimize',
      title: '最小化窗口',
      execute: () => invokeElectron('app:window:minimize'),
    },
    {
      id: 'window.toggleMaximize',
      title: '切换窗口最大化',
      execute: () => invokeElectron('app:window:toggleMaximize'),
    },
    {
      id: 'window.close',
      title: '关闭窗口',
      shortcut: 'Alt+F4',
      execute: () => invokeElectron('app:window:close'),
    },
    {
      id: 'window.toggleDevTools',
      title: '切换开发者工具',
      shortcut: 'F12',
      execute: () => invokeElectron('app:window:toggleDevTools'),
    },
    {
      id: 'theme.set',
      title: '切换主题',
      execute: (args) => {
        useThemeStore.getState().setTheme(readThemeArg(args))
      },
    },
    {
      id: 'rightPanel.toggle',
      title: '切换右侧面板',
      execute: () => {
        const state = useRightPanelStore.getState()
        if (state.rightPanelCollapsed) {
          state.expandRightPanel()
          return
        }

        state.collapseRightPanel()
      },
    },
    {
      id: 'rightPanel.reveal',
      title: '显示右侧面板标签',
      execute: (args) => {
        const tab = readRightPanelTabArg(args)
        const state = useRightPanelStore.getState()
        state.setRightPanelTab(tab)
        state.expandRightPanel()
      },
    },
  ]
}

export class CommandRegistry {
  private readonly hostCommandsById = new Map<string, HostCommandDefinition>()
  private pluginBridge?: PluginCommandBridge

  registerHostCommand(definition: HostCommandDefinition): Disposable {
    if (this.hostCommandsById.has(definition.id)) {
      throw new Error(`Host command already registered: ${definition.id}`)
    }

    this.hostCommandsById.set(definition.id, definition)
    return toDisposable(() => {
      this.hostCommandsById.delete(definition.id)
    })
  }

  attachPluginBridge(bridge: PluginCommandBridge): void {
    this.pluginBridge = bridge
  }

  async execute(commandId: string, args?: unknown): Promise<void> {
    const hostCommand = this.hostCommandsById.get(commandId)
    if (hostCommand) {
      await hostCommand.execute(args)
      return
    }

    const pluginCommand = this.pluginBridge?.getStaticCommand(commandId)
    if (pluginCommand && this.pluginBridge) {
      await this.pluginBridge.execute(commandId, args)
      return
    }

    throw new Error(`Unknown command: ${commandId}`)
  }

  getCommand(commandId: string): RegisteredCommand | undefined {
    const hostCommand = this.hostCommandsById.get(commandId)
    if (hostCommand) {
      return {
        id: hostCommand.id,
        title: hostCommand.title,
        shortcut: hostCommand.shortcut,
        source: 'host',
      }
    }

    const pluginCommand = this.pluginBridge?.getStaticCommand(commandId)
    if (!pluginCommand) {
      return undefined
    }

    return toPluginCommand(pluginCommand)
  }

  listCommands(): RegisteredCommand[] {
    const hostCommands = [...this.hostCommandsById.values()].map((command) => ({
      id: command.id,
      title: command.title,
      shortcut: command.shortcut,
      source: 'host' as const,
    }))

    const pluginCommands = (this.pluginBridge?.listStaticCommands() ?? []).map(toPluginCommand)

    return [...hostCommands, ...pluginCommands]
  }
}

function toPluginCommand(record: StaticContributionRecord): RegisteredCommand {
  return {
    id: record.contributionId,
    title:
      typeof record.manifestData.title === 'string' ? record.manifestData.title : record.contributionId,
    source: 'plugin',
    pluginId: record.pluginId,
  }
}

let commandRegistrySingleton: CommandRegistry | null = null
let hostCommandsBootstrapped = false

export function getCommandRegistry(): CommandRegistry {
  if (!commandRegistrySingleton) {
    commandRegistrySingleton = new CommandRegistry()
  }

  return commandRegistrySingleton
}

export function bootstrapCommandRegistry(): CommandRegistry {
  const registry = getCommandRegistry()

  if (!hostCommandsBootstrapped) {
    for (const command of createDefaultHostCommands()) {
      registry.registerHostCommand(command)
    }
    hostCommandsBootstrapped = true
  }

  return registry
}

export async function executeCommand(commandId: string, args?: unknown): Promise<void> {
  await bootstrapCommandRegistry().execute(commandId, args)
}
