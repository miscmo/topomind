import { createExtension, getBlockInfoFromSelection } from '@blocknote/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

type CurrentBlockHighlightState = {
  isFocused: boolean
}

const currentBlockHighlightPluginKey = new PluginKey<CurrentBlockHighlightState>('topomind-current-block-highlight')

function getActiveBlockRanges(state: EditorState) {
  if (state.selection.empty) {
    const blockInfo = getBlockInfoFromSelection(state)
    return [
      {
        from: blockInfo.bnBlock.beforePos,
        to: blockInfo.bnBlock.afterPos,
      },
    ]
  }

  const ranges = new Map<string, { from: number, to: number }>()

  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type.name !== 'blockContainer') {
      return undefined
    }

    const key = `${pos}:${node.nodeSize}`
    if (!ranges.has(key)) {
      ranges.set(key, {
        from: pos,
        to: pos + node.nodeSize,
      })
    }

    return undefined
  })

  if (ranges.size === 0) {
    const blockInfo = getBlockInfoFromSelection(state)
    return [
      {
        from: blockInfo.bnBlock.beforePos,
        to: blockInfo.bnBlock.afterPos,
      },
    ]
  }

  return Array.from(ranges.values())
}

export const currentBlockHighlightExtension = createExtension(({ editor }) => ({
  key: 'topomind-current-block-highlight',
  prosemirrorPlugins: [
    new Plugin<CurrentBlockHighlightState>({
      key: currentBlockHighlightPluginKey,
      state: {
        init: () => ({
          isFocused: false,
        }),
        apply: (tr, pluginState) => {
          const meta = tr.getMeta(currentBlockHighlightPluginKey) as Partial<CurrentBlockHighlightState> | undefined
          if (typeof meta?.isFocused === 'boolean') {
            return {
              isFocused: meta.isFocused,
            }
          }

          return pluginState
        },
      },
      props: {
        handleDOMEvents: {
          focus: (view) => {
            const pluginState = currentBlockHighlightPluginKey.getState(view.state)
            if (!pluginState?.isFocused) {
              view.dispatch(view.state.tr.setMeta(currentBlockHighlightPluginKey, { isFocused: true }))
            }
            return false
          },
          blur: (view) => {
            const pluginState = currentBlockHighlightPluginKey.getState(view.state)
            if (pluginState?.isFocused) {
              view.dispatch(view.state.tr.setMeta(currentBlockHighlightPluginKey, { isFocused: false }))
            }
            return false
          },
        },
        decorations(state) {
          const pluginState = currentBlockHighlightPluginKey.getState(state)

          if (!editor.isEditable || !pluginState?.isFocused) {
            return DecorationSet.empty
          }

          const decorations = getActiveBlockRanges(state).map((range) =>
            Decoration.node(range.from, range.to, {
              'data-current-block': 'true',
            })
          )

          return DecorationSet.create(state.doc, decorations)
        },
      },
    }),
  ],
}))
