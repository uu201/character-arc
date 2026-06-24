<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search, Sparkles } from 'lucide-vue-next'
import {
  NAlert,
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NInput,
  NList,
  NListItem,
  NModal,
  NScrollbar,
  NStatistic,
  NTag,
  useDialog,
  useMessage
} from 'naive-ui'
import {
  buildKnowledgeCenterState,
  buildReferenceAssetLibraries,
  compareReferenceAssetDocuments,
  type KnowledgeDocumentView,
  type ReferenceAssetLibrary
} from '@/features/knowledge/knowledgeCenter'
import { useAppStore } from '@/stores/app'
import { useBatchImport } from '@/composables/useBatchImport'
import BatchImportModal from './BatchImportModal.vue'

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const { openModal } = useBatchImport()

const keyword = ref('')
const selectedDocument = ref<KnowledgeDocumentView | null>(null)

const allState = computed(() => buildKnowledgeCenterState(appStore.knowledgeDocuments))
const referenceAssets = computed(() =>
  buildReferenceAssetLibraries(appStore.referenceWorks, allState.value.documents)
)
const detailVisible = computed({
  get: () => Boolean(selectedDocument.value),
  set: (value: boolean) => {
    if (!value) {
      selectedDocument.value = null
    }
  }
})

const healthTone = computed(() => (referenceAssets.value.length > 0 ? 'stable' : 'attention'))

const librarySummaryCards = computed(() => [
  {
    key: 'assets',
    label: '参考资产',
    value: referenceAssets.value.length.toLocaleString(),
    hint: '已归档的参考作品与拆书簇'
  },
  {
    key: 'summaries',
    label: '总纲文档',
    value: referenceAssets.value.reduce((count, asset) => count + asset.summaryCount, 0).toLocaleString(),
    hint: '整书风格总纲与骨架'
  },
  {
    key: 'chunks',
    label: '分块文档',
    value: referenceAssets.value.reduce((count, asset) => count + asset.chunkCount, 0).toLocaleString(),
    hint: '局部拆书结论与桥段分析'
  },
  {
    key: 'duplicate',
    label: '风格规则',
    value: referenceAssets.value.reduce((count, asset) => count + asset.styleRules.length, 0).toLocaleString(),
    hint: '累计沉淀的可复用写法'
  }
])

function openDocument(documentView: KnowledgeDocumentView): void {
  selectedDocument.value = documentView
}

function openReferenceAsset(asset: ReferenceAssetLibrary): void {
  if (asset.primaryDocument) {
    openDocument(asset.primaryDocument)
  }
}

function removeReferenceAsset(asset: ReferenceAssetLibrary): void {
  dialog.warning({
    title: '删除参考资产',
    content: `确认删除《${asset.title}》的拆书资产吗？这会一并删除关联的知识文档和参考作品档案，无法撤销。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      appStore.removeKnowledgeDocuments(asset.relatedDocumentIds)
      appStore.removeReferenceWork(asset.id)
      if (selectedDocument.value && asset.relatedDocumentIds.includes(selectedDocument.value.document.id)) {
        selectedDocument.value = null
      }
      message.success(`已删除《${asset.title}》的拆书资产`)
    }
  })
}

function removeKnowledgeDocument(documentView: KnowledgeDocumentView): void {
  dialog.warning({
    title: '删除知识文档',
    content: `确认删除「${documentView.document.title}」吗？此操作无法撤销。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      appStore.removeKnowledgeDocuments([documentView.document.id])
      selectedDocument.value = null
      message.success(`已删除「${documentView.document.title}」`)
    }
  })
}

const deepAnalyzingAssetId = ref<string | null>(null)
const fingerprintExtractingAssetId = ref<string | null>(null)

const SOURCE_TEXT_CHAR_CAP = 30_000

function buildDeepAnalyzeSourceText(asset: ReferenceAssetLibrary): string {
  const chunks = appStore.knowledgeDocuments
    .filter((doc) => doc.sourceType === 'reference-chunk' && asset.relatedDocumentIds.includes(doc.id))
    .map((doc) => ({
      label: String(doc.metadata?.chunkLabel ?? doc.title).trim() || doc.title,
      order: Number(doc.metadata?.chunkOrder ?? Number.MAX_SAFE_INTEGER),
      text: String(doc.metadata?.rawText ?? doc.content ?? '')
    }))
    .sort((a, b) => a.order - b.order)

  if (!chunks.length) {
    return asset.primaryDocument?.document.content ?? ''
  }

  let acc = ''
  for (const chunk of chunks) {
    const piece = `\n\n【${chunk.label}】\n${chunk.text}`
    if (acc.length + piece.length > SOURCE_TEXT_CHAR_CAP) {
      acc += `\n\n[...剩余 ${chunks.length - chunks.indexOf(chunk)} 段已超出本次分析上限，本次只对前段拆解。]`
      break
    }
    acc += piece
  }
  return acc.trim()
}

async function handleAiDeepAnalyze(asset: ReferenceAssetLibrary): Promise<void> {
  if (deepAnalyzingAssetId.value) {
    message.info('上一次深度拆书还在进行中，请稍候。')
    return
  }

  const sourceText = buildDeepAnalyzeSourceText(asset)
  if (!sourceText.trim()) {
    message.error('找不到该参考作品的原文片段，无法进行深度拆书。')
    return
  }

  deepAnalyzingAssetId.value = asset.id
  const loading = message.loading(`AI 正在深度拆解《${asset.title}》，可能需要 1-3 分钟…`, { duration: 0 })
  try {
    const response = await window.characterArc.generateAi(JSON.parse(JSON.stringify({
      task: 'reference-deep-analyze',
      settings: appStore.appSettings,
      context: {
        referenceTitle: asset.title,
        referenceFileName: asset.fileName,
        referenceGenre: asset.topKeywords.slice(0, 3).join('、'),
        sourceText
      }
    })))

    if (!response.success) {
      throw new Error(response.error ?? 'AI 深度拆书失败')
    }
    message.success(`已完成《${asset.title}》深度拆书，新增的知识文档稍后会出现在列表中。`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 深度拆书失败')
  } finally {
    loading.destroy()
    deepAnalyzingAssetId.value = null
  }
}

async function handleStyleFingerprintExtract(asset: ReferenceAssetLibrary): Promise<void> {
  if (fingerprintExtractingAssetId.value) {
    message.info('上一次风格指纹提取还在进行中，请稍候。')
    return
  }

  const novelResult = await window.characterArc.readReferenceNovelText(asset.id)
  if (!novelResult.success || !novelResult.content) {
    message.error(novelResult.error ?? '未找到该参考作品的原文存档，请重新导入参考小说。')
    return
  }

  const sourceText = novelResult.content.length > 80000 ? novelResult.content.slice(0, 80000) : novelResult.content

  fingerprintExtractingAssetId.value = asset.id
  const loading = message.loading(`AI 正在从原文提取《${asset.title}》的风格指纹（${Math.round(sourceText.length / 10000)}万字样本），可能需要 2-4 分钟…`, { duration: 0 })
  try {
    const response = await window.characterArc.generateAi(JSON.parse(JSON.stringify({
      task: 'style-fingerprint-extract',
      settings: appStore.appSettings,
      context: {
        referenceTitle: asset.title,
        referenceFileName: asset.fileName,
        referenceGenre: asset.topKeywords.slice(0, 3).join('、'),
        sourceText
      }
    })))

    if (!response.success) {
      throw new Error(response.error ?? 'AI 风格指纹提取失败')
    }
    message.success(`已完成《${asset.title}》风格指纹提取，新增的知识文档稍后会出现在列表中。`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 风格指纹提取失败')
  } finally {
    loading.destroy()
    fingerprintExtractingAssetId.value = null
  }
}

const groupedAssets = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) {
    return referenceAssets.value
  }

  return referenceAssets.value.filter((asset) => {
    const relatedDocuments = allState.value.documents.filter((item) => asset.relatedDocumentIds.includes(item.document.id))
    const haystack = [
      asset.title,
      asset.source,
      asset.fileName,
      asset.summary,
      asset.topKeywords.join(' '),
      asset.styleRules.join(' '),
      ...relatedDocuments.flatMap((item) => [
        item.document.title,
        item.document.summary,
        item.document.content,
        item.document.keywords.join(' ')
      ])
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(query)
  })
})

function resolveAssetDocuments(asset: ReferenceAssetLibrary): KnowledgeDocumentView[] {
  return allState.value.documents
    .filter((item) => asset.relatedDocumentIds.includes(item.document.id))
    .sort((left, right) => compareReferenceAssetDocuments(left.document, right.document))
}
</script>

<template>
  <section class="knowledge-screen">
    <!-- Header -->
    <div class="knowledge-header">
      <div class="knowledge-header-left">
        <strong>拆书知识库</strong>
        <n-tag :type="healthTone === 'stable' ? 'success' : 'warning'" size="small" round :bordered="false">
          {{ healthTone === 'stable' ? '已归档' : '等待第一部参考作品' }}
        </n-tag>
      </div>
      <div class="knowledge-header-actions">
        <n-button secondary @click="openModal">
          导入小说并拆书
        </n-button>
      </div>
    </div>

    <!-- Stats -->
    <div class="knowledge-stats-row">
      <n-card v-for="card in librarySummaryCards" :key="card.key" size="small">
        <n-statistic :label="card.label" :value="card.value" />
      </n-card>
    </div>

    <!-- Search -->
    <div class="knowledge-toolbar">
      <n-input
        v-model:value="keyword"
        clearable
        class="knowledge-toolbar-search"
        placeholder="搜索参考作品、总纲、分块或风格规则"
      >
        <template #prefix>
          <Search :size="14" />
        </template>
      </n-input>
      <n-tag size="small" round :bordered="false" type="info">
        {{ groupedAssets.length }} / {{ referenceAssets.length }} 部
      </n-tag>
    </div>

    <!-- Asset Library -->
    <n-empty v-if="!groupedAssets.length" description="还没有沉淀参考资产，先导入参考小说并拆书。" />

    <div v-else class="knowledge-asset-stack">
      <n-card v-for="asset in groupedAssets" :key="asset.id" size="small">
        <template #header>
          <div class="asset-header">
            <strong>{{ asset.title }}</strong>
            <span>{{ asset.source }}<template v-if="asset.fileName"> &middot; {{ asset.fileName }}</template></span>
          </div>
        </template>

        <template #header-extra>
          <n-tag size="small" :bordered="false" type="info">{{ asset.documentCount }} 篇</n-tag>
        </template>

        <p class="asset-summary">{{ asset.summary }}</p>

        <div class="asset-metrics">
          <n-tag v-if="asset.summaryCount" size="tiny" :bordered="false">总纲 {{ asset.summaryCount }}</n-tag>
          <n-tag v-if="asset.chunkCount" size="tiny" :bordered="false">分块 {{ asset.chunkCount }}</n-tag>
          <n-tag v-if="asset.chapterCount > 0" size="tiny" :bordered="false">{{ asset.chapterCount }} 章</n-tag>
          <n-tag v-if="asset.characterCount > 0" size="tiny" :bordered="false">{{ asset.characterCount.toLocaleString() }} 字</n-tag>
          <span class="asset-date">{{ asset.updatedAtLabel }}</span>
        </div>

        <div v-if="asset.styleRules.length" class="asset-tags">
          <n-tag v-for="rule in asset.styleRules.slice(0, 4)" :key="`${asset.id}-${rule}`" size="small" round type="primary" :bordered="false">
            {{ rule }}
          </n-tag>
        </div>
        <div v-else-if="asset.topKeywords.length" class="asset-tags">
          <n-tag v-for="tag in asset.topKeywords.slice(0, 6)" :key="`${asset.id}-${tag}`" size="small" round type="primary" :bordered="false">
            {{ tag }}
          </n-tag>
        </div>

        <div class="asset-actions">
          <n-button tertiary type="primary" size="small" @click="openReferenceAsset(asset)">查看主文档</n-button>
          <n-button
            type="primary"
            size="small"
            :loading="deepAnalyzingAssetId === asset.id"
            :disabled="Boolean(deepAnalyzingAssetId) && deepAnalyzingAssetId !== asset.id"
            @click="handleAiDeepAnalyze(asset)"
          >
            <template #icon><Sparkles :size="14" /></template>
            AI 深度拆书
          </n-button>
          <n-button
            type="warning"
            size="small"
            :loading="fingerprintExtractingAssetId === asset.id"
            :disabled="Boolean(fingerprintExtractingAssetId) && fingerprintExtractingAssetId !== asset.id"
            @click="handleStyleFingerprintExtract(asset)"
          >
            <template #icon><Sparkles :size="14" /></template>
            风格指纹提取
          </n-button>
          <n-button tertiary type="error" size="small" @click="removeReferenceAsset(asset)">删除</n-button>
        </div>

        <n-collapse class="asset-docs-collapse">
          <n-collapse-item :title="`文档列表 (${resolveAssetDocuments(asset).length} 篇)`" name="docs">
            <n-list hoverable clickable size="small">
              <n-list-item
                v-for="item in resolveAssetDocuments(asset)"
                :key="item.document.id"
                @click="openDocument(item)"
              >
                <div class="doc-item">
                  <div class="doc-item-top">
                    <strong>{{ item.document.title }}</strong>
                    <n-tag size="tiny" :bordered="false" type="info">{{ item.sourceTypeLabel }}</n-tag>
                  </div>
                  <p>{{ item.preview || '暂无摘要' }}</p>
                  <span>{{ item.updatedAtLabel }}</span>
                </div>
              </n-list-item>
            </n-list>
          </n-collapse-item>
        </n-collapse>
      </n-card>
    </div>


    <!-- Batch Import Modal -->
    <BatchImportModal />

    <!-- Detail Modal -->
    <n-modal v-model:show="detailVisible">
      <n-card style="width: min(920px, 92vw)" :bordered="false" role="dialog" aria-modal="true">
        <template #header>
          <div class="detail-header">
            <strong>{{ selectedDocument?.document.title ?? '知识详情' }}</strong>
            <span>{{ selectedDocument?.sourceLabelText ?? '' }}</span>
          </div>
        </template>
        <template #header-extra>
          <div v-if="selectedDocument" class="detail-header-actions">
            <n-tag type="info" :bordered="false">{{ selectedDocument.sourceTypeLabel }}</n-tag>
            <n-button tertiary type="error" size="small" @click="removeKnowledgeDocument(selectedDocument)">删除文档</n-button>
          </div>
        </template>

        <div v-if="selectedDocument" class="detail-body">
          <n-descriptions :column="3" label-placement="left" size="small" bordered>
            <n-descriptions-item label="范围">{{ selectedDocument.sourceScopeLabel }}</n-descriptions-item>
            <n-descriptions-item label="更新时间">{{ selectedDocument.updatedAtLabel }}</n-descriptions-item>
            <n-descriptions-item label="关键词数">{{ selectedDocument.document.keywords.length }} 个</n-descriptions-item>
          </n-descriptions>

          <n-alert v-if="selectedDocument.document.summary" type="info" :show-icon="false">
            {{ selectedDocument.document.summary }}
          </n-alert>

          <div v-if="selectedDocument.document.keywords.length" class="detail-keywords">
            <n-tag v-for="kw in selectedDocument.document.keywords" :key="kw" size="small" round type="primary" :bordered="false">
              {{ kw }}
            </n-tag>
          </div>

          <n-scrollbar style="max-height: 36vh">
            <pre class="detail-content">{{ selectedDocument.document.content || '暂无正文内容。' }}</pre>
          </n-scrollbar>
        </div>
      </n-card>
    </n-modal>
  </section>
</template>

<style scoped>
.knowledge-screen {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
}

.knowledge-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.knowledge-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.knowledge-header-left strong {
  font-size: 16px;
  font-weight: 700;
  color: var(--arc-text-primary);
}

.knowledge-header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.knowledge-stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}

.knowledge-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.knowledge-toolbar-search {
  min-width: min(100%, 280px);
  flex: 1;
}

.knowledge-asset-stack {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 12px;
}

.knowledge-asset-stack :deep(.n-card),
.knowledge-asset-stack :deep(.n-card__content),
.knowledge-asset-stack :deep(.n-card-header),
.knowledge-asset-stack :deep(.n-card-header__main),
.knowledge-asset-stack :deep(.n-card-header__extra) {
  min-width: 0;
}

.asset-header {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.asset-header strong {
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-header span {
  color: var(--arc-text-secondary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-summary {
  margin: 0 0 8px;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.asset-metrics {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.asset-date {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.asset-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.asset-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.asset-docs-collapse {
  min-width: 0;
  border-top: 1px solid var(--arc-border);
  padding-top: 6px;
}

.asset-docs-collapse :deep(.n-collapse-item__header-main),
.asset-docs-collapse :deep(.n-collapse-item__content-inner),
.asset-docs-collapse :deep(.n-list),
.asset-docs-collapse :deep(.n-list-item),
.asset-docs-collapse :deep(.n-list-item__main) {
  min-width: 0;
}

.doc-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.doc-item-top {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.doc-item-top strong {
  flex: 1;
  min-width: 0;
  color: var(--arc-text-primary);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-item p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.doc-item span {
  color: var(--arc-text-hint);
  font-size: 11px;
  min-width: 0;
}

.knowledge-section-head {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.knowledge-section-head strong {
  font-size: 15px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.skill-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.skill-desc {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.detail-header {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.detail-header strong {
  color: var(--arc-text-primary);
  font-size: 16px;
  overflow-wrap: anywhere;
}

.detail-header span {
  color: var(--arc-text-secondary);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.detail-content {
  margin: 0;
  padding: 14px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 640px) {
  .skill-grid {
    grid-template-columns: 1fr;
  }

  .doc-item-top {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
