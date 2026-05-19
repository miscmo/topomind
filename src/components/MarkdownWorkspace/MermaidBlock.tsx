import { memo, useEffect, useId, useMemo, useState } from 'react'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'default',
  flowchart: { htmlLabels: false },
})

interface MermaidBlockProps {
  code: string
}

export const MermaidBlock = memo(function MermaidBlock({ code }: MermaidBlockProps) {
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const instanceId = useId()
  const renderId = useMemo(() => `mermaid-${instanceId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [instanceId])

  useEffect(() => {
    let isCancelled = false

    const renderMermaid = async () => {
      try {
        setError(null)
        setSvgContent(null)
        const { svg } = await mermaid.render(renderId, code)
        if (!isCancelled) {
          setSvgContent(DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } }))
        }
      } catch (err: any) {
        if (!isCancelled) {
          setError(err?.message || String(err))
        }
      }
    }

    renderMermaid()

    return () => {
      isCancelled = true
    }
  }, [code, renderId])

  return (
    <div className="mermaid-block" style={{ margin: '1em 0', border: '1px solid #eaeaea', borderRadius: '4px', padding: '1em', backgroundColor: '#f9f9f9', overflow: 'auto' }}>
      {error ? (
        <div className="mermaid-error" style={{ color: 'red', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Mermaid Render Error:</div>
          {error}
          <hr style={{ borderColor: '#f0ca0f', margin: '8px 0' }} />
          <div style={{ color: '#666' }}>{code}</div>
        </div>
      ) : svgContent ? (
        <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svgContent }} style={{ display: 'flex', justifyContent: 'center' }} />
      ) : (
        <div className="mermaid-loading" style={{ color: '#888', fontStyle: 'italic', textAlign: 'center' }}>
          图表渲染中...
        </div>
      )}
    </div>
  )
})
