/**
 * 房间导航面包屑（画布顶部居中，占据原缩放滑动条的位置）。
 *
 * - 只在「进入二层或更深房间」时出现：路径项 > 1 即 roomHistory 非空，
 *   根房间不渲染任何浮层，画布保持干净。
 * - 一条胶囊走完全程：祖先段可点直达，当前段只读；层级再深也只在条内横向滚动，
 *   不撑宽、不换行、不遮挡画布。没有折叠抽屉、最近打开、撤销前进、查看深度等附加面板。
 * - 视觉全部走 controls.css 的 .tm-crumb* / TM_UI，颜色只引用 tokens.css 变量。
 * - 交互一律 nodrag / nowheel，避免被画布平移缩放手势抢走。
 */
import { memo } from 'react'
import { ChevronRight, Home, MapPin } from 'lucide-react'
import { TM_UI, tmUI } from '../../../../shared/ui/controlStyles'
import {
  compactRoomPath,
  useRoomPathItems,
  useRoomPathNavigate,
} from '../../../layout/Breadcrumb/Breadcrumb'

export default memo(function RoomBreadcrumb({ tabId }: { tabId: string }) {
  const items = useRoomPathItems(tabId)
  const navigate = useRoomPathNavigate(tabId)
  if (items.length < 2) return null

  const path = compactRoomPath(items)

  return (
    <nav
      data-tm-room-breadcrumb=""
      data-tm-room-depth={items.length}
      data-tm-room-path-full={path.full}
      aria-label="房间路径"
      title={path.full}
      className={tmUI('nodrag nowheel pointer-events-auto', TM_UI.crumb)}
    >
      <div
        data-tm-room-path-list=""
        data-tm-room-path-count={items.length}
        className={TM_UI.crumbList}
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          const isRoot = index === 0
          return (
            <span key={item.id} className="inline-flex min-w-0 shrink-0 items-center">
              {index > 0 && (
                <ChevronRight
                  className={tmUI(TM_UI.iconSm, TM_UI.crumbSep)}
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                data-tm-room-path-item={item.path}
                disabled={isLast}
                title={item.label}
                aria-current={isLast ? 'page' : undefined}
                onClick={() => { void navigate(item) }}
                className={tmUI('nodrag nowheel', isLast ? TM_UI.crumbItemCurrent : TM_UI.crumbItem)}
              >
                {isRoot && <Home className={TM_UI.iconSm} aria-hidden="true" />}
                {isLast && !isRoot && <MapPin className={TM_UI.iconSm} aria-hidden="true" />}
                <span className="truncate">{item.label}</span>
              </button>
            </span>
          )
        })}
      </div>
    </nav>
  )
})
