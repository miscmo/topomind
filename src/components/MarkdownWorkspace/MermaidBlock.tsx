import { memo, useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'default',
  flowchart: { htmlLabels: false },
})

function hashString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return hash.toString(36)
}

interface MermaidBlockProps {
  code: string
}

export const MermaidBlock = memo(function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isCancelled = false
    const id = `mermaid-${hashString(code)}`

    const renderMermaid = async () => {
      try {
        setError(null)
        setSvgContent(null)
        const { svg } = await mermaid.render(id, code)
        if (!isCancelled) {
          setSvgContent(svg)
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
  }, [code])

  return (
    <div className="mermaid-block" ref={containerRef} style={{ margin: '1em 0', border: '1px solid #eaeaea', borderRadius: '4px', padding: '1em', backgroundColor: '#f9f9f9', overflow: 'auto' }}>
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
