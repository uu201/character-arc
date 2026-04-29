<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ChevronLeft,
  FileText,
  Globe2,
  LayoutDashboard,
  Lightbulb,
  Network,
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
import RelationsPanel from '@/components/RelationsPanel.vue'
import InspirationPanel from '@/components/InspirationPanel.vue'
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
  relations: '',
  inspiration: '',
  outline: '',
  chapters: '',
  settings: ''
})
const searchKeyword = ref(panelSearch[appStore.activePanel] ?? '')

const sidebarItems = [
  { id: 'overview', label: '作品概览', description: '掌握项目进度与全局信息', icon: LayoutDashboard },
  { id: 'world', label: '世界观设定', description: '沉淀世界规则、地点与设定条目', icon: Globe2 },
  { id: 'characters', label: '角色图鉴', description: '维护人物卡、关系与成长线索', icon: Users },
  { id: 'relations', label: '关系组织', description: '维护势力结构、人物关系与成员归属', icon: Network },
  { id: 'inspiration', label: '灵感模块', description: '收集标题、桥段、转折与人物动机', icon: Lightbulb },
  { id: 'outline', label: '剧情大纲', description: '组织卷宗结构与关键情节点', icon: GitMerge },
  { id: 'chapters', label: '章节创作', description: '进入正文草稿与章节推进流程', icon: FileText }
] as const

const activePanelLabel = computed(
  () => sidebarItems.find((item) => item.id === appStore.activePanel)?.label ?? '项目工作台'
)
const activePanelDescription = computed(() => {
  if (appStore.activePanel === 'settings') {
    return '调整主题、自动保存与创作偏好'
  }

  return sidebarItems.find((item) => item.id === appStore.activePanel)?.description ?? '管理项目内容'
})
const normalizedSearch = computed(() => searchKeyword.value.trim())
const isSearchMode = computed(() => normalizedSearch.value.length > 0)
const activeViewLabel = computed(() => (isSearchMode.value ? '项目搜索' : activePanelLabel.value))
const projectMeta = computed(() =>
  [appStore.currentProject?.genre?.trim(), appStore.currentProject?.wordCount?.trim()].filter(Boolean).join(' · ')
)
const sidebarBadgeMap = computed<Record<string, string | null>>(() => ({
  overview: null,
  world: String(appStore.worldviewEntries.length),
  characters: String(appStore.characters.length),
  relations: String(appStore.organizations.length + appStore.characterRelationships.length),
  inspiration: String(appStore.inspirationEntries.length),
  outline: String(appStore.outlineItems.length),
  chapters: String(appStore.chapters.length),
  settings: null
}))
const sidebarSummary = computed(
  () =>
    `设定 ${appStore.worldviewEntries.length} · 角色 ${appStore.characters.length} · 关系 ${appStore.characterRelationships.length} · 组织 ${appStore.organizations.length} · 章节 ${appStore.chapters.length}`
)

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
        <button type="button" class="top-icon arc-no-drag" title="返回项目中心" @click="appStore.backToProjects()">
          <ChevronLeft :size="18" />
        </button>
        <div v-if="shouldRenderSidebarLabels" class="sidebar-brand">
          <span class="project-kicker">当前项目</span>
          <span class="project-title">{{ appStore.currentProject?.title ?? '未命名作品' }}</span>
          <span v-if="projectMeta" class="project-meta">{{ projectMeta }}</span>
        </div>
        <button
          type="button"
          class="top-icon arc-no-drag"
          :title="isSidebarOpen && !isCompactSidebar ? '收起导航' : '展开导航'"
          :disabled="isCompactSidebar"
          :class="{ disabled: isCompactSidebar }"
          @click="toggleSidebar"
        >
          <PanelLeftClose v-if="isSidebarOpen && !isCompactSidebar" :size="18" />
          <PanelLeftOpen v-else :size="18" />
        </button>
      </div>

      <div v-if="shouldRenderSidebarLabels" class="sidebar-spotlight">
        <span class="sidebar-spotlight-label">当前焦点</span>
        <strong>{{ activePanelLabel }}</strong>
        <p>{{ activePanelDescription }}</p>
        <span class="sidebar-spotlight-meta">{{ sidebarSummary }}</span>
      </div>

      <div class="sidebar-group">
        <div v-if="shouldRenderSidebarLabels" class="sidebar-group-label">创作模块</div>
        <nav class="sidebar-nav" aria-label="工作台导航">
          <button
            v-for="item in sidebarItems"
            :key="item.id"
            type="button"
            class="sidebar-item"
            :class="{ active: appStore.activePanel === item.id }"
            :title="item.label"
            @click="appStore.setPanel(item.id)"
          >
            <span class="sidebar-icon-shell">
              <component :is="item.icon" :size="18" class="sidebar-icon" />
            </span>
            <span v-if="shouldRenderSidebarLabels" class="sidebar-copy">
              <span class="sidebar-label">{{ item.label }}</span>
              <span class="sidebar-hint">{{ item.description }}</span>
            </span>
            <span v-if="shouldRenderSidebarLabels && sidebarBadgeMap[item.id]" class="sidebar-badge">
              {{ sidebarBadgeMap[item.id] }}
            </span>
          </button>
        </nav>
      </div>

      <div class="sidebar-bottom">
        <div v-if="shouldRenderSidebarLabels" class="sidebar-group-label">偏好</div>
        <button
          type="button"
          class="sidebar-item"
          :class="{ active: appStore.activePanel === 'settings' }"
          title="项目设置"
          @click="appStore.setPanel('settings')"
        >
          <span class="sidebar-icon-shell">
            <Settings :size="18" class="sidebar-icon" />
          </span>
          <span v-if="shouldRenderSidebarLabels" class="sidebar-copy">
            <span class="sidebar-label">项目设置</span>
            <span class="sidebar-hint">主题、自动保存与创作偏好</span>
          </span>
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
            <input v-model="searchKeyword" type="text" placeholder="搜索设定、角色、关系、组织、灵感或章节内容..." />
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
          <RelationsPanel v-else-if="appStore.activePanel === 'relations'" key="relations" :search-query="normalizedSearch" />
          <InspirationPanel v-else-if="appStore.activePanel === 'inspiration'" key="inspiration" :search-query="normalizedSearch" />
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
  width: 276px;
  flex-shrink: 0;
  flex-direction: column;
  border-right: 1px solid var(--arc-border);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--arc-bg-surface) 76%, white), var(--arc-bg-body));
  transition:
    width 0.24s ease,
    background 0.24s ease;
}

.sidebar.collapsed {
  width: 72px;
}

.sidebar.collapsed .sidebar-top {
  flex-direction: column;
  justify-content: flex-start;
  gap: 8px;
  padding:
    calc(var(--arc-titlebar-height) + 12px)
    10px
    12px;
}

.sidebar-top {
  display: flex;
  align-items: center;
  gap: 10px;
  padding:
    calc(var(--arc-titlebar-height) + 14px)
    14px
    14px;
}

.sidebar-brand {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.project-kicker {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.project-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 700;
  color: var(--arc-text-primary);
}

.project-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.top-icon {
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--arc-radius-md);
  background: rgba(255, 255, 255, 0.52);
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease;
}

.top-icon:hover {
  border-color: color-mix(in srgb, var(--arc-border) 72%, white);
  background: rgba(255, 255, 255, 0.86);
  color: var(--arc-text-primary);
}

.top-icon:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--arc-primary) 32%, white);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 14%, transparent);
}

.top-icon.disabled {
  cursor: default;
  opacity: 0.38;
}

.top-icon.disabled:hover {
  border-color: transparent;
  background: rgba(255, 255, 255, 0.52);
  color: var(--arc-text-secondary);
}

.sidebar-spotlight {
  margin: 0 14px 14px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 10%, var(--arc-border));
  border-radius: calc(var(--arc-radius-lg) + 4px);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.96), color-mix(in srgb, var(--arc-primary-soft) 60%, white));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.68),
    0 10px 24px rgba(15, 23, 42, 0.05);
}

.sidebar-spotlight-label,
.sidebar-group-label {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sidebar-spotlight strong {
  display: block;
  margin-top: 8px;
  color: var(--arc-text-primary);
  font-size: 15px;
  font-weight: 700;
}

.sidebar-spotlight p {
  margin: 6px 0 10px;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.55;
}

.sidebar-spotlight-meta {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 700;
  padding: 6px 10px;
}

.sidebar-group {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 0 10px;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sidebar-item {
  position: relative;
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  border: 1px solid transparent;
  border-radius: calc(var(--arc-radius-md) + 2px);
  background: rgba(255, 255, 255, 0.28);
  color: var(--arc-text-secondary);
  cursor: pointer;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.sidebar-item::before {
  content: '';
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 8px;
  width: 3px;
  border-radius: 999px;
  background: transparent;
  opacity: 0;
  transition:
    opacity 0.16s ease,
    background 0.16s ease;
}

.sidebar-item:hover {
  border-color: color-mix(in srgb, var(--arc-border) 75%, white);
  background: rgba(255, 255, 255, 0.86);
  color: var(--arc-text-primary);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
}

.sidebar-item:active {
  transform: translateY(1px);
}

.sidebar-item:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--arc-primary) 32%, white);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 14%, transparent);
}

.sidebar-item.active {
  border-color: color-mix(in srgb, var(--arc-primary) 14%, var(--arc-border));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--arc-primary-soft) 82%, white), rgba(255, 255, 255, 0.98));
  color: var(--arc-text-primary);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.78),
    0 12px 24px color-mix(in srgb, var(--arc-primary) 10%, transparent);
}

.sidebar-item.active::before {
  background: var(--arc-primary);
  opacity: 1;
}

.sidebar-icon-shell {
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.78);
  color: var(--arc-text-secondary);
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.sidebar-item:hover .sidebar-icon-shell {
  background: rgba(255, 255, 255, 0.96);
  color: var(--arc-text-primary);
}

.sidebar-item.active .sidebar-icon-shell {
  background: color-mix(in srgb, var(--arc-primary) 14%, white);
  color: var(--arc-primary);
}

.sidebar-icon {
  display: block;
}

.sidebar-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.sidebar-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
  font-size: 13px;
  font-weight: 700;
}

.sidebar-hint {
  overflow: hidden;
  color: var(--arc-text-hint);
  font-size: 11px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-badge {
  display: inline-flex;
  min-width: 28px;
  align-items: center;
  justify-content: center;
  align-self: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--arc-text-secondary);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  padding: 6px 8px;
}

.sidebar-item.active .sidebar-badge {
  background: rgba(255, 255, 255, 0.92);
  color: var(--arc-primary);
}

.sidebar-bottom {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  padding: 12px 10px 10px;
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
    width: 72px;
  }

  .sidebar.collapsed {
    width: 72px;
  }

  .sidebar-spotlight,
  .sidebar-group-label,
  .sidebar-brand,
  .sidebar-copy,
  .sidebar-badge {
    display: none;
  }

  .sidebar-item {
    justify-content: center;
    padding-inline: 10px;
  }

  .sidebar-item::before {
    top: auto;
    bottom: 7px;
    left: 50%;
    width: 18px;
    height: 3px;
    transform: translateX(-50%);
  }

  .sidebar-top {
    justify-content: center;
    gap: 6px;
    padding-inline: 10px;
  }

  .sidebar.collapsed .sidebar-top {
    flex-direction: column;
    justify-content: flex-start;
    gap: 8px;
  }

  .sidebar-group,
  .sidebar-bottom {
    padding-inline: 8px;
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
