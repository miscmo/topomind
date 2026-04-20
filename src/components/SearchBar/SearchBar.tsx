/**
 * 搜索框组件
 */
import { memo } from 'react'
import { useGraphContext } from '../../contexts/GraphContext'
import styles from './SearchBar.module.css'

interface SearchBarProps {
  searchQuery: string
  onSearchChange: (q: string) => void
}

export default memo(function SearchBar({ searchQuery, onSearchChange }: SearchBarProps) {
  const graph = useGraphContext()

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    onSearchChange(q)
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
            onSearchChange('')
            graph.highlightSearch('')
          }}
          title="清除搜索"
        >
          ×
        </button>
      )}
    </div>
  )
})
