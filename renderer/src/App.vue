<script setup lang="ts">
import { computed, watch } from 'vue'
import { NConfigProvider, NDialogProvider, NGlobalStyle, NMessageProvider, NSpin } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { createNaiveThemeOverrides } from '@/theme/presets'
import ProjectCenter from '@/pages/ProjectCenter.vue'
import ProjectWizardPage from '@/pages/ProjectWizardPage.vue'
import WorkbenchPage from '@/pages/WorkbenchPage.vue'
import ChapterStudioPage from '@/pages/ChapterStudioPage.vue'
import AssistantWindowPage from '@/pages/AssistantWindowPage.vue'
import { isAssistantWindow } from '@/utils/windowKind'

// 全局应用状态
const appStore = useAppStore()
// 当前运行平台（win32 / darwin / linux），用于适配标题栏高度
const platform = window.characterArc?.platform ?? 'unknown'

// 根据当前选中主题生成 Naive UI 主题覆盖变量
const themeOverrides = computed(() => createNaiveThemeOverrides(appStore.theme))

// 应用级 CSS 自定义变量集合，供全局样式引用
const appStyleVars = computed(() => ({
  '--arc-bg-body': '#f5f5f7',              // 页面整体背景色
  '--arc-bg-weak': '#fafafa',              // 弱背景色（辅助区域）
  '--arc-bg-surface': '#ffffff',           // 卡片/面板表面色
  '--arc-bg-surface-hover': '#f2f2f7',     // 表面色悬停态
  '--arc-text-primary': '#202124',         // 主文字颜色
  '--arc-text-secondary': '#5f6368',       // 次要文字颜色
  '--arc-text-hint': '#7a7f87',            // 提示/占位文字颜色
  '--arc-primary': appStore.currentTheme.primary,
  '--arc-primary-hover': appStore.currentTheme.primaryHover,
  '--arc-primary-pressed': appStore.currentTheme.primaryPressed,
  '--arc-primary-soft': appStore.currentTheme.softBackground,
  '--arc-border': '#d4d4d8',              // 常规边框色
  '--arc-border-strong': '#c7c7cf',        // 强调边框色
  '--arc-shadow-sm': '0 1px 4px rgba(0, 0, 0, 0.07)',   // 小阴影
  '--arc-shadow-md': '0 4px 16px rgba(0, 0, 0, 0.09)',   // 中阴影
  '--arc-radius-sm': '4px',               // 小圆角
  '--arc-radius-md': '6px',               // 中圆角
  '--arc-radius-lg': '8px',               // 大圆角
  // 标题栏高度：Windows 使用系统安全区域，macOS 使用固定值，其他平台为 0
  '--arc-titlebar-height': platform === 'win32' ? 'env(titlebar-area-height, 28px)' : platform === 'darwin' ? '24px' : '0px',
  // 窗口控制按钮区域宽度：Windows 使用 CSS 环境变量自适应，macOS 控件在左侧不占右侧宽度
  '--arc-window-controls-width':
    platform === 'win32'
      ? 'max(0px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)))'
      : '0px'
}))

// 监听 UI 缩放比例变化，限制在 0.75~1.75 倍之间并同步给 Electron 窗口
watch(
  () => appStore.appSettings.uiScale,
  async (factor) => {
    const nextFactor = Number.isFinite(factor) ? Math.min(1.75, Math.max(0.75, factor)) : 1
    await window.characterArc.setZoomFactor(nextFactor)
  },
  { immediate: true }
)
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <n-global-style />
        <div class="app-shell" :style="appStyleVars">
          <div class="app-titlebar arc-drag-region"></div>
          <div class="app-content">
            <div v-if="appStore.persistenceError" class="app-error-banner">
              <strong>本地数据读写异常</strong>
              <span>{{ appStore.persistenceError }}</span>
            </div>
            <div v-if="!appStore.hasHydrated" class="app-loading">
              <n-spin size="large" />
              <p>正在载入本地工作区...</p>
            </div>
            <Transition v-else name="view-fade" mode="out-in">
              <AssistantWindowPage v-if="isAssistantWindow" key="assistant-window" />
              <ProjectCenter v-else-if="appStore.currentView === 'projects'" key="projects" />
              <ProjectWizardPage v-else-if="appStore.currentView === 'wizard'" key="wizard" />
              <ChapterStudioPage v-else-if="appStore.currentView === 'chapter-studio'" key="chapter-studio" />
              <WorkbenchPage v-else key="workbench" />
            </Transition>
          </div>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
