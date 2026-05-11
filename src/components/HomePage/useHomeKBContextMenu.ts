import { useEffect, useState } from 'react'
import { useStorage } from '../../core/storage'
import { logAction } from '../../core/log-backend'
import { logger } from '../../core/logger'
import { useConfirmStore } from '../../stores/confirmStore'
import { usePromptStore } from '../../stores/promptStore'
import type { KBItem } from './useHomeKnowledgeBases'

interface KBContextMenu {
  visible: boolean
  x: number
  y: number
  kb: KBItem | null
}

interface UseHomeKBContextMenuOptions {
  ctxMenuClassName: string
  refreshKBList: () => Promise<void>
}

export function useHomeKBContextMenu(options: UseHomeKBContextMenuOptions) {
  const { ctxMenuClassName, refreshKBList } = options
  const storage = useStorage()
  const [ctxMenu, setCtxMenu] = useState<KBContextMenu>({ visible: false, x: 0, y: 0, kb: null })

  const closeCtxMenu = () => {
    setCtxMenu((prev) => ({ ...prev, visible: false }))
  }

  useEffect(() => {
    if (!ctxMenu.visible) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Element
      if (!target.closest(`.${ctxMenuClassName}`) && !target.closest('[class*="card"]')) {
        closeCtxMenu()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ctxMenu.visible, ctxMenuClassName])

  const handleKBRightClick = (e: React.MouseEvent, kb: KBItem) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, kb })
  }

  const handleKBDelete = async () => {
    const kb = ctxMenu.kb
    if (!kb) return
    closeCtxMenu()
    const confirmed = await useConfirmStore.getState().open({
      title: '确认删除',
      message: `确定要删除知识库「${kb.name}」吗？此操作不可恢复。`,
    })
    if (!confirmed) return
    try {
      await storage.deleteKB(kb.name)
      logAction('知识库:删除', 'HomePage', { kbName: kb.name })
      await refreshKBList()
    } catch (err) {
      logger.catch('HomePage', 'handleKBDelete', err)
    }
  }

  const handleKBRename = async () => {
    const kb = ctxMenu.kb
    if (!kb) return
    closeCtxMenu()
    const newName = await usePromptStore.getState().open({
      title: '重命名知识库',
      placeholder: '输入新名称',
      defaultValue: kb.name,
    })
    if (!newName?.trim() || newName === kb.name) return
    try {
      await storage.renameKB(kb.name, newName.trim())
      logAction('知识库:重命名', 'HomePage', { kbName: kb.name, newName })
      await refreshKBList()
    } catch (err) {
      logger.catch('HomePage', 'handleKBRename', err)
    }
  }

  return {
    ctxMenu,
    closeCtxMenu,
    handleKBRightClick,
    handleKBDelete,
    handleKBRename,
  }
}
