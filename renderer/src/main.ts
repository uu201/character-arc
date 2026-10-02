import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/global.css'
import { useAppStore } from '@/stores/app'

/**
 * 应用启动入口函数。
 * 创建 Vue 实例 → 注册 Pinia 状态管理 → 挂载加载界面 → 后台初始化全局 Store。
 */
function bootstrap(): void {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)

  const store = useAppStore(pinia)
  app.mount('#app')

  // 先显示加载界面，再从 SQLite 水合工作区，避免数据库读取阻塞首屏。
  void store.initialize()
}

bootstrap()
