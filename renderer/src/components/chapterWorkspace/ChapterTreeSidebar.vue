<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ChevronDown, ChevronsDownUp, FilePlus, FileText, FolderPlus, MoreVertical, Plus, Search, Settings } from 'lucide-vue-next'
import { NDropdown, NTag, NTooltip, useDialog } from 'naive-ui'
import ChapterMetaDialog from './ChapterMetaDialog.vue'
import { useAppStore } from '@/stores/app'
import { formatVolumeLabel } from '@/features/workspace/outlineVolumes'
import { getChapterCharacterCount } from '@/features/chapters/editorContent'
import type { ChapterDraft } from '@/types/app'
import type { DropdownOption } from 'naive-ui'

const emit = defineEmits<{
  navigate: []
}>()

const appStore = useAppStore()
const dialog = useDialog()

const keyword = ref('')
const collapsed = reactive<Record<string, boolean>>({})

const metaDialogVisible = ref(false)
const metaDialogChapter = ref<ChapterDraft | null>(null)

const chapterMenuOptions: DropdownOption[] = [
  { key: 'edit', label: '编辑章节信息' },
  { key: 'delete', label: '删除章节' }
]

const filteredGroups = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return appStore.chapterVolumeGroups
  return appStore.chapterVolumeGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((c) =>
        `${c.title} ${c.summary} ${c.status}`.toLowerCase().includes(query)
      )
    }))
    .filter((group) => group.items.length > 0)
})

const totalVisible = computed(() =>
  filteredGroups.value.reduce((n, g) => n + g.items.length, 0)
)

const totalWords = computed(() =>
  appStore.chapters.reduce((n, c) => n + getChapterCharacterCount(c.content), 0)
)

const allCollapsed = computed(() =>
  appStore.outlineVolumes.length > 0 && appStore.outlineVolumes.every((v) => collapsed[v.id])
)

function toggleVolume(id: string): void {
  collapsed[id] = !collapsed[id]
}

function toggleCollapseAll(): void {
  const next = !allCollapsed.value
  for (const v of appStore.outlineVolumes) collapsed[v.id] = next
}

function formatStatus(status: ChapterDraft['status']): string {
  switch (status) {
    case 'final': return '已定稿'
    case 'polish': return '待润色'
    case 'review': return '待检查'
    default: return '草稿'
  }
}

function statusType(status: ChapterDraft['status']): 'default' | 'info' | 'success' | 'warning' {
  switch (status) {
    case 'final': return 'success'
    case 'polish': return 'info'
    case 'review': return 'warning'
    default: return 'default'
  }
}

function handleMenuSelect(key: string | number, chapter: ChapterDraft): void {
  if (key === 'edit') {
    metaDialogChapter.value = chapter
    metaDialogVisible.value = true
    return
  }
  if (key === 'delete') {
    if (appStore.chapters.length <= 1) return
    dialog.warning({
      title: '确认删除章节',
      content: `确定要删除"${chapter.title}"吗？删除后当前章节草稿将无法恢复。`,
      positiveText: '确认删除',
      negativeText: '取消',
      autoFocus: false,
      closable: false,
      onPositiveClick: () => appStore.deleteChapter(chapter.id)
    })
  }
}
</script>

<template>
  <aside class="tree-sidebar">
    <header class="ts-header">
      <div class="project-name">
        <span class="dot" />
        {{ appStore.currentProject?.title || '未命名项目' }}
      </div>
      <n-tooltip trigger="hover" placement="bottom">
        <template #trigger>
          <button class="icon-btn" @click="appStore.backToWorkbench()">
            <Settings :size="14" />
          </button>
        </template>
        返回工作台
      </n-tooltip>
    </header>

    <div class="ts-toolbar">
      <n-tooltip trigger="hover" placement="bottom">
        <template #trigger>
          <button class="icon-btn flex" @click="appStore.createOutlineVolume()"><FolderPlus :size="14" /></button>
        </template>
        新建分卷
      </n-tooltip>
      <n-tooltip trigger="hover" placement="bottom">
        <template #trigger>
          <button class="icon-btn flex" @click="appStore.createChapter()"><FilePlus :size="14" /></button>
        </template>
        新建章节
      </n-tooltip>
      <n-tooltip trigger="hover" placement="bottom">
        <template #trigger>
          <button class="icon-btn flex" @click="toggleCollapseAll">
            <ChevronsDownUp :size="14" />
          </button>
        </template>
        {{ allCollapsed ? '展开全部' : '折叠全部' }}
      </n-tooltip>
    </div>

    <div class="ts-search">
      <Search :size="12" />
      <input v-model="keyword" placeholder="搜索章节..." />
    </div>

    <div class="ts-scroll arc-scrollbar">
      <section
        v-for="group in filteredGroups"
        :key="group.volume.id"
        class="volume"
        :class="{ collapsed: collapsed[group.volume.id] }"
      >
        <button class="volume-head" @click="toggleVolume(group.volume.id)">
          <ChevronDown :size="13" class="chevron" />
          <span class="volume-title">{{ formatVolumeLabel(group.volume, group.index, 'compact') }}</span>
          <span class="volume-meta">{{ group.items.length }}</span>
        </button>

        <div v-show="!collapsed[group.volume.id]" class="chapter-list">
          <button
            v-for="chapter in group.items"
            :key="chapter.id"
            class="chapter-row"
            :class="{ active: appStore.selectedChapterId === chapter.id }"
            @click="appStore.selectChapter(chapter.id); emit('navigate')"
          >
            <FileText :size="13" class="chap-icon" />
            <span class="chap-title">{{ chapter.title }}</span>
            <n-tag size="tiny" :type="statusType(chapter.status)" :bordered="false">
              {{ formatStatus(chapter.status) }}
            </n-tag>
            <n-dropdown :options="chapterMenuOptions" placement="bottom-end" @select="(k) => handleMenuSelect(k, chapter)">
              <span class="chap-more" @click.stop>
                <MoreVertical :size="12" />
              </span>
            </n-dropdown>
          </button>
          <button class="chapter-add" @click="appStore.createChapter(group.volume.id)">
            <Plus :size="12" /> 新增章节
          </button>
        </div>
      </section>
    </div>

    <footer class="ts-footer">
      <span>{{ totalVisible }} / {{ appStore.chapters.length }} 章 · {{ totalWords.toLocaleString() }} 字</span>
    </footer>

    <ChapterMetaDialog
      v-model:show="metaDialogVisible"
      :chapter="metaDialogChapter"
    />
  </aside>
</template>

<style scoped>
.tree-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--arc-bg-weak);
  border-right: 1px solid var(--arc-border);
  overflow: hidden;
}

.ts-header {
  padding: 12px 12px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--arc-border);
}

.project-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-name .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--arc-success);
  flex-shrink: 0;
}

.icon-btn {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition: 0.15s;
}

.icon-btn:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.icon-btn.flex { flex: 1; }

.ts-toolbar {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--arc-border);
}

.ts-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 12px;
  padding: 6px 10px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-sm);
  color: var(--arc-text-hint);
}

.ts-search input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
  color: var(--arc-text-primary);
}

.ts-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0 12px;
}

.volume {
  margin-bottom: 2px;
}

.volume-head {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 12px 6px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  color: var(--arc-text-secondary);
  letter-spacing: 0.04em;
}

.volume-head:hover {
  background: var(--arc-bg-surface-hover);
}

.volume-head .chevron {
  transition: transform 0.15s;
  flex-shrink: 0;
}

.volume.collapsed .chevron {
  transform: rotate(-90deg);
}

.volume-title {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.volume-meta {
  font-size: 11px;
  color: var(--arc-text-hint);
  font-weight: 500;
}

.chapter-list {
  display: flex;
  flex-direction: column;
}

.chapter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px 7px 26px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--arc-text-primary);
  border-left: 2px solid transparent;
  text-align: left;
  transition: background 0.15s ease;
}

.chapter-row:hover {
  background: var(--arc-bg-surface-hover);
}

.chapter-row.active {
  background: var(--arc-primary-soft);
  border-left-color: var(--arc-primary);
  font-weight: 500;
}

.chapter-row .chap-icon {
  color: var(--arc-text-hint);
  flex-shrink: 0;
}

.chapter-row.active .chap-icon {
  color: var(--arc-primary);
}

.chap-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chap-more {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--arc-text-hint);
}

.chap-more:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.chapter-add {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px 5px 26px;
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--arc-text-hint);
  cursor: pointer;
}

.chapter-add:hover {
  color: var(--arc-primary);
  background: var(--arc-bg-surface-hover);
}

.ts-footer {
  padding: 8px 12px;
  border-top: 1px solid var(--arc-border);
  font-size: 11px;
  color: var(--arc-text-hint);
}
</style>
