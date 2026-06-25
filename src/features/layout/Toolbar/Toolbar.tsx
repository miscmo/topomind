import { memo, useEffect, useRef, useState } from 'react'

interface ToolbarProps {
  zoomLevel: number
  inline?: boolean
}

export default memo(function Toolbar({ zoomLevel, inline = false }: ToolbarProps) {
  const [isVisible, setIsVisible] = useState(false)
  const hideTimerRef = useRef<number | null>(null)
  const isFirstRenderRef = useRef(true)

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }

    setIsVisible(true)

    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
    }

    hideTimerRef.current = window.setTimeout(() => {
      setIsVisible(false)
      hideTimerRef.current = null
    }, 1200)

    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }
  }, [zoomLevel])

  const wrapperClassName = inline
    ? `transition-all duration-200 ${isVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0'}`
    : `pointer-events-none absolute bottom-3 left-3 z-10 transition-all duration-200 ${
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0'
      }`

  return (
    <div
      id="toolbar"
      className={wrapperClassName}
      aria-hidden={!isVisible}
    >
      <div
        className={`flex items-center justify-center font-medium tabular-nums text-[var(--color-text-secondary)] backdrop-blur-xl ${
          inline
            ? 'min-w-[44px] h-5.5 rounded-xl border border-[color:color-mix(in_srgb,var(--color-border)_74%,transparent)] bg-[color:color-mix(in_srgb,var(--titlebar-menu-bg)_88%,transparent)] px-1.5 text-[10px] shadow-[var(--shadow-sm)]'
            : 'min-w-[54px] h-7 rounded-full border border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--titlebar-menu-bg)_84%,transparent)] px-2.5 text-[11px] shadow-[var(--shadow-sm)]'
        }`}
      >
        {`${Math.round(zoomLevel * 100)}%`}
      </div>
    </div>
  )
})
