<script setup lang="ts">
import { computed, watch } from 'vue'
import { NConfigProvider, NDialogProvider, NGlobalStyle, NMessageProvider, NSpin } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { createNaiveThemeOverrides } from '@/theme/presets'
import ProjectCenter from '@/pages/ProjectCenter.vue'
import ProjectWizardPage from '@/pages/ProjectWizardPage.vue'
import WorkbenchPage from '@/pages/WorkbenchPage.vue'
import ChapterStudioPage from '@/pages/ChapterStudioPage.vue'

const appStore = useAppStore()
const platform = window.characterArc?.platform ?? 'unknown'

const themeOverrides = computed(() => createNaiveThemeOverrides(appStore.theme))
const appStyleVars = computed(() => ({
  '--arc-bg-body': '#f5f5f7',
  '--arc-bg-weak': '#fafafa',
  '--arc-bg-surface': '#ffffff',
  '--arc-bg-surface-hover': '#f2f2f7',
  '--arc-text-primary': '#202124',
  '--arc-text-secondary': '#5f6368',
  '--arc-text-hint': '#7a7f87',
  '--arc-primary': appStore.currentTheme.primary,
  '--arc-primary-hover': appStore.currentTheme.primaryHover,
  '--arc-primary-pressed': appStore.currentTheme.primaryPressed,
  '--arc-primary-soft': appStore.currentTheme.softBackground,
  '--arc-border': '#d4d4d8',
  '--arc-border-strong': '#c7c7cf',
  '--arc-shadow-sm': '0 1px 4px rgba(0, 0, 0, 0.07)',
  '--arc-shadow-md': '0 4px 16px rgba(0, 0, 0, 0.09)',
  '--arc-radius-sm': '4px',
  '--arc-radius-md': '6px',
  '--arc-radius-lg': '8px',
  '--arc-titlebar-height': platform === 'win32' ? '28px' : platform === 'darwin' ? '24px' : '0px',
  '--arc-window-controls-width': platform === 'win32' ? '138px' : '0px'
}))

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
              <ProjectCenter v-if="appStore.currentView === 'projects'" key="projects" />
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
