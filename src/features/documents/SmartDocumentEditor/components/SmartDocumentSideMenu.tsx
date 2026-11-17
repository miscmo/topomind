import { useLayoutEffect, useRef, useState } from 'react'
import { AddBlockButton, SideMenu, type SideMenuProps, useExtensionState } from '@blocknote/react'
import { useSmartBlockNoteEditor } from '../smartDocumentEditorTypes'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { SmartDocumentBlockMenu } from './SmartDocumentBlockMenu'
import { SmartDocumentDragHandleButton } from './SmartDocumentDragHandleButton'

export function SmartDocumentDragHandleMenu({ children }: { children?: React.ReactNode }) {
  return <SmartDocumentBlockMenu mode="edit">{children}</SmartDocumentBlockMenu>
}

// 块编辑按钮（＋ / ⠿）与正文开头之间的水平缓冲。编辑器自身有 54px 左内边距
// （侧边菜单就活在这条槽里），但原本 hit-area 对顶层块只算了嵌套缩进
// blockIndent（顶层块为 0），导致按钮紧贴文本左缘，鼠标想在开头插入时极易误触。
// 这里补一个固定 gap，把按钮整体往槽里推远，留出安全的点击空白区。
const SIDE_MENU_TEXT_GAP = 10

/** 只有「文字流」块的侧栏才对齐到第一行文字；图片/文件/表格等块仍贴块顶部，
    否则按钮会跟着 caption（它同样是 .bn-inline-content）跑到图片下方去。 */
const TEXT_FLOW_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'quote',
  'toggleListItem',
])

/** 非文本块回退：沿用 BlockNote 默认侧栏槽的高度，按钮落在块顶部往下 15px。 */
const FALLBACK_SLOT_HEIGHT = 30

type LineBox = { top: number; height: number }

/**
 * 取块「第一行文字」的矩形，作为侧栏按钮要对齐的目标。
 * 用 Range 而不是元素矩形：多行段落的元素中心会落在段落中部，而按钮应该贴第一行。
 */
function getBlockFirstLineRect(
  blockElement: HTMLElement | null | undefined,
  blockType: string | undefined,
): LineBox | null {
  if (!blockElement) return null
  if (!blockType || TEXT_FLOW_BLOCK_TYPES.has(blockType)) {
    const inline = blockElement.querySelector('.bn-inline-content')
    if (inline?.firstChild) {
      try {
        const range = document.createRange()
        range.selectNodeContents(inline)
        const first = range.getClientRects()[0]
        if (first && first.height > 0) return { top: first.top, height: first.height }
      } catch {
        // Range 取不到就退回下面的整块矩形
      }
    }
  }
  const rect = blockElement.getBoundingClientRect()
  return { top: rect.top, height: Math.min(rect.height, FALLBACK_SLOT_HEIGHT) }
}

/**
 * 把侧栏按钮垂直对齐到块的「第一行文字」中心。
 *
 * 为什么必须在运行时量：侧栏是 floating-ui **portal 到 body** 的浮层，不在
 * .smart-document-content 子树里，因此拿不到编辑器容器上的字号 / 间距变量，
 * 也无法用 :has() 判断「上一块是不是标题」；而 BlockNote 默认按 data-level 写死
 * .bn-side-menu 的高度（30/108/84/67px，为旧字号阶梯设计），一旦标题间距因
 * 「首块 / 连续标题」收紧，按钮就会相对文字明显偏下（H2→H3 连续时最明显）。
 * 实测是唯一对所有级别、所有场景都成立的做法。
 *
 * 基准取 SideMenuExtension 给的 referencePos.y（浮动层的定位原点，即块的左上角），
 * 而不是菜单自身的矩形：菜单刚挂载那一帧 floating-ui 可能还没落位，量到的
 * getBoundingClientRect 是 0 附近的临时值，会算出上百像素的荒唐偏移。
 */
function useSideMenuVerticalNudge(
  referenceY: number | undefined,
  blockElement: HTMLElement | null | undefined,
  blockType: string | undefined,
  areaRef: React.RefObject<HTMLDivElement | null>,
) {
  useLayoutEffect(() => {
    const area = areaRef.current
    if (!area || referenceY == null) return
    const menu = area.querySelector<HTMLElement>('.bn-side-menu')
    if (!menu) return
    // 先清零再量高度：留着上一次的偏移会把结果累加进去。
    menu.style.marginTop = ''
    const lineRect = getBlockFirstLineRect(blockElement, blockType)
    if (!lineRect) return
    const menuHeight = menu.getBoundingClientRect().height
    const delta = lineRect.top + lineRect.height / 2 - (referenceY + menuHeight / 2)
    if (Math.abs(delta) > 0.5) {
      menu.style.marginTop = `${delta}px`
    }
    // blockElement 每次渲染重新查询，引用稳定；referenceY / blockType 随悬停块变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceY, blockElement, blockType])
}

/**
 * 侧栏（以及展开后的块菜单）是 portal 到 body 的浮层，不受编辑器滚动容器裁剪。
 * 当块贴着正文顶部时，浮层会越过滚动区上边界，压在文档层级面包屑栏上；
 * 面包屑下拉展开后，菜单还会以更高 z-index 穿透下拉列表。
 * 这里只判断上边界：向下超出正文底部不挡面包屑，仍可正常使用。
 * 命中的浮层保留 DOM（只加标记由 CSS 隐藏），这样滚动/菜单收起后能自动恢复。
 */
function useSideMenuTopBoundGuard(
  areaRef: React.RefObject<HTMLDivElement | null>,
  editor: ReturnType<typeof useSmartBlockNoteEditor>,
  referenceY: number | undefined,
  blockId: string | undefined,
) {
  const [outside, setOutside] = useState(false)

  useLayoutEffect(() => {
    const area = areaRef.current
    const scroller = editor.domElement?.closest<HTMLElement>('.tm-smart-editor-scroll')
    if (!area || !scroller || referenceY == null || !blockId) {
      setOutside((prev) => (prev ? false : prev))
      return
    }

    // 只判断侧栏命中区（＋/⠿ 手柄）本身是否越过正文上边界：贴顶 / 滚出顶部的
    // 块手柄才会压在面包屑栏上。绝不能把展开后的块菜单（.tm-smart-block-menu）
    // 算进来——它是 400px+ 的大浮层，点击靠近视口底部的块时 floating-ui 会把它
    // 向上 flip，顶部自然越过 scrollerTop，这是正常弹层行为；旧实现把它当越界，
    // 150ms 后隐藏，正是用户看到的「菜单一闪而过」（与面包屑下拉无关）。
    // 面包屑下拉展开期间的让位由 CSS 的 body:has(...) 规则单独负责。
    const measure = () => {
      const scrollerTop = scroller.getBoundingClientRect().top
      const rect = area.getBoundingClientRect()
      // rect.top ≈ 0 是 floating-ui 尚未落位的临时坐标，跳过，避免误判越界。
      return rect.height > 0 && rect.top > 0 && rect.top < scrollerTop - 1
    }

    // 越界需持续一段时间才隐藏，避开 floating-ui 落位 / scroll 的中间态；
    // 不再越界立即恢复。逐帧复算保证状态不粘滞。
    let pendingTimer: ReturnType<typeof setTimeout> | null = null
    const evaluate = (confirmed: boolean) => {
      if (!measure()) {
        if (pendingTimer !== null) {
          clearTimeout(pendingTimer)
          pendingTimer = null
        }
        setOutside((prev) => (prev ? false : prev))
        return
      }
      if (confirmed) {
        pendingTimer = null
        setOutside((prev) => (prev ? prev : true))
        return
      }
      if (pendingTimer === null) {
        pendingTimer = setTimeout(() => evaluate(true), 150)
      }
    }

    const check = () => evaluate(false)
    let raf = 0
    const tick = () => {
      check()
      raf = requestAnimationFrame(tick)
    }

    check()
    raf = requestAnimationFrame(tick)
    scroller.addEventListener('scroll', check, { passive: true })

    return () => {
      cancelAnimationFrame(raf)
      if (pendingTimer !== null) clearTimeout(pendingTimer)
      scroller.removeEventListener('scroll', check)
    }
  }, [areaRef, editor, referenceY, blockId])

  return outside
}

export function SmartDocumentSideMenu(props: SideMenuProps) {
  const editor = useSmartBlockNoteEditor()
  const sideMenuState = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state ? {
      block: state.block,
      referenceX: state.referencePos.x,
      referenceY: state.referencePos.y,
    } : undefined,
  })
  const block = sideMenuState?.block
  const blockElement = block
    ? editor.domElement?.querySelector<HTMLElement>(
      `[data-node-type="blockContainer"][data-id="${CSS.escape(block.id)}"]`,
    )
    : undefined
  const blockIndent = blockElement && sideMenuState
    ? Math.max(0, blockElement.getBoundingClientRect().x - sideMenuState.referenceX)
    : 0
  const isEmptyBlock = Array.isArray(block?.content) && block.content.length === 0

  const areaRef = useRef<HTMLDivElement | null>(null)
  useSideMenuVerticalNudge(sideMenuState?.referenceY, blockElement, block?.type, areaRef)
  const outsideTopBound = useSideMenuTopBoundGuard(areaRef, editor, sideMenuState?.referenceY, block?.id)

  if (!block) {
    return null
  }

  return (
    <div
      ref={areaRef}
      className="tm-smart-side-menu-hit-area"
      data-smart-document-side-menu
      data-tm-side-menu-outside={outsideTopBound ? 'true' : undefined}
      style={{ paddingRight: `${blockIndent + SIDE_MENU_TEXT_GAP}px` }}
    >
      <SideMenu {...props}>
        {isEmptyBlock ? <AddBlockButton /> : null}
        <SmartDocumentDragHandleButton {...props} dragHandleMenu={SmartDocumentDragHandleMenu} />
      </SideMenu>
    </div>
  )
}
