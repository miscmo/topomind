/**
 * 搜索框组件
 */
import { memo } from 'react'
import styles from './SearchBar.module.css'
import { logAction } from '../../core/log-backend'

interface SearchBarProps {
  searchQuery: string
  onSearchChange: (q: string) => void
}

export default memo(function SearchBar({ searchQuery, onSearchChange }: SearchBarProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    onSearchChange(query)
    logAction('搜索:输入', 'SearchBar', { query })
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
            logAction('搜索:清除', 'SearchBar', { previousQuery: searchQuery })
            onSearchChange('')
          }}
          title="清除搜索"
        >
          ×
        </button>
      )}
    </div>
  )
})
