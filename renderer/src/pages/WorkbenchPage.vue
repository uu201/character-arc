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
import SettingsPanel from '@/components/SettingsPanel.vue'
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
          <SettingsPanel v-else key="settings" />
        </Transition>
      </div>
    </main>
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
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
}

.sidebar {
  display: flex;
  width: 224px;
  flex-shrink: 0;
  flex-direction: column;
  border-right: 1px solid var(--arc-border);
  background: var(--arc-bg-body);
  transition: width 0.22s ease;
}

.sidebar.collapsed {
  width: 60px;
}

.sidebar-top {
  display: flex;
  height: 56px;
  align-items: center;
  gap: 8px;
  padding:
    calc(var(--arc-titlebar-height) + 8px)
    12px
    8px;
}

.project-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.top-icon {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--arc-radius-md);
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.top-icon:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--arc-text-primary);
}

.top-icon.disabled {
  cursor: default;
  opacity: 0.38;
}

.top-icon.disabled:hover {
  background: transparent;
  color: var(--arc-text-secondary);
}

.sidebar-nav {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  padding: 8px 8px;
}

.sidebar-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  border: none;
  border-radius: var(--arc-radius-md);
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.sidebar-item:hover {
  background: rgba(0, 0, 0, 0.04);
  color: var(--arc-text-primary);
}

.sidebar-item.active {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.sidebar-item.active .sidebar-icon {
  color: var(--arc-primary);
}

.sidebar-icon {
  flex-shrink: 0;
  color: var(--arc-text-hint);
}

.sidebar-bottom {
  padding: 8px;
  border-top: 1px solid var(--arc-border);
}

.main-shell {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--arc-bg-surface);
  border-left: 1px solid var(--arc-border);
}

.workspace-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  padding:
    calc(var(--arc-titlebar-height) + 6px)
    max(24px, calc(var(--arc-window-controls-width) + 16px))
    10px
    24px;
}

.breadcrumb {
  display: inline-flex;
  align-items: center;
  color: var(--arc-text-secondary);
  font-size: 13px;
}

.crumb-sep {
  margin: 0 6px;
  transform: rotate(180deg);
  opacity: 0.5;
}

.active-crumb {
  color: var(--arc-text-primary);
  font-weight: 600;
}

.header-tools {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.search-box {
  position: relative;
  display: inline-flex;
  width: clamp(160px, 20vw, 260px);
  min-width: 140px;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-body);
  color: var(--arc-text-hint);
  padding: 7px 12px;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.search-box:focus-within {
  border-color: var(--arc-primary);
  background: var(--arc-bg-surface);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 12%, transparent);
}

.search-box input {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--arc-text-primary);
  font-size: 13px;
  outline: none;
}

.search-box input::placeholder {
  color: var(--arc-text-hint);
}

.profile-badge {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.workspace-body {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  padding: clamp(16px, 2vw, 28px);
}

/* panel-switch: 面板内容切换（概览/世界观/角色等）
   进入：ease-out 160ms，极轻微上浮 4px，强调"内容刷新"
   退出：ease-in 90ms，纯淡出，不产生位移干扰 */
.panel-switch-enter-active {
  transition:
    opacity 0.16s cubic-bezier(0, 0, 0.2, 1),
    transform 0.16s cubic-bezier(0, 0, 0.2, 1);
}

.panel-switch-leave-active {
  transition: opacity 0.09s cubic-bezier(0.4, 0, 1, 1);
}

.panel-switch-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.panel-switch-leave-to {
  opacity: 0;
}

@media (max-width: 1280px) {
  .sidebar {
    width: 60px;
  }

  .sidebar.collapsed {
    width: 60px;
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
    gap: 6px;
    padding-inline: 6px;
  }
}

@media (max-width: 1180px) {
  .workspace-header {
    gap: 12px;
    padding:
      calc(var(--arc-titlebar-height) + 6px)
      max(20px, calc(var(--arc-window-controls-width) + 14px))
      10px
      20px;
  }

  .workspace-body {
    padding: 20px;
  }
}

@media (max-width: 960px) {
  .workspace-header {
    min-height: auto;
    align-items: flex-start;
    flex-direction: column;
    padding:
      calc(var(--arc-titlebar-height) + 10px)
      max(16px, calc(var(--arc-window-controls-width) + 12px))
      14px
      16px;
  }

  .header-tools {
    width: 100%;
    justify-content: space-between;
  }

  .search-box {
    width: min(100%, 400px);
    flex: 1;
  }

  .workspace-body {
    padding: 16px;
  }
}

@media (max-width: 820px) {
  .header-tools {
    flex-wrap: wrap;
    gap: 10px;
  }

  .profile-badge {
    margin-left: auto;
  }

  .workspace-body {
    padding: 14px;
  }
}
</style>
