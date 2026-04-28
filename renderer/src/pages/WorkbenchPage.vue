<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ChevronLeft,
  FileText,
  Globe2,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Users,
  GitMerge
} from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import OverviewPanel from '@/components/OverviewPanel.vue'
import WorldviewPanel from '@/components/WorldviewPanel.vue'
import CharactersPanel from '@/components/CharactersPanel.vue'
import OutlinePanel from '@/components/OutlinePanel.vue'
import ChaptersPanel from '@/components/ChaptersPanel.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import AiAssistantPanel from '@/components/AiAssistantPanel.vue'
import SearchResultsPanel from '@/components/SearchResultsPanel.vue'
import type { PanelName } from '@/types/app'

const appStore = useAppStore()
const isSidebarOpen = ref(true)
const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
const panelSearch = reactive<Record<string, string>>({
  overview: '',
  world: '',
  characters: '',
  outline: '',
  chapters: '',
  settings: ''
})
const searchKeyword = ref(panelSearch[appStore.activePanel] ?? '')

const sidebarItems = [
  { id: 'overview', label: '作品概览', icon: LayoutDashboard },
  { id: 'world', label: '世界观设定', icon: Globe2 },
  { id: 'characters', label: '角色图鉴', icon: Users },
  { id: 'outline', label: '剧情大纲', icon: GitMerge },
  { id: 'chapters', label: '章节创作', icon: FileText }
] as const

const activePanelLabel = computed(
  () => sidebarItems.find((item) => item.id === appStore.activePanel)?.label ?? '项目工作台'
)
const normalizedSearch = computed(() => searchKeyword.value.trim())
const isSearchMode = computed(() => normalizedSearch.value.length > 0)
const activeViewLabel = computed(() => (isSearchMode.value ? '项目搜索' : activePanelLabel.value))
const shouldShowAssistant = computed(() => appStore.activePanel === 'chapters' && appStore.aiVisible && !isSearchMode.value)

const isCompactSidebar = computed(() => viewportWidth.value <= 1280)
const shouldRenderSidebarLabels = computed(() => isSidebarOpen.value && !isCompactSidebar.value)

function toggleSidebar(): void {
  if (isCompactSidebar.value) {
    return
  }

  isSidebarOpen.value = !isSidebarOpen.value
}

function clearSearchForPanel(panel: PanelName): void {
  panelSearch[panel] = ''
}

function openSearchResult(payload: { panel: PanelName; chapterId?: string }): void {
  clearSearchForPanel(appStore.activePanel)
  clearSearchForPanel(payload.panel)
  searchKeyword.value = ''

  if (payload.chapterId) {
    appStore.selectChapter(payload.chapterId)
    return
  }

  appStore.setPanel(payload.panel)
}

function syncViewportState(): void {
  viewportWidth.value = window.innerWidth

  // 在较窄的桌面窗口下强制切换到图标侧栏，优先为正文留空间。
  if (viewportWidth.value <= 1280) {
    isSidebarOpen.value = false
    return
  }

  isSidebarOpen.value = true
}

onMounted(() => {
  syncViewportState()
  window.addEventListener('resize', syncViewportState)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewportState)
})

watch(
  () => appStore.activePanel,
  (panel) => {
    searchKeyword.value = panelSearch[panel] ?? ''
  },
  { immediate: true }
)

watch(searchKeyword, (value) => {
  // Remember the latest search per panel so switching between modules feels contextual rather than destructive.
  panelSearch[appStore.activePanel] = value
})
</script>

<template>
  <section class="workspace">
    <aside class="sidebar" :class="{ collapsed: !isSidebarOpen || isCompactSidebar }">
      <div class="sidebar-top arc-drag-region">
        <button class="top-icon arc-no-drag" @click="appStore.backToProjects()">
          <ChevronLeft :size="18" />
        </button>
        <span v-if="shouldRenderSidebarLabels" class="project-title">{{ appStore.currentProject?.title ?? '未命名作品' }}</span>
        <button class="top-icon arc-no-drag" :disabled="isCompactSidebar" :class="{ disabled: isCompactSidebar }" @click="toggleSidebar">
          <PanelLeftClose v-if="isSidebarOpen && !isCompactSidebar" :size="18" />
          <PanelLeftOpen v-else :size="18" />
        </button>
      </div>

      <nav class="sidebar-nav">
        <button
          v-for="item in sidebarItems"
          :key="item.id"
          class="sidebar-item"
          :class="{ active: appStore.activePanel === item.id }"
          @click="appStore.setPanel(item.id)"
        >
          <component :is="item.icon" :size="20" class="sidebar-icon" />
          <span v-if="shouldRenderSidebarLabels">{{ item.label }}</span>
        </button>
      </nav>

      <div class="sidebar-bottom">
        <button
          class="sidebar-item"
          :class="{ active: appStore.activePanel === 'settings' }"
          @click="appStore.setPanel('settings')"
        >
          <Settings :size="20" class="sidebar-icon" />
          <span v-if="shouldRenderSidebarLabels">项目设置</span>
        </button>
      </div>
    </aside>

    <main class="main-shell">
      <header class="workspace-header arc-drag-region">
        <div class="breadcrumb">
          <span>项目工作台</span>
          <ChevronLeft :size="14" class="crumb-sep" />
          <span class="active-crumb">{{ activeViewLabel }}</span>
        </div>

        <div class="header-tools arc-no-drag">
          <div class="search-box arc-no-drag">
            <Search :size="14" />
            <input v-model="searchKeyword" type="text" placeholder="搜索设定、角色或内容..." />
          </div>
          <button class="profile-badge arc-no-drag">U</button>
        </div>
      </header>

      <div class="workspace-body arc-scrollbar">
        <Transition name="panel-switch" mode="out-in">
          <SearchResultsPanel
            v-if="isSearchMode"
            key="search-results"
            :query="normalizedSearch"
            @open-result="openSearchResult"
          />
          <OverviewPanel v-else-if="appStore.activePanel === 'overview'" key="overview" :search-query="normalizedSearch" />
          <WorldviewPanel v-else-if="appStore.activePanel === 'world'" key="world" :search-query="normalizedSearch" />
          <CharactersPanel v-else-if="appStore.activePanel === 'characters'" key="characters" :search-query="normalizedSearch" />
          <OutlinePanel v-else-if="appStore.activePanel === 'outline'" key="outline" :search-query="normalizedSearch" />
          <ChaptersPanel v-else-if="appStore.activePanel === 'chapters'" key="chapters" :search-query="normalizedSearch" />
          <SettingsPanel v-else key="settings" />
        </Transition>
      </div>
    </main>
    <AiAssistantPanel v-if="shouldShowAssistant" />
  </section>
</template>

<style scoped>
.workspace {
  display: flex;
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  background: #f5f5f7;
  color: #1d1d1f;
}

.sidebar {
  display: flex;
  width: 260px;
  flex-shrink: 0;
  flex-direction: column;
  border-right: 1px solid rgba(229, 231, 235, 0.75);
  background: rgba(245, 245, 247, 0.8);
  backdrop-filter: blur(32px);
  transition: width 0.3s ease;
}

.sidebar.collapsed {
  width: 80px;
}

.sidebar-top {
  display: flex;
  height: 60px;
  align-items: center;
  gap: 10px;
  padding:
    calc(var(--arc-titlebar-height) + 8px)
    16px
    8px;
}

.project-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
  font-weight: 650;
}

.top-icon {
  display: inline-flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 14px;
  background: transparent;
  color: #86868b;
  cursor: pointer;
  transition: all 0.22s ease;
}

.top-icon:hover {
  background: rgba(0, 0, 0, 0.04);
  color: #1d1d1f;
}

.top-icon.disabled {
  cursor: default;
  opacity: 0.45;
}

.top-icon.disabled:hover {
  background: transparent;
  color: #86868b;
}

.sidebar-nav {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
}

.sidebar-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  border: none;
  border-radius: 16px;
  background: transparent;
  color: #515154;
  cursor: pointer;
  padding: 13px 14px;
  font-size: 14px;
  font-weight: 550;
  text-align: left;
  transition: all 0.22s ease;
}

.sidebar-item:hover {
  background: rgba(0, 0, 0, 0.04);
  color: #1d1d1f;
}

.sidebar-item.active {
  background: white;
  color: var(--arc-primary);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.04);
}

.sidebar-item.active .sidebar-icon {
  color: var(--arc-primary);
}

.sidebar-icon {
  flex-shrink: 0;
  color: #86868b;
}

.sidebar-bottom {
  padding: 12px;
  margin-top: auto;
}

.main-shell {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  border-top: 1px solid rgba(243, 244, 246, 0.8);
  border-left: 1px solid rgba(243, 244, 246, 0.8);
  border-top-left-radius: clamp(24px, 3vw, 34px);
  background: white;
  box-shadow: -10px 0 30px rgba(0, 0, 0, 0.02);
}

.workspace-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(243, 244, 246, 0.8);
  background: rgba(255, 255, 255, 0.84);
  backdrop-filter: blur(18px);
  padding:
    calc(var(--arc-titlebar-height) + 6px)
    max(32px, calc(var(--arc-window-controls-width) + 18px))
    12px
    32px;
}

.breadcrumb {
  display: inline-flex;
  align-items: center;
  color: #86868b;
  font-size: 13px;
}

.crumb-sep {
  margin: 0 8px;
  transform: rotate(180deg);
}

.active-crumb {
  color: #1d1d1f;
  font-weight: 600;
}

.header-tools {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.search-box {
  position: relative;
  display: inline-flex;
  width: clamp(180px, 24vw, 280px);
  min-width: 160px;
  align-items: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: #f5f5f7;
  color: #9ca3af;
  padding: 10px 14px;
  transition: all 0.24s ease;
}

.search-box:focus-within {
  border-color: color-mix(in srgb, var(--arc-primary) 25%, white);
  background: white;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--arc-primary) 12%, transparent);
}

.search-box input {
  width: 100%;
  border: none;
  background: transparent;
  color: #1d1d1f;
  font-size: 14px;
  outline: none;
}

.search-box input::placeholder {
  color: #9ca3af;
}

.profile-badge {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(219, 234, 254, 1), rgba(199, 210, 254, 1));
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}

.workspace-body {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  padding: clamp(18px, 2.4vw, 32px);
}

.panel-switch-enter-active,
.panel-switch-leave-active {
  transition: all 0.24s ease;
}

.panel-switch-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.panel-switch-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

@media (max-width: 1280px) {
  .sidebar {
    width: 88px;
  }

  .sidebar.collapsed {
    width: 72px;
  }

  .project-title,
  .sidebar-item span {
    display: none;
  }

  .sidebar-item {
    justify-content: center;
    padding-inline: 0;
  }

  .sidebar-top {
    justify-content: center;
    gap: 8px;
    padding-inline: 8px;
  }
}

@media (max-width: 1180px) {
  .workspace-header {
    gap: 16px;
    padding:
      calc(var(--arc-titlebar-height) + 6px)
      max(24px, calc(var(--arc-window-controls-width) + 18px))
      12px
      24px;
  }

  .workspace-body {
    padding: 24px;
  }
}

@media (max-width: 960px) {
  .workspace-header {
    min-height: auto;
    align-items: flex-start;
    flex-direction: column;
    padding:
      calc(var(--arc-titlebar-height) + 10px)
      max(20px, calc(var(--arc-window-controls-width) + 16px))
      16px
      20px;
  }

  .header-tools {
    width: 100%;
    justify-content: space-between;
  }

  .search-box {
    width: min(100%, 420px);
    flex: 1;
  }

  .workspace-body {
    padding: 20px;
  }
}

@media (max-width: 820px) {
  .header-tools {
    flex-wrap: wrap;
    gap: 12px;
  }

  .profile-badge {
    margin-left: auto;
  }

  .workspace-body {
    padding: 16px;
  }
}
</style>
