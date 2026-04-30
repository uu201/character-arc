import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/global.css'
import { useAppStore } from '@/stores/app'

/**
 * 应用启动入口函数。
 * 创建 Vue 实例 → 注册 Pinia 状态管理 → 初始化全局 Store（从 SQLite 加载持久化数据） → 挂载到 DOM。
 */
async function bootstrap(): Promise<void> {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)

  // 从 SQLite 加载持久化的工作区数据，完成 Store 水合后再挂载 DOM，避免白屏闪烁
  const store = useAppStore(pinia)
  await store.initialize()

  app.mount('#app')
}

void bootstrap()
