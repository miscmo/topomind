/**
 * 搜索框组件
 */
import { useAppStore } from '../../stores/appStore'
import { useGraphContext } from '../../contexts/GraphContext'
import styles from './SearchBar.module.css'

export default function SearchBar() {
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const graph = useGraphContext()

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    setSearchQuery(q)
    graph.highlightSearch(q)
  }

  return (
    <div id="search-box" className={styles.searchBox}>
      <input
        id="search-input"
        className={styles.input}
        type="text"
        placeholder="搜索节点..."
        value={searchQuery}
        onChange={handleChange}
      />
      {searchQuery && (
        <button
          className={styles.clearBtn}
          onClick={() => {
            setSearchQuery('')
            graph.highlightSearch('')
          }}
          title="清除搜索"
        >
          ×
        </button>
      )}
    </div>
  )
}
