<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { createDiscreteApi, NConfigProvider, NDialogProvider, NGlobalStyle, NMessageProvider, NSpin, darkTheme } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { createNaiveThemeOverrides, getDarkModePreset } from '@/theme/presets'
import ProjectCenter from '@/pages/ProjectCenter.vue'
import ProjectWizardPage from '@/pages/ProjectWizardPage.vue'
import WorkbenchPage from '@/pages/WorkbenchPage.vue'
import ChapterStudioPage from '@/pages/ChapterStudioPage.vue'
import DeconstructionLibraryPage from '@/pages/DeconstructionLibraryPage.vue'
import SkillsPage from '@/pages/SkillsPage.vue'
import CoverWorkbenchPage from '@/pages/CoverWorkbenchPage.vue'
import AiTaskProgressDock from '@/components/AiTaskProgressDock.vue'

// 全局应用状态
const appStore = useAppStore()
// 当前运行平台（win32 / darwin / linux），用于适配标题栏高度
const platform = window.characterArc?.platform ?? 'unknown'
const appName = '弧光'
const appVersion = window.characterArc?.version ?? ''
const { message } = createDiscreteApi(['message'])

// 根据当前选中主题生成 Naive UI 主题覆盖变量
const themeOverrides = computed(() =>
  createNaiveThemeOverrides(
    appStore.theme,
    appStore.appSettings.darkMode,
    appStore.appSettings.darkModeStyle
  )
)
// 深色模式时启用 Naive UI 官方 darkTheme
const naiveTheme = computed(() => appStore.appSettings.darkMode ? darkTheme : null)

// 应用级 CSS 自定义变量集合，供全局样式引用
const appStyleVars = computed(() => {
  const dark = appStore.appSettings.darkMode
  const darkPreset = getDarkModePreset(appStore.appSettings.darkModeStyle)
  return {
    '--arc-bg-body': dark ? darkPreset.bgBody : '#f6f6f7',
    '--arc-bg-weak': dark ? darkPreset.bgWeak : '#fafafb',
    '--arc-bg-surface': dark ? darkPreset.bgSurface : '#ffffff',
    '--arc-bg-surface-hover': dark ? darkPreset.bgSurfaceHover : '#eef0f3',
    '--arc-bg-sidebar': dark ? darkPreset.bgSidebar : '#ececef',
    '--arc-sidebar-border': dark ? darkPreset.sidebarBorder : '#dcdce0',
    '--arc-text-primary': dark ? darkPreset.textPrimary : '#18181b',
    '--arc-text-secondary': dark ? darkPreset.textSecondary : '#52525b',
    '--arc-text-hint': dark ? darkPreset.textHint : '#a1a1aa',
    '--arc-primary': appStore.currentTheme.primary,
    '--arc-primary-hover': appStore.currentTheme.primaryHover,
    '--arc-primary-pressed': appStore.currentTheme.primaryPressed,
    '--arc-primary-soft': dark
      ? `color-mix(in srgb, ${appStore.currentTheme.primary} 18%, ${darkPreset.primarySoftBase})`
      : appStore.currentTheme.softBackground,
    '--arc-border': dark ? darkPreset.border : '#e4e4e7',
    '--arc-border-strong': dark ? darkPreset.borderStrong : '#d4d4d8',
    '--arc-shadow-sm': dark ? darkPreset.shadowSm : '0 1px 3px rgba(0, 0, 0, 0.06)',
    '--arc-shadow-md': dark ? darkPreset.shadowMd : '0 2px 8px rgba(0, 0, 0, 0.07)',
    '--arc-shadow-lg': dark ? darkPreset.shadowLg : '0 4px 16px rgba(0, 0, 0, 0.09)',
    '--arc-bg-mix': dark ? darkPreset.bgMix : '#ffffff',
    '--arc-glass-04': dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
    '--arc-glass-06': dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
    '--arc-glass-08': dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
    '--arc-glass-10': dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.05)',
    '--arc-glass-12': dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
    '--arc-radius-sm': '4px',
    '--arc-radius-md': '6px',
    '--arc-radius-lg': '10px',
    '--arc-titlebar-height': '0px',
    '--arc-window-controls-width': '0px'
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

// 将 CSS 变量同步到 :root，使 Naive UI 弹出层（portal 渲染到 body）也能继承正确的深色值
watch(
  appStyleVars,
  (vars) => {
    for (const [key, value] of Object.entries(vars)) {
      document.documentElement.style.setProperty(key, value)
    }
  },
  { immediate: true }
)

function shouldShowManualSaveToast(): boolean {
  return appStore.currentView === 'chapter-studio' || appStore.activePanel === 'chapters'
}

// Ctrl+S 全局保存快捷键
async function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    await appStore.persistWorkspace()
    if (appStore.persistenceError) {
      if (shouldShowManualSaveToast()) {
        message.error(appStore.persistenceError)
      }
      return
    }
    if (shouldShowManualSaveToast()) {
      message.success('当前章节已保存')
    }
  }
}

function handleBeforeUnload() {
  appStore.flushWorkspaceSync()
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('beforeunload', handleBeforeUnload)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <n-global-style />
        <div class="app-shell" :style="appStyleVars" :class="{ 'dark-mode': appStore.appSettings.darkMode }">
          <div class="app-titlebar">
            <span class="app-titlebar__brand">
              {{ appName }}
              <span v-if="appVersion" class="app-titlebar__version">v{{ appVersion }}</span>
            </span>
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
              <ProjectCenter v-if="appStore.currentView === 'projects'" key="projects" />
              <ProjectWizardPage v-else-if="appStore.currentView === 'wizard'" key="wizard" />
              <ChapterStudioPage v-else-if="appStore.currentView === 'chapter-studio'" key="chapter-studio" />
              <DeconstructionLibraryPage v-else-if="appStore.currentView === 'deconstruction-library'" key="deconstruction-library" />
              <SkillsPage v-else-if="appStore.currentView === 'skills'" key="skills" />
              <CoverWorkbenchPage v-else-if="appStore.currentView === 'cover-workbench'" key="cover-workbench" />
              <WorkbenchPage v-else key="workbench" />
            </Transition>
          </div>
          <AiTaskProgressDock />
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
