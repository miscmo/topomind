import { useEffect, useRef } from 'react'

export type KeyCombo = string

export interface ShortcutOptions {
  /** 快捷键生效的作用域。'global' 为全局生效。也可指定具体的 scope 名称，配合 DOM 的 data-shortcut-scope 属性使用 */
  scope?: string
  /** 是否在输入框中生效，默认 false */
  enableInInput?: boolean
  /** 是否阻止默认行为，默认 true */
  preventDefault?: boolean
  /** 是否阻止事件冒泡，默认 false */
  stopPropagation?: boolean
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  if (target.isContentEditable) return true
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

function matchKeyCombo(event: KeyboardEvent, combo: string) {
  const parts = combo.split('+').map((p) => p.trim().toLowerCase())
  const needsCtrl = parts.includes('ctrl') || parts.includes('cmd') || parts.includes('meta') || parts.includes('mod')
  const needsShift = parts.includes('shift')
  const needsAlt = parts.includes('alt')

  const isMac = navigator.userAgent.toLowerCase().includes('mac')
  const hasMod = isMac ? event.metaKey : event.ctrlKey

  if (hasMod !== needsCtrl) return false
  if (event.shiftKey !== needsShift) return false
  if (event.altKey !== needsAlt) return false

  const key = parts.find((p) => !['ctrl', 'cmd', 'meta', 'shift', 'alt', 'mod'].includes(p))
  if (!key) return true

  const eventKey = event.key.toLowerCase()
  const eventCode = event.code.toLowerCase()

  return eventKey === key || eventCode === key
}

/**
 * 统一的快捷键管理 Hook
 * 支持全局快捷键和局部（Scope）快捷键
 * 
 * @example
 * // 仅当焦点在 data-shortcut-scope="canvas" 的容器内时生效
 * useShortcut(['Enter', 'NumpadEnter'], () => { ... }, { scope: 'canvas' })
 */
export function useShortcut(
  keys: KeyCombo[],
  callback: (event: KeyboardEvent) => void,
  options: ShortcutOptions = {}
) {
  const {
    scope = 'global',
    enableInInput = false,
    preventDefault = true,
    stopPropagation = false,
  } = options

  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const keysRef = useRef(keys)
  keysRef.current = keys

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented && scope !== 'global') return
      if (event.repeat) return
      if (event.isComposing) return

      if (!enableInInput && isEditableTarget(event.target)) {
        return
      }

      if (scope !== 'global') {
        const target = event.target as HTMLElement | null
        const closestScopeEl = target?.closest('[data-shortcut-scope]')
        const actualScope = closestScopeEl?.getAttribute('data-shortcut-scope')

        if (actualScope !== scope) {
          return
        }
      }

      const isMatch = keysRef.current.some((combo) => matchKeyCombo(event, combo))
      if (isMatch) {
        if (preventDefault) event.preventDefault()
        if (stopPropagation) event.stopPropagation()
        callbackRef.current(event)
      }
    }

    // 全局快捷键在捕获阶段执行，确保优先级最高
    const useCapture = scope === 'global'
    window.addEventListener('keydown', handleKeyDown, { capture: useCapture })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: useCapture })
  }, [scope, enableInInput, preventDefault, stopPropagation])
}
