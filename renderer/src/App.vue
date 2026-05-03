<script setup lang="ts">
import { computed, watch } from 'vue'
import { NConfigProvider, NDialogProvider, NGlobalStyle, NMessageProvider, NSpin, darkTheme } from 'naive-ui'
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
const appVersion = window.characterArc?.version ?? '0.0.0'
const appTitle = `弧光 v${appVersion}`

// 根据当前选中主题生成 Naive UI 主题覆盖变量
const themeOverrides = computed(() => createNaiveThemeOverrides(appStore.theme))
// 深色模式时启用 Naive UI 官方 darkTheme
const naiveTheme = computed(() => appStore.appSettings.darkMode ? darkTheme : null)

// 应用级 CSS 自定义变量集合，供全局样式引用
const appStyleVars = computed(() => {
  const dark = appStore.appSettings.darkMode
  return {
    '--arc-bg-body': dark ? '#0c0c0e' : '#f4f4f5',
    '--arc-bg-weak': dark ? '#111115' : '#fafafa',
    '--arc-bg-surface': dark ? '#18181b' : '#ffffff',
    '--arc-bg-surface-hover': dark ? '#27272a' : '#f9f9fb',
    '--arc-bg-sidebar': dark ? '#111115' : '#fafafa',
    '--arc-sidebar-border': dark ? '#27272a' : '#e5e7eb',
    '--arc-text-primary': dark ? '#f4f4f5' : '#18181b',
    '--arc-text-secondary': dark ? '#a1a1aa' : '#52525b',
    '--arc-text-hint': dark ? '#71717a' : '#a1a1aa',
    '--arc-primary': appStore.currentTheme.primary,
    '--arc-primary-hover': appStore.currentTheme.primaryHover,
    '--arc-primary-pressed': appStore.currentTheme.primaryPressed,
    '--arc-primary-soft': dark
      ? `color-mix(in srgb, ${appStore.currentTheme.primary} 18%, #18181b)`
      : appStore.currentTheme.softBackground,
    '--arc-border': dark ? '#27272a' : '#e5e7eb',
    '--arc-border-strong': dark ? '#3f3f46' : '#d1d5db',
    '--arc-shadow-sm': dark ? '0 1px 3px rgba(0, 0, 0, 0.36)' : '0 1px 3px rgba(0, 0, 0, 0.06)',
    '--arc-shadow-md': dark ? '0 4px 12px rgba(0, 0, 0, 0.5)' : '0 2px 8px rgba(0, 0, 0, 0.07)',
    '--arc-shadow-lg': dark ? '0 8px 24px rgba(0, 0, 0, 0.6)' : '0 4px 16px rgba(0, 0, 0, 0.09)',
    '--arc-bg-mix': dark ? '#18181b' : '#ffffff',
    '--arc-glass-04': dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
    '--arc-glass-06': dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
    '--arc-glass-08': dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
    '--arc-glass-10': dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.05)',
    '--arc-glass-12': dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
    '--arc-radius-sm': '4px',
    '--arc-radius-md': '6px',
    '--arc-radius-lg': '10px',
    // 标题栏高度：Windows 使用系统安全区域，macOS 使用固定值，其他平台为 0
    '--arc-titlebar-height': platform === 'win32' ? 'env(titlebar-area-height, 28px)' : platform === 'darwin' ? '24px' : '0px',
    // 窗口控制按钮区域宽度：Windows 使用 CSS 环境变量自适应，macOS 控件在左侧不占右侧宽度
    '--arc-window-controls-width':
      platform === 'win32'
        ? 'max(0px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)))'
        : '0px'
  }
})

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
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <n-global-style />
        <div class="app-shell" :style="appStyleVars" :class="{ 'dark-mode': appStore.appSettings.darkMode }">
          <div class="app-titlebar arc-drag-region">
            <span class="app-titlebar__label">{{ appTitle }}</span>
          </div>
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

<style scoped>
.app-titlebar {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding-top: 4px;
  padding-right: calc(var(--arc-window-controls-width) + 16px);
  padding-left: 16px;
  color: var(--arc-text-hint);
  pointer-events: none;
}

.dark-mode .app-titlebar {
  color: var(--arc-text-hint);
}

.app-titlebar__label {
  max-width: min(60vw, 420px);
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
