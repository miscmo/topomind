/**
 * 首页：知识库列表
 * 对应原 HomePage.vue
 */
import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useRoomStore, roomStore } from '../stores/roomStore'
import { FSB } from '../core/fs-backend'
import '../css/home.css'

interface KBItem {
  path: string
  name: string
  order: number
  cover?: string
  nodeCount: number | null
  gitStatus: { state: string; [key: string]: unknown } | null
  coverUrl: string | null
}

export default function HomePage() {
  const showGraph = useAppStore((s) => s.showGraph)
  const showSetup = useAppStore((s) => s.showSetup)
  const [loading, setLoading] = useState(false)
  const [kbs, setKbs] = useState<KBItem[]>([])
  const [workDir, setWorkDir] = useState('')
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)

  useEffect(() => {
    loadKBList()
  }, [])

  async function loadKBList() {
    setLoading(true)
    try {
      const [list, dir] = await Promise.all([
        FSB.listChildren(''),
        FSB.getRootDir(),
      ])
      setWorkDir(dir || '')
      // 过滤出目录（知识库）
      const kbList = (list || []).filter((d: { name: string; isDir: boolean }) => d.isDir)
      setKbs(kbList.map((kb: { path: string; name: string }) => ({
        ...kb,
        nodeCount: null,
        gitStatus: null,
        coverUrl: null,
      })))

      // 加载子节点数量
      await Promise.all(
        kbs.map(async (kb) => {
          try {
            const count = await FSB.countChildren(kb.path)
            setKbs((prev) => prev.map((k) => k.path === kb.path ? { ...k, nodeCount: count } : k))
          } catch { /* ignore */ }
        })
      )
    } catch (err) {
      console.error('loadKBList error:', err)
    } finally {
      setLoading(false)
    }
  }

  async function openKB(kb: KBItem) {
    try {
      await FSB.setLastOpenedKB(kb.path)
    } catch { /* ignore */ }
    roomStore.getState().setCurrentKB(kb.path)
    showGraph()
  }

  async function switchWorkDir() {
    setMessage('')
    const res = await FSB.selectExistingWorkDir('')
    if (!res?.valid) {
      if (res?.error) {
        setMessageError(true)
        setMessage(res.error)
      }
      return
    }
    await loadKBList()
  }

  function truncatedWorkDir() {
    if (!workDir) return ''
    return workDir.length <= 48 ? workDir : workDir.slice(0, 12) + '...' + workDir.slice(-32)
  }

  return (
    <div id="home-modal">
      {/* 头部 */}
      <div className="home-header">
        <div className="home-logo">
          <span className="home-logo-icon">🧠</span>
          <div>
            <h1>TopoMind</h1>
            <span>可漫游拓扑知识大脑</span>
          </div>
        </div>
        {workDir && (
          <div className="home-workdir-bar">
            <span className="home-workdir-path" title={workDir}>📂 {truncatedWorkDir()}</span>
            <button className="home-workdir-switch" onClick={switchWorkDir} title="切换工作目录">切换</button>
          </div>
        )}
        {message && (
          <div className={`home-workdir-msg ${messageError ? 'error' : ''}`}>{message}</div>
        )}
      </div>

      {/* 知识库列表 */}
      <div className="home-content">
        {loading && (
          <div className="home-loading-overlay">
            <div className="home-loading-spinner"></div>
            <span>加载中...</span>
          </div>
        )}

        <div className="home-section-title">我的知识库</div>
        <div className="home-grid">
          {kbs.map((kb) => (
            <div key={kb.path} className="home-card" onClick={() => openKB(kb)}>
              <div className="home-card-image">
                {kb.coverUrl ? (
                  <img src={kb.coverUrl} alt={kb.name} />
                ) : (
                  <span className="home-card-image-icon">📚</span>
                )}
              </div>
              <div className="home-card-body">
                <div className="home-card-title">
                  <span>{kb.name}</span>
                </div>
                <div className="home-card-meta">
                  <div className="home-card-meta-row">
                    <span>📊 {kb.nodeCount !== null ? `${kb.nodeCount} 个节点` : '··· 个节点'}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* 新建按钮 */}
          <div className="home-card-add" onClick={() => {/* TODO: show create sheet */ }}>
            <div className="home-card-add-icon">＋</div>
            <div className="home-card-add-text">新建知识库</div>
          </div>

          {/* 导入按钮 */}
          <div className="home-card-add" onClick={() => {/* TODO: show import sheet */ }}>
            <div className="home-card-add-icon">📥</div>
            <div className="home-card-add-text">导入知识库</div>
          </div>
        </div>
      </div>
    </div>
  )
}