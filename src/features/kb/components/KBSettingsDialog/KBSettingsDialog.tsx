import { useEffect, useRef } from 'react'
import { modalOverlayBaseClassName, modalOverlayEnterClassName, modalPanelEnterClassName } from '../../../../shared/ui/modal'
import { useKBSettingsDialogModel, type KBSettingsDialogProps } from './model/useKBSettingsDialogModel'

export function KBSettingsDialog(props: KBSettingsDialogProps) {
  const { visible, onClose } = props
  const { state, actions, refs } = useKBSettingsDialogModel(props)

  const {
    currentKb,
    name,
    coverUrl,
    coverRef,
    coverOffset,
    initialCoverOffset,
    loading,
    error,
    isDragging
  } = state

  const {
    setName,
    setCoverUrl,
    setCoverRef,
    setCoverOffset,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleCoverKeyDown,
    handleSave,
    handleDelete,
    handleCoverUpload
  } = actions

  const { imageRef } = refs
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!visible || !currentKb) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.querySelector<HTMLInputElement>('input[type="text"]')?.focus()
    return () => previousFocusRef.current?.focus()
  }, [currentKb, visible])

  if (!visible || !currentKb) return null

  return (
    <div className={`${modalOverlayBaseClassName} ${modalOverlayEnterClassName} z-[10000]`} onKeyDown={(e) => { if (e.key === 'Escape' && !loading) onClose() }} onClick={(e) => { if (!loading && e.target === e.currentTarget) onClose() }}>
      <div ref={dialogRef} className={`w-[440px] max-w-[90%] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-surface shadow-[var(--shadow-lg)] ${modalPanelEnterClassName}`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="kb-settings-title" aria-describedby={error ? 'kb-settings-error' : undefined}>
        <div className="p-[18px_24px] bg-[var(--color-bg)] border-b border-[var(--color-border-light)] flex justify-between items-center [&>h3]:text-[var(--color-primary)] [&>h3]:text-[16px] [&>h3]:m-0 [&>h3]:font-bold">
          <h3 id="kb-settings-title">知识库设置 - {currentKb.name}</h3>
          <button type="button" aria-label="关闭知识库设置弹窗" className="w-7 h-7 rounded-md border-none bg-[var(--color-hover-bg)] text-[var(--color-text-muted)] cursor-pointer text-[14px] transition-all duration-75 hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={onClose} disabled={loading}>×</button>
        </div>
        <div className="p-[20px_24px]">
          {error && <div id="kb-settings-error" className="text-[#e74c3c] text-[13px] mb-3" role="alert">{error}</div>}

          <div className="mb-4 [&>label]:block [&>label]:text-[var(--color-text-secondary)] [&>label]:text-[13px] [&>label]:mb-1.5 [&>label]:font-medium [&>input]:w-full [&>input]:p-[10px_14px] [&>input]:border [&>input]:border-[var(--color-border)] [&>input]:rounded-lg [&>input]:bg-[var(--color-surface)] [&>input]:text-[var(--color-text-primary)] [&>input]:text-[13px] [&>input]:transition-all [&>input]:duration-75 [&>input]:box-border focus:[&>input]:outline-none focus:[&>input]:border-[var(--color-accent)] focus:[&>input]:shadow-[0_0_0_2px_var(--color-accent-soft)] [&>input::placeholder]:text-[var(--color-text-muted)]">
            <label htmlFor="kb-settings-name">知识库名称</label>
            <input
              id="kb-settings-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={loading}
              placeholder="请输入知识库名称"
            />
          </div>

          <div className="mb-4">
            <label className="block text-[var(--color-text-secondary)] text-[13px] mb-1.5 font-medium">封面设置</label>
            <div className="flex gap-6 items-start">
              {/* Preview Box - matches 1:1 aspect ratio of grid */}
              <div 
                className="w-[140px] h-[140px] bg-gradient-to-br from-muted to-muted/50 rounded-xl overflow-hidden relative flex-shrink-0 border border-[var(--color-border)] shadow-sm group"
                role="slider"
                tabIndex={coverUrl ? 0 : -1}
                aria-label="封面纵向位置"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(coverOffset)}
                aria-valuetext={`纵向位置 ${Math.round(coverOffset)}%`}
                onKeyDown={handleCoverKeyDown}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                {coverUrl ? (
                  <>
                    <img 
                      ref={imageRef}
                      src={coverUrl} 
                      onError={() => { setCoverUrl(''); setCoverRef(''); setCoverOffset(50) }}
                      alt={`${currentKb.name} 的封面预览`}
                      className={`w-full h-full object-cover select-none ${isDragging.current ? 'cursor-grabbing' : 'cursor-grab'}`}
                      style={{ objectPosition: `50% ${coverOffset}%` }}
                      draggable={false}
                    />
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none flex items-center justify-center">
                      <div className="bg-background/80 backdrop-blur-sm text-foreground text-xs px-2 py-1 rounded-md shadow-sm">
                        上下拖动调整
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
                  </div>
                )}
              </div>
              
              {/* Controls */}
              <div className="flex-1 flex flex-col justify-center h-[140px]">
                <p className="text-xs text-muted-foreground mb-4">
                  推荐上传 1:1 比例的图片作为封面。可上下拖动调整展示区域，也可聚焦预览后使用上下方向键微调，按住 Shift 可加速。
                </p>
                <label className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md bg-[var(--color-hover-bg)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] shadow-sm transition-colors hover:bg-[var(--color-bg-muted)] focus-visible:outline-none cursor-pointer border border-[var(--color-border)] w-fit">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleCoverUpload}
                    disabled={loading}
                  />
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                  {coverUrl ? '更换封面图片' : '上传封面图片'}
                </label>
                {coverUrl && (
                  <button 
                    type="button"
                    aria-label="移除封面"
                    onClick={() => { setCoverUrl(''); setCoverRef(''); setCoverOffset(50); }}
                    className="text-xs text-[var(--color-danger)] hover:text-[var(--color-danger-hover)] text-left mt-3 w-fit bg-transparent border-none cursor-pointer p-0"
                    disabled={loading}
                  >
                    移除封面
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="mb-4 [&>label]:block [&>label]:text-[var(--color-text-secondary)] [&>label]:text-[13px] [&>label]:mb-1.5 [&>label]:font-medium [&>input]:w-full [&>input]:p-[10px_14px] [&>input]:border [&>input]:border-[var(--color-border)] [&>input]:rounded-lg [&>input]:bg-[var(--color-surface)] [&>input]:text-[var(--color-text-primary)] [&>input]:text-[13px] [&>input]:transition-all [&>input]:duration-75 [&>input]:box-border focus:[&>input]:outline-none focus:[&>input]:border-[var(--color-accent)] focus:[&>input]:shadow-[0_0_0_2px_var(--color-accent-soft)] [&>input::placeholder]:text-[var(--color-text-muted)]">
            <label>基础信息</label>
            <div className="text-[#666] text-[13px] py-2.5 px-3.5 bg-[#f8f9fa] rounded-lg border border-[#eee]">
              节点数量：<span className="font-semibold text-[#333]">{currentKb.nodeCount ?? '未知'}</span>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-[var(--color-border-light)] flex justify-between items-center">
            <button type="button" className="bg-transparent text-[var(--color-danger)] border border-[var(--color-danger)] p-[8px_16px] rounded-lg text-[13px] font-medium cursor-pointer transition-all duration-75 hover:bg-[var(--color-danger-soft)] hover:border-[var(--color-danger)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleDelete} disabled={loading}>
              删除知识库
            </button>
            <div className="flex gap-3">
              <button type="button" className="bg-[var(--color-hover-bg)] text-[var(--color-text-secondary)] border-none p-[8px_20px] rounded-lg text-[14px] font-medium cursor-pointer transition-all duration-75 hover:bg-[var(--color-bg-muted)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={onClose} disabled={loading}>
                取消
              </button>
              <button type="button" className="bg-[var(--color-accent)] text-white border-none p-[8px_24px] rounded-lg text-[14px] font-semibold cursor-pointer transition-all duration-75 hover:bg-[var(--color-accent-hover)] disabled:opacity-60 disabled:cursor-not-allowed" onClick={handleSave} disabled={loading || !name.trim() || (name.trim() === currentKb.name && !coverRef && coverOffset === initialCoverOffset)}>
                保存设置
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
