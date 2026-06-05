<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  BookMarked,
  BookOpenText,
  ChevronLeft,
  FileCheck2,
  FileText,
  Globe2,
  LayoutDashboard,
  Lightbulb,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sparkles,
  Users,
  GitMerge
} from 'lucide-vue-next'
import { NButton, NInput } from 'naive-ui'
import { resolveNovelLengthLabel } from '@/features/wizard/projectGenres'
import { useAppStore } from '@/stores/app'
import NovelWorkflowPanel from '@/components/NovelWorkflowPanel.vue'
import OverviewPanel from '@/components/OverviewPanel.vue'
import GlobalAssistantPanel from '@/components/GlobalAssistantPanel.vue'
import GlobalAssistantPage from '@/components/GlobalAssistantPage.vue'
import ProjectKnowledgePanel from '@/components/ProjectKnowledgePanel.vue'
import WorldviewPanel from '@/components/WorldviewPanel.vue'
import CharactersPanel from '@/components/CharactersPanel.vue'
import RelationsPanel from '@/components/RelationsPanel.vue'
import InspirationPanel from '@/components/InspirationPanel.vue'
import OutlinePanel from '@/components/OutlinePanel.vue'
import PlotThreadsPanel from '@/components/PlotThreadsPanel.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import SearchResultsPanel from '@/components/SearchResultsPanel.vue'
import type { PanelName } from '@/types/app'

const appStore = useAppStore()

// 侧边栏展开/收起状态
const isSidebarOpen = ref(true)
// 当前视口宽度，用于响应式判断侧边栏模式
const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
const isGlobalAssistantOpen = ref(false)
const GLOBAL_ASSISTANT_WIDTH_STORAGE_KEY = 'arc-global-assistant-width'
const GLOBAL_ASSISTANT_DEFAULT_WIDTH = 420
const GLOBAL_ASSISTANT_MIN_WIDTH = 320
const GLOBAL_ASSISTANT_MAX_WIDTH = 760
const globalAssistantWidth = ref(GLOBAL_ASSISTANT_DEFAULT_WIDTH)
const isDraggingGlobalAssistant = ref(false)

// 各面板独立的搜索关键词缓存，切换面板时保留搜索状态
const panelSearch = reactive<Record<string, string>>({
  workflow: '',
  overview: '',
  deconstruction: '',
  'project-knowledge': '',
  world: '',
  characters: '',
  relations: '',
  inspiration: '',
  outline: '',
  threads: '',
  chapters: '',
  settings: ''
})

// 当前面板的搜索关键词（与 panelSearch 双向同步）
const searchKeyword = ref(panelSearch[appStore.activePanel] ?? '')

// 侧边栏导航项配置列表，定义各模块的 id、标签、描述和图标
const sidebarItems = [
  { id: 'overview', label: '作品概览', description: '掌握项目进度与全局信息', icon: LayoutDashboard, color: '#8b5cf6' },
  { id: 'world', label: '世界观设定', description: '沉淀世界规则、地点与设定条目', icon: Globe2, color: '#06b6d4' },
  { id: 'outline', label: '剧情大纲', description: '组织卷宗结构与关键情节点', icon: GitMerge, color: '#10b981' },
  { id: 'threads', label: '剧情线索', description: '追踪未收尾伏笔与活跃剧情线', icon: BookMarked, color: '#6366f1' },
  { id: 'characters', label: '角色图鉴', description: '维护人物卡、关系与成长线索', icon: Users, color: '#ec4899' },
  { id: 'relations', label: '关系组织', description: '维护势力结构、人物关系与成员归属', icon: Network, color: '#6b7280' },
  { id: 'inspiration', label: '灵感模块', description: '收集标题、桥段、转折与人物动机', icon: Lightbulb, color: '#f59e0b' },
  { id: 'workflow', label: '小说流程', description: '维护固定流程文件并驱动写作阶段', icon: BookOpenText, color: '#3b82f6' },
  { id: 'chapters', label: '章节创作', description: '进入正文草稿与章节推进流程', icon: FileText, color: '#3b82f6' },
  { id: 'project-knowledge', label: '项目知识库', description: '一致性审计与从已有章节补录状态', icon: FileCheck2, color: '#14b8a6' },
  { id: 'global-assistant', label: '全局AI助手', description: '审计、录入与跨设定修正的全局助理', icon: Sparkles, color: '#0066cc' }
] as const

const hiddenPanelLabels: Partial<Record<PanelName, string>> = {
  deconstruction: '拆书知识库'
}

// 去除首尾空格后的搜索关键词
const normalizedSearch = computed(() => searchKeyword.value.trim())
// 是否处于搜索模式（关键词非空时显示搜索结果面板）
const isSearchMode = computed(() => normalizedSearch.value.length > 0)

// 全局AI助手为整页助手，自带搜索/会话能力，隐藏工作台 header 的搜索与 AI助手 入口
const isGlobalAssistantPanel = computed(() => appStore.activePanel === 'global-assistant')

// 顶部面包屑中显示的当前视图标签
const activeViewLabel = computed(() => {
  if (isSearchMode.value) {
    return '项目搜索'
  }

  if (appStore.activePanel === 'settings') {
    return '项目设置'
  }

  return sidebarItems.find((item) => item.id === appStore.activePanel)?.label
    ?? hiddenPanelLabels[appStore.activePanel]
    ?? '项目工作台'
})

// 项目元信息（题材 + 长短篇 + 字数展示），用于侧边栏项目标题下方显示
const projectMeta = computed(() =>
  [
    appStore.currentProject?.genre?.trim(),
    resolveNovelLengthLabel(appStore.currentProject?.novelLength),
    appStore.currentProject?.wordCount?.trim()
  ]
    .filter(Boolean)
    .join(' · ')
)

// 侧边栏各导航项的角标数字，展示各模块的数据条数
const sidebarBadgeMap = computed<Record<string, string | null>>(() => ({
  workflow: null,
  overview: null,
  world: String(appStore.worldviewEntries.length),
  characters: String(appStore.characters.length),
  relations: String(appStore.organizations.length + appStore.characterRelationships.length),
  inspiration: String(appStore.inspirationEntries.length),
  outline: String(appStore.outlineItems.length),
  chapters: String(appStore.chapters.length),
  settings: null
}))

// 侧边栏底部的汇总统计文本
const sidebarSummary = computed(
  () =>
    `设定 ${appStore.worldviewEntries.length} · 角色 ${appStore.characters.length} · 关系 ${appStore.characterRelationships.length} · 组织 ${appStore.organizations.length} · 章节 ${appStore.chapters.length}`
)

// 窄屏模式下使用紧凑侧边栏（仅显示图标）
const isCompactSidebar = computed(() => viewportWidth.value <= 1280)
// 是否渲染侧边栏中的文字标签（非紧凑模式且侧边栏展开时显示）
const shouldRenderSidebarLabels = computed(() => isSidebarOpen.value && !isCompactSidebar.value)
const shouldOverlayAssistant = computed(() => viewportWidth.value <= 1320)
const maxGlobalAssistantWidth = computed(() => {
  const reservedWidth = shouldOverlayAssistant.value
    ? 28
    : (isCompactSidebar.value ? 180 : 320)
  const viewportLimit = viewportWidth.value - reservedWidth
  return Math.max(GLOBAL_ASSISTANT_MIN_WIDTH, Math.min(GLOBAL_ASSISTANT_MAX_WIDTH, viewportLimit))
})
const effectiveGlobalAssistantWidth = computed(() =>
  Math.max(GLOBAL_ASSISTANT_MIN_WIDTH, Math.min(maxGlobalAssistantWidth.value, globalAssistantWidth.value))
)
const globalAssistantDockStyle = computed(() => ({
  width: `${effectiveGlobalAssistantWidth.value}px`,
  maxWidth: shouldOverlayAssistant.value ? 'calc(100vw - 20px)' : '100%'
}))

function clampGlobalAssistantWidth(width: number): number {
  return Math.max(GLOBAL_ASSISTANT_MIN_WIDTH, Math.min(maxGlobalAssistantWidth.value, width))
}

/** 切换侧边栏展开/收起，紧凑模式下不允许切换 */
function toggleSidebar(): void {
  if (isCompactSidebar.value) {
    return
  }

  isSidebarOpen.value = !isSidebarOpen.value
}

function toggleGlobalAssistant(): void {
  isGlobalAssistantOpen.value = !isGlobalAssistantOpen.value
}

function closeGlobalAssistant(): void {
  isGlobalAssistantOpen.value = false
}

/**
 * 清除指定面板的搜索缓存
 * @param panel - 面板名称
 */
function startGlobalAssistantResize(event: MouseEvent): void {
  event.preventDefault()
  isDraggingGlobalAssistant.value = true
  const startX = event.clientX
  const startWidth = effectiveGlobalAssistantWidth.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'

  function onMove(moveEvent: MouseEvent): void {
    const delta = startX - moveEvent.clientX
    globalAssistantWidth.value = clampGlobalAssistantWidth(startWidth + delta)
  }

  function onEnd(): void {
    isDraggingGlobalAssistant.value = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    localStorage.setItem(GLOBAL_ASSISTANT_WIDTH_STORAGE_KEY, String(globalAssistantWidth.value))
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onEnd)
}

function resetGlobalAssistantWidth(): void {
  globalAssistantWidth.value = clampGlobalAssistantWidth(GLOBAL_ASSISTANT_DEFAULT_WIDTH)
  localStorage.setItem(GLOBAL_ASSISTANT_WIDTH_STORAGE_KEY, String(globalAssistantWidth.value))
}

function clearSearchForPanel(panel: PanelName): void {
  panelSearch[panel] = ''
}

/**
 * 处理全局搜索结果的点击跳转
 * @param payload.panel - 目标面板名称
 * @param payload.chapterId - 可选，若为章节搜索则直接定位到具体章节
 */
function openSearchResult(payload: { panel: PanelName; chapterId?: string }): void {
  clearSearchForPanel(appStore.activePanel)
  clearSearchForPanel(payload.panel)
  searchKeyword.value = ''

  // 如果搜索结果指向某个章节，直接选中该章节
  if (payload.chapterId) {
    appStore.selectChapter(payload.chapterId)
    return
  }

  // 否则切换到对应面板
  appStore.setPanel(payload.panel)
}

/** 同步视口宽度，窄屏下自动收起侧边栏 */
function syncViewportState(): void {
  viewportWidth.value = window.innerWidth

  // 宽度 <= 1280px 时强制使用图标侧边栏，为正文内容留出更多空间
  if (viewportWidth.value <= 1280) {
    isSidebarOpen.value = false
    return
  }

  isSidebarOpen.value = true
}

onMounted(() => {
  syncViewportState()
  const savedWidth = Number(localStorage.getItem(GLOBAL_ASSISTANT_WIDTH_STORAGE_KEY))
  if (Number.isFinite(savedWidth) && savedWidth >= GLOBAL_ASSISTANT_MIN_WIDTH && savedWidth <= GLOBAL_ASSISTANT_MAX_WIDTH) {
    globalAssistantWidth.value = savedWidth
  }
  window.addEventListener('resize', syncViewportState)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewportState)
})

// 监听面板切换，将搜索关键词恢复为该面板上次的搜索内容
watch(
  () => appStore.activePanel,
  (panel) => {
    searchKeyword.value = panelSearch[panel] ?? ''
  },
  { immediate: true }
)

// 监听搜索关键词变化，为当前面板缓存最新搜索词，避免切换面板时丢失搜索状态
watch(searchKeyword, (value) => {
  panelSearch[appStore.activePanel] = value
})
</script>

<template>
  <section class="workspace">
    <aside class="sidebar" :class="{ collapsed: !isSidebarOpen || isCompactSidebar }">
      <div class="sidebar-top">
        <button type="button" class="top-icon" title="返回项目中心" @click="appStore.backToProjects()">
          <ChevronLeft :size="18" />
        </button>
        <div v-if="shouldRenderSidebarLabels" class="sidebar-brand">
          <span class="project-kicker">当前项目</span>
          <span class="project-title">{{ appStore.currentProject?.title ?? '未命名作品' }}</span>
          <span v-if="projectMeta" class="project-meta">{{ projectMeta }}</span>
        </div>
        <button
          type="button"
          class="top-icon"
          :title="isSidebarOpen && !isCompactSidebar ? '收起导航' : '展开导航'"
          :disabled="isCompactSidebar"
          :class="{ disabled: isCompactSidebar }"
          @click="toggleSidebar"
        >
          <PanelLeftClose v-if="isSidebarOpen && !isCompactSidebar" :size="18" />
          <PanelLeftOpen v-else :size="18" />
        </button>
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
            <span class="sidebar-icon-shell" :style="{ color: appStore.activePanel === item.id ? undefined : item.color }">
              <component :is="item.icon" :size="18" class="sidebar-icon" />
            </span>
            <span v-if="shouldRenderSidebarLabels" class="sidebar-copy">
              <span class="sidebar-label">{{ item.label }}</span>
              <span class="sidebar-hint">{{ item.description }}</span>
            </span>
<!--            <span v-if="shouldRenderSidebarLabels && sidebarBadgeMap[item.id]" class="sidebar-badge">
              {{ sidebarBadgeMap[item.id] }}
            </span>-->
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
            <span class="sidebar-hint">自动保存、导入导出与创作偏好</span>
          </span>
        </button>
      </div>
    </aside>

    <main class="main-shell">
      <header class="workspace-header">
        <div class="breadcrumb">
          <span>项目工作台</span>
          <ChevronLeft :size="14" class="crumb-sep" />
          <span class="active-crumb">{{ activeViewLabel }}</span>
        </div>

        <div v-if="!isGlobalAssistantPanel" class="header-tools">
          <n-input
            v-model:value="searchKeyword"
            class="search-input"
            placeholder="搜索设定、角色、知识或章节..."
            clearable
            size="small"
          >
            <template #prefix>
              <Search :size="14" />
            </template>
          </n-input>
          <n-button
            size="small"
            round
            :type="isGlobalAssistantOpen ? 'primary' : 'default'"
            class="assistant-toggle"
            @click="toggleGlobalAssistant"
          >
            AI助手
          </n-button>
        </div>
      </header>

      <div class="workspace-body" :class="{ 'workspace-body--flush': isGlobalAssistantPanel }">
        <div class="workspace-body-shell">
          <div class="workspace-body-main arc-scrollbar" :class="{ 'workspace-body-main--flush': isGlobalAssistantPanel }">
            <Transition name="panel-switch" mode="out-in">
              <!-- 搜索模式下显示全局搜索结果面板 -->
              <SearchResultsPanel
                v-if="isSearchMode"
                key="search-results"
                :query="normalizedSearch"
                @open-result="openSearchResult"
              />
              <!-- 非搜索模式下根据当前激活的面板渲染对应组件 -->
              <NovelWorkflowPanel v-else-if="appStore.activePanel === 'workflow'" key="workflow" />
              <OverviewPanel v-else-if="appStore.activePanel === 'overview'" key="overview" :search-query="normalizedSearch" />
              <ProjectKnowledgePanel v-else-if="appStore.activePanel === 'project-knowledge'" key="project-knowledge" />
              <WorldviewPanel v-else-if="appStore.activePanel === 'world'" key="world" :search-query="normalizedSearch" />
              <CharactersPanel v-else-if="appStore.activePanel === 'characters'" key="characters" :search-query="normalizedSearch" />
              <RelationsPanel v-else-if="appStore.activePanel === 'relations'" key="relations" :search-query="normalizedSearch" />
              <InspirationPanel v-else-if="appStore.activePanel === 'inspiration'" key="inspiration" :search-query="normalizedSearch" />
              <OutlinePanel v-else-if="appStore.activePanel === 'outline'" key="outline" :search-query="normalizedSearch" />
              <PlotThreadsPanel v-else-if="appStore.activePanel === 'threads'" key="threads" :search-query="normalizedSearch" />
              <GlobalAssistantPage v-else-if="appStore.activePanel === 'global-assistant'" key="global-assistant" />
              <SettingsPanel v-else key="settings" />
            </Transition>
          </div>

          <Transition name="assistant-backdrop">
            <button
              v-if="isGlobalAssistantOpen && shouldOverlayAssistant"
              type="button"
              class="assistant-backdrop"
              aria-label="关闭全局助手"
              @click="closeGlobalAssistant"
            />
          </Transition>

          <Transition name="assistant-dock">
            <div
              v-if="isGlobalAssistantOpen"
              class="workspace-assistant-shell"
              :class="{ overlay: shouldOverlayAssistant }"
              :style="globalAssistantDockStyle"
            >
              <div
                class="assistant-resize-handle"
                :class="{ dragging: isDraggingGlobalAssistant }"
                title="拖拽调整宽度，双击恢复默认"
                @mousedown="startGlobalAssistantResize"
                @dblclick="resetGlobalAssistantWidth"
              />
              <GlobalAssistantPanel
                class="workspace-assistant-dock"
                :active-view-label="activeViewLabel"
                @close="closeGlobalAssistant"
              />
            </div>
          </Transition>
        </div>
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

/* ── Sidebar ── */
.sidebar {
  display: flex;
  width: 220px;
  flex-shrink: 0;
  flex-direction: column;
  border-right: 1px solid var(--arc-sidebar-border);
  background: var(--arc-bg-sidebar);
  transition: width 0.22s ease;
}

.sidebar.collapsed {
  width: 64px;
}

.sidebar.collapsed .sidebar-top {
  flex-direction: column;
  justify-content: flex-start;
  gap: 8px;
  padding:
    calc(var(--arc-titlebar-height) + 10px)
    10px
    10px;
}

.sidebar-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding:
    calc(var(--arc-titlebar-height) + 12px)
    12px
    10px;
  border-bottom: 1px solid var(--arc-sidebar-border);
}

.sidebar-brand {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}

.project-kicker {
  color: var(--arc-text-hint);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.project-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 700;
  color: var(--arc-text-primary);
  letter-spacing: -0.01em;
}

.project-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--arc-text-hint);
  font-size: 11px;
}

.top-icon {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--arc-radius-md);
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  transition:
    background 0.14s ease,
    border-color 0.14s ease,
    color 0.14s ease;
}

.top-icon:hover {
  border-color: var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
}

.top-icon:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 12%, transparent);
}

.top-icon.disabled {
  cursor: default;
  opacity: 0.38;
  pointer-events: none;
}

.sidebar-group-label {
  color: var(--arc-text-hint);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0 4px;
}

.sidebar-group {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 8px 4px;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-item {
  position: relative;
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  min-height: 36px;
  border: 1px solid transparent;
  border-radius: var(--arc-radius-md);
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  padding: 6px 8px 6px 10px;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  transition:
    background 0.14s ease,
    border-color 0.14s ease,
    color 0.14s ease;
}

.sidebar-item::before {
  content: '';
  position: absolute;
  top: 7px;
  bottom: 7px;
  left: -1px;
  width: 2px;
  border-radius: 0 2px 2px 0;
  background: transparent;
  transition:
    opacity 0.14s ease,
    background 0.14s ease;
}

.sidebar-item:hover {
  background: var(--arc-bg-surface);
  border-color: var(--arc-border);
  color: var(--arc-text-primary);
}

.sidebar-item:active {
  opacity: 0.85;
}

.sidebar-item:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--arc-primary) 12%, transparent);
}

.sidebar-item.active {
  border-color: var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  box-shadow: var(--arc-shadow-sm);
  font-weight: 600;
}

.sidebar-item.active::before {
  background: var(--arc-primary);
}

.sidebar-icon-shell {
  display: inline-flex;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: var(--arc-radius-md);
  transition: color 0.14s ease;
}

.sidebar-item:hover .sidebar-icon-shell {
  opacity: 0.85;
}

.sidebar-item.active .sidebar-icon-shell {
  color: var(--arc-primary) !important;
}

.sidebar-icon {
  display: block;
}

.sidebar-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.sidebar-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
  font-size: 13px;
  font-weight: inherit;
}

.sidebar-hint {
  display: none;
}

.sidebar-badge {
  display: inline-flex;
  min-width: 20px;
  align-items: center;
  justify-content: center;
  align-self: center;
  border-radius: 4px;
  background: var(--arc-bg-body);
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  padding: 2px 5px;
}

.sidebar-item.active .sidebar-badge {
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.sidebar-bottom {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
  padding: 8px 8px 10px;
  border-top: 1px solid var(--arc-sidebar-border);
}

/* ── Main Shell ── */
.main-shell {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--arc-bg-surface);
}

.workspace-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  padding:
    calc(var(--arc-titlebar-height) + 6px)
    max(20px, calc(var(--arc-window-controls-width) + 14px))
    8px
    20px;
}

.breadcrumb {
  display: inline-flex;
  align-items: center;
  color: var(--arc-text-hint);
  font-size: 13px;
}

.crumb-sep {
  margin: 0 5px;
  transform: rotate(180deg);
  opacity: 0.4;
}

.active-crumb {
  color: var(--arc-text-primary);
  font-weight: 600;
}

.header-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.assistant-toggle {
  flex-shrink: 0;
}

.search-input {
  width: clamp(160px, 18vw, 260px);
}

@media (max-width: 960px) {
  .search-input {
    width: min(100%, 360px);
    flex: 1;
  }
}

.workspace-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 24px;
}

.workspace-body--flush {
  padding: 0;
}

.workspace-body-shell {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  gap: 18px;
}

.workspace-body-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}

.workspace-body-main--flush {
  display: flex;
  overflow: hidden;
}

.assistant-backdrop {
  position: absolute;
  inset: 0;
  z-index: 11;
  border: none;
  background: rgba(15, 23, 42, 0.16);
  cursor: pointer;
}

.workspace-assistant-shell {
  position: relative;
  display: flex;
  flex-shrink: 0;
  min-height: 0;
  border: 1px solid var(--arc-border);
  border-radius: 18px;
  overflow: visible;
  box-shadow: var(--arc-shadow-md);
}

.workspace-assistant-shell.overlay {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 12;
  border-radius: 20px 0 0 20px;
  border-right: none;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.2);
}

.workspace-assistant-dock {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: inherit;
}

.assistant-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -5px;
  z-index: 2;
  width: 10px;
  cursor: col-resize;
}

.assistant-resize-handle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 0;
  border-radius: 1px;
  background: var(--arc-border-strong);
  opacity: 0;
  transform: translate(-50%, -50%);
  transition:
    height 0.18s ease,
    opacity 0.18s ease,
    background 0.18s ease;
}

.assistant-resize-handle:hover::after {
  height: 42px;
  opacity: 0.7;
}

.assistant-resize-handle.dragging::after {
  height: 100%;
  opacity: 1;
  background: var(--arc-primary);
}

/* panel-switch transition */
.panel-switch-enter-active {
  transition:
    opacity 0.14s cubic-bezier(0, 0, 0.2, 1),
    transform 0.14s cubic-bezier(0, 0, 0.2, 1);
}

.panel-switch-leave-active {
  transition: opacity 0.08s cubic-bezier(0.4, 0, 1, 1);
}

.panel-switch-enter-from {
  opacity: 0;
  transform: translateY(3px);
}

.panel-switch-leave-to {
  opacity: 0;
}

.assistant-dock-enter-active,
.assistant-dock-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.assistant-dock-enter-from,
.assistant-dock-leave-to {
  opacity: 0;
  transform: translateX(18px);
}

.assistant-backdrop-enter-active,
.assistant-backdrop-leave-active {
  transition: opacity 0.18s ease;
}

.assistant-backdrop-enter-from,
.assistant-backdrop-leave-to {
  opacity: 0;
}

/* ── Compact sidebar (≤1280px) ── */
@media (max-width: 1280px) {
  .sidebar {
    width: 64px;
  }

  .sidebar.collapsed {
    width: 64px;
  }

  .sidebar-group-label,
  .sidebar-brand,
  .sidebar-copy,
  .sidebar-badge {
    display: none;
  }

  .sidebar-top {
    justify-content: center;
    gap: 6px;
    padding-inline: 8px;
    border-bottom: 1px solid var(--arc-sidebar-border);
  }

  .sidebar.collapsed .sidebar-top {
    flex-direction: column;
    justify-content: flex-start;
  }

  .sidebar-item {
    justify-content: center;
    padding-inline: 8px;
    min-height: 40px;
  }

  .sidebar-item::before {
    top: auto;
    bottom: 5px;
    left: 50%;
    width: 16px;
    height: 2px;
    border-radius: 1px;
    transform: translateX(-50%);
  }

  .sidebar-group {
    padding-inline: 6px;
  }

  .sidebar-bottom {
    padding-inline: 6px;
  }
}

@media (max-width: 1180px) {
  .workspace-header {
    gap: 10px;
    padding:
      calc(var(--arc-titlebar-height) + 6px)
      max(16px, calc(var(--arc-window-controls-width) + 12px))
      8px
      16px;
  }

  .workspace-body {
    padding: 20px;
  }

  .workspace-body-shell {
    gap: 14px;
  }
}

@media (max-width: 960px) {
  .workspace-header {
    min-height: auto;
    align-items: flex-start;
    flex-direction: column;
    padding:
      calc(var(--arc-titlebar-height) + 8px)
      max(14px, calc(var(--arc-window-controls-width) + 10px))
      12px
      14px;
  }

  .header-tools {
    width: 100%;
    justify-content: space-between;
  }

  .workspace-body {
    padding: 16px;
  }

  .workspace-body-shell {
    gap: 0;
  }
}

@media (max-width: 820px) {
  .header-tools {
    flex-wrap: wrap;
    gap: 8px;
  }

  .workspace-body {
    padding: 14px;
  }

  .workspace-assistant-shell.overlay {
    width: min(100%, calc(100vw - 20px));
  }
}
</style>
