import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

// 全局样式
import './css/base.css'
import './css/graph.css'
import './css/nav.css'
import './css/detail.css'
import './css/modal.css'
import './css/home.css'
import './css/git.css'
import './css/badges.css'

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
