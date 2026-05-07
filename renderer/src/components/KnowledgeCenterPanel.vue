<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertCircle, BookCopy, LibraryBig, Search, Sparkles } from 'lucide-vue-next'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NInput,
  NModal,
  NScrollbar,
  NSelect,
  NTag,
  useDialog,
  useMessage
} from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import PanelFrame from './PanelFrame.vue'
import {
  buildKnowledgeCenterState,
  buildReferenceAssetLibraries,
  filterKnowledgeDocumentViews,
  resolveKnowledgeSourceTypeLabel,
  type KnowledgeConflictGroup,
  type KnowledgeDocumentView,
  type KnowledgeDuplicateGroup,
  type KnowledgeSourceFilter,
  type ReferenceAssetLibrary
} from '@/features/knowledge/knowledgeCenter'
import { useAppStore } from '@/stores/app'
import type { KnowledgeDocumentSourceType } from '@/types/app'

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()

const keyword = ref('')
const sourceFilter = ref<KnowledgeSourceFilter>('all')
const selectedDocument = ref<KnowledgeDocumentView | null>(null)

const allState = computed(() => buildKnowledgeCenterState(appStore.knowledgeDocuments))
const filteredDocuments = computed(() =>
  filterKnowledgeDocumentViews(allState.value.documents, keyword.value, sourceFilter.value)
)
const visibleState = computed(() =>
  buildKnowledgeCenterState(filteredDocuments.value.map((item) => item.document))
)
const referenceAssets = computed(() =>
  buildReferenceAssetLibraries(appStore.currentProject?.referenceWorks ?? [], allState.value.documents)
)

const currentProjectTitle = computed(() => appStore.currentProject?.title?.trim() || '当前项目')
const detailVisible = computed({
  get: () => Boolean(selectedDocument.value),
  set: (value: boolean) => {
    if (!value) {
      selectedDocument.value = null
    }
  }
})

const sourceTypeOrder: KnowledgeDocumentSourceType[] = [
  'workflow-document',
  'canon-fact',
  'chapter-summary',
  'reference-summary',
  'reference-chunk'
]

const sourceFilterOptions = computed<SelectOption[]>(() => {
  const typeCountMap = allState.value.documents.reduce<Record<string, number>>((accumulator, item) => {
    accumulator[item.document.sourceType] = (accumulator[item.document.sourceType] ?? 0) + 1
    return accumulator
  }, {})

  return [
    { label: `全部来源 · ${allState.value.stats.totalDocuments}`, value: 'all' },
    { label: `项目记忆 · ${allState.value.stats.projectDocuments}`, value: 'project' },
    { label: `参考资料 · ${allState.value.stats.referenceDocuments}`, value: 'reference' },
    ...sourceTypeOrder
      .filter((sourceType) => typeCountMap[sourceType] > 0)
      .map((sourceType) => ({
        label: `${resolveKnowledgeSourceTypeLabel(sourceType)} · ${typeCountMap[sourceType]}`,
        value: sourceType
      }))
  ]
})

const summaryCards = computed(() => [
  {
    key: 'total',
    label: '知识文档',
    value: allState.value.stats.totalDocuments.toLocaleString(),
    hint: '项目事实与拆书资产总量'
  },
  {
    key: 'project',
    label: '项目记忆',
    value: allState.value.stats.projectDocuments.toLocaleString(),
    hint: '流程文档、设定事实与章节摘要'
  },
  {
    key: 'reference',
    label: '参考资料',
    value: allState.value.stats.referenceDocuments.toLocaleString(),
    hint: '拆书总纲与分块摘录'
  },
  {
    key: 'duplicate',
    label: '待去重',
    value: allState.value.stats.duplicateDocuments.toLocaleString(),
    hint: `${allState.value.stats.duplicateGroups} 组完全重复`
  },
  {
    key: 'conflict',
    label: '待核对',
    value: allState.value.stats.conflictGroups.toLocaleString(),
    hint: `${allState.value.stats.conflictDocuments} 条处于同名冲突组`
  }
])

const healthTone = computed(() =>
  allState.value.stats.duplicateDocuments === 0 && allState.value.stats.conflictGroups === 0
    ? 'stable'
    : 'attention'
)

const heroSummary = computed(() => {
  if (healthTone.value === 'stable') {
    return '当前知识库没有发现完全重复项或同名冲突，项目记忆结构比较干净。'
  }

  return `当前发现 ${allState.value.stats.duplicateDocuments} 条重复记录、${allState.value.stats.conflictGroups} 组冲突项，建议先整理知识底座再继续扩写。`
})

function openDocument(documentView: KnowledgeDocumentView): void {
  selectedDocument.value = documentView
}

function requestCleanDuplicateGroup(group: KnowledgeDuplicateGroup): void {
  if (!group.removeDocumentIds.length) {
    return
  }

  dialog.warning({
    title: '确认清理重复知识',
    content: `将为“${group.title}”保留最新 1 条记录，并移除其余 ${group.removeDocumentIds.length} 条完全重复项。`,
    positiveText: '确认清理',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.removeKnowledgeDocuments(String(appStore.selectedProjectId ?? ''), group.removeDocumentIds)
      message.success(`已清理“${group.title}”的重复知识`)
    }
  })
}

function requestCleanAllDuplicates(): void {
  const duplicateIds = Array.from(
    new Set(allState.value.duplicateGroups.flatMap((group) => group.removeDocumentIds))
  )
  if (!duplicateIds.length) {
    return
  }

  dialog.warning({
    title: '确认一键清理重复项',
    content: `将为“${currentProjectTitle.value}”保留每组重复知识中的最新版本，并移除其余 ${duplicateIds.length} 条重复记录。`,
    positiveText: '确认清理',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.removeKnowledgeDocuments(String(appStore.selectedProjectId ?? ''), duplicateIds)
      message.success('知识库重复项已清理')
    }
  })
}

function summarizeConflictTypes(group: KnowledgeConflictGroup): string {
  return Array.from(new Set(group.documents.map((item) => item.sourceTypeLabel))).join(' / ')
}

function openReferenceAsset(asset: ReferenceAssetLibrary): void {
  if (asset.primaryDocument) {
    openDocument(asset.primaryDocument)
    return
  }

  focusReferenceAsset(asset)
}

function focusReferenceAsset(asset: ReferenceAssetLibrary): void {
  keyword.value = asset.fileName || asset.title
  sourceFilter.value = 'reference'
}
</script>

<template>
  <PanelFrame title="知识库中心">
    <template #title>
      <div class="knowledge-panel-title">
        <strong>知识库中心</strong>
        <span>整理项目事实、拆书摘要与可疑冲突</span>
      </div>
    </template>

    <template #actions>
      <n-tag :type="healthTone === 'stable' ? 'success' : 'warning'" round :bordered="false">
        {{ healthTone === 'stable' ? '状态稳定' : '需要整理' }}
      </n-tag>
      <n-button
        v-if="allState.stats.duplicateDocuments > 0"
        type="primary"
        secondary
        size="small"
        @click="requestCleanAllDuplicates"
      >
        清理重复项
      </n-button>
    </template>

    <div class="knowledge-center">
      <section class="knowledge-hero">
        <div class="knowledge-hero-copy">
          <div class="knowledge-hero-badge">
            <BookCopy :size="15" />
            <span>项目知识治理</span>
          </div>
          <h2>把项目记忆和参考拆书结果放到同一张桌面上整理。</h2>
          <p>{{ heroSummary }}</p>
        </div>
        <div class="knowledge-hero-side">
          <div class="knowledge-hero-chip">
            <component :is="healthTone === 'stable' ? Sparkles : AlertCircle" :size="15" />
            <span>{{ healthTone === 'stable' ? '可以继续扩写' : '建议先清理底座' }}</span>
          </div>
          <strong>{{ allState.stats.totalDocuments }}</strong>
          <span>条知识文档</span>
        </div>
      </section>

      <section class="knowledge-stats-grid">
        <article v-for="card in summaryCards" :key="card.key" class="knowledge-stat-card">
          <span class="knowledge-stat-label">{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <p>{{ card.hint }}</p>
        </article>
      </section>

      <section class="knowledge-toolbar">
        <n-input
          v-model:value="keyword"
          clearable
          class="knowledge-toolbar-search"
          placeholder="搜索标题、摘要、来源标签或关键词"
        >
          <template #prefix>
            <Search :size="14" />
          </template>
        </n-input>

        <n-select
          v-model:value="sourceFilter"
          class="knowledge-toolbar-filter"
          :options="sourceFilterOptions"
        />

        <n-tag round :bordered="false" type="info">
          当前显示 {{ visibleState.documents.length }} / {{ allState.documents.length }} 条
        </n-tag>
      </section>

      <section class="knowledge-section">
        <div class="knowledge-section-head">
          <div>
            <h3>拆文库 / 对标资产管理</h3>
            <p>把参考作品档案和拆书知识文档绑在一起，方便回到单个对标资产继续复盘。</p>
          </div>
          <n-tag type="info" :bordered="false">
            {{ referenceAssets.length }} 项
          </n-tag>
        </div>

        <n-empty
          v-if="!referenceAssets.length"
          description="当前还没有沉淀参考资产，先去参考阶段导入拆书作品吧。"
        />

        <div v-else class="knowledge-asset-grid">
          <n-card
            v-for="asset in referenceAssets"
            :key="asset.id"
            size="small"
            :bordered="false"
            class="knowledge-asset-card"
          >
            <template #header>
              <div class="knowledge-group-headline">
                <strong>{{ asset.title }}</strong>
                <span>{{ asset.source }}<template v-if="asset.fileName"> · {{ asset.fileName }}</template></span>
              </div>
            </template>

            <template #header-extra>
              <div class="knowledge-asset-badge">
                <LibraryBig :size="14" />
                <span>{{ asset.documentCount }} 篇文档</span>
              </div>
            </template>

            <p class="knowledge-asset-summary">{{ asset.summary }}</p>

            <div class="knowledge-asset-metrics">
              <span>总纲 {{ asset.summaryCount }}</span>
              <span>分块 {{ asset.chunkCount }}</span>
              <span v-if="asset.chapterCount > 0">估算 {{ asset.chapterCount }} 章/段</span>
              <span v-if="asset.characterCount > 0">约 {{ asset.characterCount.toLocaleString() }} 字</span>
              <span>更新于 {{ asset.updatedAtLabel }}</span>
            </div>

            <div v-if="asset.styleRules.length" class="knowledge-document-keywords">
              <span v-for="rule in asset.styleRules.slice(0, 4)" :key="`${asset.id}-${rule}`">{{ rule }}</span>
            </div>

            <div v-else-if="asset.topKeywords.length" class="knowledge-document-keywords">
              <span v-for="tag in asset.topKeywords.slice(0, 6)" :key="`${asset.id}-${tag}`">{{ tag }}</span>
            </div>

            <div class="knowledge-asset-actions">
              <n-button tertiary type="primary" size="small" @click="openReferenceAsset(asset)">
                查看主文档
              </n-button>
              <n-button tertiary size="small" @click="focusReferenceAsset(asset)">
                筛到此资产
              </n-button>
            </div>
          </n-card>
        </div>
      </section>

      <section class="knowledge-section">
        <div class="knowledge-section-head">
          <div>
            <h3>重复项</h3>
            <p>只标记完全重复的知识记录，适合直接做安全去重。</p>
          </div>
          <n-tag v-if="visibleState.duplicateGroups.length" type="warning" :bordered="false">
            {{ visibleState.duplicateGroups.length }} 组
          </n-tag>
        </div>

        <n-alert
          v-if="visibleState.duplicateGroups.length"
          type="warning"
          :show-icon="false"
          class="knowledge-inline-alert"
        >
          当前筛选范围内发现 {{ visibleState.duplicateGroups.length }} 组完全重复项，可以保留最新版本并清理其余记录。
        </n-alert>

        <n-empty
          v-if="!visibleState.duplicateGroups.length"
          description="当前筛选范围内没有发现完全重复的知识文档。"
        />

        <div v-else class="knowledge-group-grid">
          <n-card
            v-for="group in visibleState.duplicateGroups"
            :key="group.id"
            size="small"
            :bordered="false"
            class="knowledge-group-card"
          >
            <template #header>
              <div class="knowledge-group-headline">
                <strong>{{ group.title }}</strong>
                <span>{{ group.sourceScopeLabel }} · {{ group.sourceTypeLabel }}</span>
              </div>
            </template>

            <template #header-extra>
              <n-button
                tertiary
                type="primary"
                size="small"
                @click="requestCleanDuplicateGroup(group)"
              >
                保留最新并清理
              </n-button>
            </template>

            <div class="knowledge-group-body">
              <button
                v-for="item in group.documents"
                :key="item.document.id"
                type="button"
                class="knowledge-group-item"
                @click="openDocument(item)"
              >
                <div class="knowledge-group-item-top">
                  <strong>{{ item.document.id === group.keepDocumentId ? '保留版本' : '重复版本' }}</strong>
                  <span>{{ item.updatedAtLabel }}</span>
                </div>
                <p>{{ item.preview || '暂无摘要，点击查看正文。' }}</p>
                <div class="knowledge-group-item-meta">
                  <span>{{ item.sourceLabelText }}</span>
                  <span>{{ item.document.keywords.slice(0, 4).join(' · ') || '无关键词' }}</span>
                </div>
              </button>
            </div>
          </n-card>
        </div>
      </section>

      <section class="knowledge-section">
        <div class="knowledge-section-head">
          <div>
            <h3>冲突项</h3>
            <p>聚焦项目记忆中的同名多版本知识，帮助你尽快核对口径差异。</p>
          </div>
          <n-tag v-if="visibleState.conflictGroups.length" type="error" :bordered="false">
            {{ visibleState.conflictGroups.length }} 组
          </n-tag>
        </div>

        <n-alert
          v-if="visibleState.conflictGroups.length"
          type="error"
          :show-icon="false"
          class="knowledge-inline-alert"
        >
          冲突项不会自动删除。建议先查看详情，再决定是否保留最新版本或回写统一结论。
        </n-alert>

        <n-empty
          v-if="!visibleState.conflictGroups.length"
          description="当前筛选范围内没有发现同名冲突的项目知识。"
        />

        <div v-else class="knowledge-group-grid">
          <n-card
            v-for="group in visibleState.conflictGroups"
            :key="group.id"
            size="small"
            :bordered="false"
            class="knowledge-group-card knowledge-group-card--conflict"
          >
            <template #header>
              <div class="knowledge-group-headline">
                <strong>{{ group.title }}</strong>
                <span>{{ summarizeConflictTypes(group) }}</span>
              </div>
            </template>

            <p class="knowledge-conflict-reason">{{ group.reason }}</p>

            <div class="knowledge-group-body">
              <button
                v-for="item in group.documents"
                :key="item.document.id"
                type="button"
                class="knowledge-group-item knowledge-group-item--conflict"
                @click="openDocument(item)"
              >
                <div class="knowledge-group-item-top">
                  <strong>{{ item.sourceTypeLabel }}</strong>
                  <span>{{ item.updatedAtLabel }}</span>
                </div>
                <p>{{ item.preview || '暂无摘要，点击查看正文。' }}</p>
                <div class="knowledge-group-item-meta">
                  <span>{{ item.sourceLabelText }}</span>
                  <span>{{ item.document.keywords.slice(0, 4).join(' · ') || '无关键词' }}</span>
                </div>
              </button>
            </div>
          </n-card>
        </div>
      </section>

      <section class="knowledge-section">
        <div class="knowledge-section-head">
          <div>
            <h3>全部知识文档</h3>
            <p>点击卡片查看全文、摘要、关键词和来源信息。</p>
          </div>
          <n-tag type="default" :bordered="false">
            {{ visibleState.documents.length }} 条
          </n-tag>
        </div>

        <n-empty
          v-if="!visibleState.documents.length"
          description="当前筛选条件下没有命中文档。"
        />

        <div v-else class="knowledge-document-grid">
          <n-card
            v-for="item in visibleState.documents"
            :key="item.document.id"
            size="small"
            :bordered="false"
            class="knowledge-document-card"
            @click="openDocument(item)"
          >
            <div class="knowledge-document-top">
              <div class="knowledge-document-headline">
                <div class="knowledge-document-tags">
                  <n-tag size="small" :bordered="false">{{ item.sourceScopeLabel }}</n-tag>
                  <n-tag size="small" type="info" :bordered="false">{{ item.sourceTypeLabel }}</n-tag>
                  <n-tag v-if="item.duplicateGroupId" size="small" type="warning" :bordered="false">重复</n-tag>
                  <n-tag v-if="item.conflictGroupId" size="small" type="error" :bordered="false">冲突</n-tag>
                </div>
                <h4>{{ item.document.title }}</h4>
                <span>{{ item.sourceLabelText }}</span>
              </div>
              <span class="knowledge-document-time">{{ item.updatedAtLabel }}</span>
            </div>

            <p class="knowledge-document-preview">
              {{ item.preview || '暂无摘要，点击查看正文。' }}
            </p>

            <div class="knowledge-document-bottom">
              <div class="knowledge-document-keywords">
                <span v-for="keyword in item.document.keywords.slice(0, 6)" :key="keyword">{{ keyword }}</span>
              </div>
              <n-button text type="primary" @click.stop="openDocument(item)">查看全文</n-button>
            </div>
          </n-card>
        </div>
      </section>
    </div>

    <n-modal v-model:show="detailVisible">
      <n-card
        class="knowledge-detail-modal"
        :bordered="false"
        title="知识详情"
        role="dialog"
        aria-modal="true"
      >
        <template #header>
          <div class="knowledge-detail-title">
            <strong>{{ selectedDocument?.document.title ?? '知识详情' }}</strong>
            <span>{{ selectedDocument?.sourceLabelText ?? '' }}</span>
          </div>
        </template>

        <template #header-extra>
          <n-tag v-if="selectedDocument" type="info" :bordered="false">
            {{ selectedDocument.sourceTypeLabel }}
          </n-tag>
        </template>

        <div v-if="selectedDocument" class="knowledge-detail">
          <div class="knowledge-detail-meta">
            <span>{{ selectedDocument.sourceScopeLabel }}</span>
            <span>{{ selectedDocument.updatedAtLabel }}</span>
            <span>{{ selectedDocument.document.keywords.length }} 个关键词</span>
          </div>

          <n-alert
            v-if="selectedDocument.document.summary"
            type="info"
            :show-icon="false"
            class="knowledge-inline-alert"
          >
            {{ selectedDocument.document.summary }}
          </n-alert>

          <div v-if="selectedDocument.document.keywords.length" class="knowledge-detail-keywords">
            <span v-for="keyword in selectedDocument.document.keywords" :key="keyword">{{ keyword }}</span>
          </div>

          <n-scrollbar class="knowledge-detail-scroll">
            <pre class="knowledge-detail-content">{{ selectedDocument.document.content || '暂无正文内容。' }}</pre>
          </n-scrollbar>
        </div>
      </n-card>
    </n-modal>
  </PanelFrame>
</template>

<style scoped>
.knowledge-panel-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.knowledge-panel-title strong {
  font-size: 16px;
  font-weight: 700;
}

.knowledge-panel-title span {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.knowledge-center {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.knowledge-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(220px, 0.8fr);
  gap: 20px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 14%, var(--arc-border));
  border-radius: 24px;
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--arc-primary) 20%, transparent) 0%, transparent 38%),
    linear-gradient(135deg, color-mix(in srgb, var(--arc-bg-surface) 88%, white) 0%, var(--arc-bg-surface) 100%);
  padding: 26px 28px;
}

.knowledge-hero-copy {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.knowledge-hero-badge {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.knowledge-hero-copy h2 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 26px;
  line-height: 1.2;
}

.knowledge-hero-copy p {
  margin: 0;
  max-width: 720px;
  color: var(--arc-text-secondary);
  line-height: 1.7;
}

.knowledge-hero-side {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  justify-content: space-between;
  border-radius: 20px;
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
  padding: 18px 20px;
}

.knowledge-hero-chip {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.knowledge-hero-side strong {
  color: var(--arc-text-primary);
  font-size: 42px;
  line-height: 1;
}

.knowledge-hero-side span:last-child {
  color: var(--arc-text-secondary);
  font-size: 13px;
}

.knowledge-stats-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
}

.knowledge-stat-card {
  border: 1px solid var(--arc-border);
  border-radius: 20px;
  background: color-mix(in srgb, var(--arc-bg-surface) 90%, white);
  padding: 18px 20px;
}

.knowledge-stat-label {
  display: block;
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.knowledge-stat-card strong {
  display: block;
  margin-top: 10px;
  color: var(--arc-text-primary);
  font-size: 28px;
  line-height: 1.1;
}

.knowledge-stat-card p {
  margin: 10px 0 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.knowledge-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.knowledge-toolbar-search {
  min-width: min(100%, 320px);
  flex: 1;
}

.knowledge-toolbar-filter {
  width: 220px;
}

.knowledge-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.knowledge-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.knowledge-section-head h3 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 18px;
}

.knowledge-section-head p {
  margin: 6px 0 0;
  color: var(--arc-text-secondary);
  line-height: 1.6;
}

.knowledge-inline-alert {
  border-radius: 16px;
}

.knowledge-group-grid,
.knowledge-document-grid,
.knowledge-asset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.knowledge-group-card,
.knowledge-document-card,
.knowledge-asset-card {
  border-radius: 20px;
  background: color-mix(in srgb, var(--arc-bg-surface) 92%, white);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}

.knowledge-group-card--conflict {
  border: 1px solid color-mix(in srgb, #ef4444 20%, var(--arc-border));
}

.knowledge-document-card {
  cursor: pointer;
}

.knowledge-group-card:hover,
.knowledge-document-card:hover,
.knowledge-asset-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
}

.knowledge-group-headline {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.knowledge-group-headline strong {
  color: var(--arc-text-primary);
}

.knowledge-group-headline span,
.knowledge-conflict-reason {
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.knowledge-conflict-reason {
  margin: 0 0 14px;
}

.knowledge-group-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.knowledge-group-item {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--arc-border) 86%, transparent);
  border-radius: 16px;
  background: var(--arc-bg-surface);
  padding: 14px;
  text-align: left;
  transition: border-color 0.18s ease, background 0.18s ease;
}

.knowledge-group-item:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 26%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 4%, var(--arc-bg-surface));
}

.knowledge-group-item--conflict:hover {
  border-color: color-mix(in srgb, #ef4444 22%, var(--arc-border));
  background: color-mix(in srgb, #ef4444 4%, var(--arc-bg-surface));
}

.knowledge-group-item-top,
.knowledge-group-item-meta,
.knowledge-document-top,
.knowledge-document-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.knowledge-group-item-top strong,
.knowledge-document-headline h4 {
  color: var(--arc-text-primary);
}

.knowledge-group-item-top span,
.knowledge-group-item-meta,
.knowledge-document-headline span,
.knowledge-document-time {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.knowledge-group-item p,
.knowledge-document-preview,
.knowledge-asset-summary {
  margin: 0;
  color: var(--arc-text-secondary);
  line-height: 1.7;
}

.knowledge-document-headline {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 8px;
}

.knowledge-document-headline h4 {
  margin: 0;
  font-size: 16px;
}

.knowledge-document-tags,
.knowledge-document-keywords,
.knowledge-detail-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.knowledge-document-keywords span,
.knowledge-detail-keywords span {
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
  padding: 4px 10px;
  font-size: 12px;
}

.knowledge-asset-badge,
.knowledge-asset-actions,
.knowledge-asset-metrics {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.knowledge-asset-badge {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.knowledge-asset-metrics {
  margin: 14px 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.knowledge-asset-actions {
  margin-top: 16px;
}

.knowledge-detail-modal {
  width: min(960px, 92vw);
  border-radius: 24px;
}

.knowledge-detail-title {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.knowledge-detail-title strong {
  color: var(--arc-text-primary);
  font-size: 18px;
}

.knowledge-detail-title span,
.knowledge-detail-meta {
  color: var(--arc-text-secondary);
  font-size: 13px;
}

.knowledge-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.knowledge-detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.knowledge-detail-scroll {
  max-height: 56vh;
  border: 1px solid var(--arc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--arc-bg-surface) 94%, black 2%);
  padding: 18px;
}

.knowledge-detail-content {
  margin: 0;
  color: var(--arc-text-primary);
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 1200px) {
  .knowledge-stats-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 960px) {
  .knowledge-hero,
  .knowledge-group-grid,
  .knowledge-document-grid,
  .knowledge-asset-grid {
    grid-template-columns: 1fr;
  }

  .knowledge-stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .knowledge-toolbar-filter {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .knowledge-hero,
  .knowledge-stat-card {
    padding: 18px;
  }

  .knowledge-stats-grid {
    grid-template-columns: 1fr;
  }

  .knowledge-document-top,
  .knowledge-document-bottom,
  .knowledge-group-item-top,
  .knowledge-group-item-meta,
  .knowledge-section-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
