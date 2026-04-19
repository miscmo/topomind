import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { logger } from '@/core/logger.js'

// 全局样式
import './css/base.css'
import './css/graph.css'
import './css/nav.css'
import './css/detail.css'
import './css/modal.css'
import './css/home.css'
import './css/git.css'
import './css/badges.css'
import './css/git-panel-inline.css'

const app = createApp(App)
app.use(createPinia())

// 全局未捕获错误处理
app.config.errorHandler = (err, instance, info) => {
  logger.catch('Global', `未捕获错误 [${info || 'unknown'}]`, err)
}

// 全局未处理的 Promise 拒绝
window.addEventListener('unhandledrejection', (event) => {
  logger.catch('Global', '未处理的 Promise 拒绝', event.reason)
})

app.mount('#app')
