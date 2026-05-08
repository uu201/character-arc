<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
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
  NProgress,
  NScrollbar,
  NStatistic,
  NStep,
  NSteps,
  NTag,
  useDialog,
  useMessage
} from 'naive-ui'
import {
  buildKnowledgeCenterState,
  buildReferenceAssetLibraries,
  type KnowledgeDocumentView,
  type ReferenceAssetLibrary
} from '@/features/knowledge/knowledgeCenter'
import { workflowStageDocumentMap } from '@/features/novelWorkflow/documents'
import { loadEnabledProjectSkillsContext } from '@/features/projectSkills/context'
import { useAppStore } from '@/stores/app'
import type { KnowledgeDocumentSourceType } from '@/types/app'

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()

const keyword = ref('')
const selectedDocument = ref<KnowledgeDocumentView | null>(null)
const isImportingReferenceNovel = ref(false)
const isGeneratingReferenceInsights = ref(false)
const activeReferenceSkillActionKey = ref<'long-scan' | 'short-scan' | 'long-analyze' | 'short-analyze' | ''>('')
const referenceImportProgress = ref<CharacterArcReferenceImportProgressPayload | null>(null)
const progressModalVisible = ref(false)

const allState = computed(() => buildKnowledgeCenterState(appStore.knowledgeDocuments))
const referenceAssets = computed(() =>
  buildReferenceAssetLibraries(appStore.currentProject?.referenceWorks ?? [], allState.value.documents)
)
const currentProject = computed(() => appStore.currentProject)
const detailVisible = computed({
  get: () => Boolean(selectedDocument.value),
  set: (value: boolean) => {
    if (!value) {
      selectedDocument.value = null
    }
  }
})

const healthTone = computed(() => (referenceAssets.value.length > 0 ? 'stable' : 'attention'))

const isReferenceOperationActive = computed(() =>
  isImportingReferenceNovel.value || isGeneratingReferenceInsights.value || Boolean(activeReferenceSkillActionKey.value)
)

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
    hint: '原文分块与局部摘录'
  },
  {
    key: 'duplicate',
    label: '风格规则',
    value: referenceAssets.value.reduce((count, asset) => count + asset.styleRules.length, 0).toLocaleString(),
    hint: '累计沉淀的可复用写法'
  }
])

const cleanupReferenceImportProgress = window.characterArc.onReferenceImportProgress((payload) => {
  referenceImportProgress.value = payload
})

onBeforeUnmount(() => {
  cleanupReferenceImportProgress()
})

function setReferenceProgress(payload: CharacterArcReferenceImportProgressPayload | null): void {
  referenceImportProgress.value = payload
  progressModalVisible.value = Boolean(payload)
}

function resolveReferenceSkillActionLabel(actionKey: 'long-scan' | 'short-scan' | 'long-analyze' | 'short-analyze'): string {
  switch (actionKey) {
    case 'long-scan':
      return '长篇扫榜'
    case 'short-scan':
      return '短篇扫榜'
    case 'long-analyze':
      return '长篇拆文整理'
    case 'short-analyze':
      return '短篇拆文整理'
    default:
      return '拆书动作'
  }
}

function resolveReferenceSkillPrompt(actionKey: 'long-scan' | 'short-scan' | 'long-analyze' | 'short-analyze'): string {
  const platform = currentProject.value?.targetPlatform?.trim() || '未指定'
  switch (actionKey) {
    case 'long-scan':
      return `请按照长篇网文扫榜的方式，结合当前题材、目标平台「${platform}」和已启用 skills，输出本项目此刻最值得追踪的题材风向、读者偏好、标题包装、开篇卖点和避坑结论。重点把结果写进 findings、task_plan 与 progress。`
    case 'short-scan':
      return `请按照短篇网文扫榜的方式，结合当前题材、目标平台「${platform}」和已启用 skills，输出本项目适合的情绪赛道、反转方向、平台偏好和开头钩子策略。重点把结果写进 findings、task_plan 与 progress。`
    case 'long-analyze':
      return '请按照长篇拆文的方式，综合当前已导入的参考作品与拆书资产，提炼黄金三章、节奏控制、人设骨架、爽点组织和可复用写法。重点把结果写进 findings、novel_setting 与 task_plan。'
    case 'short-analyze':
      return '请按照短篇拆文的方式，综合当前已导入的参考作品与拆书资产，提炼情绪曲线、反转布置、钩子设计和结尾余韵。重点把结果写进 findings、novel_setting 与 task_plan。'
    default:
      return '请整理当前参考阶段素材并输出适合继续创作的结论。'
  }
}

function buildReferenceSkillKnowledgeDocument(
  actionKey: 'long-scan' | 'short-scan' | 'long-analyze' | 'short-analyze',
  payload: Record<string, string>
): import('@/types/app').KnowledgeDocument | null {
  if (!currentProject.value) {
    return null
  }

  const now = new Date().toISOString()
  const title = `拆书知识库·${resolveReferenceSkillActionLabel(actionKey)}`
  const content = [payload.findings, payload.task_plan, payload.progress, payload.novel_setting]
    .filter((item) => String(item ?? '').trim())
    .join('\n\n')

  if (!content.trim()) {
    return null
  }

  return {
    id: `knowledge-reference-skill-${actionKey}-${Date.now()}`,
    projectId: currentProject.value.id,
    title,
    sourceType: 'workflow-document',
    sourceLabel: 'reference-skill',
    content,
    summary: String(payload.findings ?? payload.task_plan ?? '').trim().slice(0, 220) || title,
    keywords: [
      resolveReferenceSkillActionLabel(actionKey),
      currentProject.value.genre,
      currentProject.value.targetPlatform || ''
    ].map((item) => String(item).trim()).filter(Boolean),
    metadata: {
      sourceTitle: title,
      fileName: `reference-skill-${actionKey}.md`,
      actionKey
    },
    createdAt: now,
    updatedAt: now
  }
}

function mergeWritingStylePrompt(existingPrompt: string, incomingPrompt: string, sourceTitle: string): string {
  const nextBlock = [`【参考拆书：${sourceTitle}】`, incomingPrompt.trim()].join('\n')
  if (!existingPrompt.trim()) {
    return nextBlock
  }

  if (existingPrompt.includes(`【参考拆书：${sourceTitle}】`)) {
    return existingPrompt
  }

  return `${existingPrompt.trim()}\n\n${nextBlock}`
}

async function importReferenceNovelAnalysis(): Promise<void> {
  const project = currentProject.value
  if (!project || isImportingReferenceNovel.value) {
    return
  }

  isImportingReferenceNovel.value = true
  setReferenceProgress({
    phase: 'extracting',
    message: '准备打开文件并开始拆书分析...',
    current: 0,
    total: 1,
    percent: 2
  })
  try {
    const projectSkills = await loadEnabledProjectSkillsContext(project, 'reference')
    const result = await window.characterArc.importReferenceNovelAnalysis(JSON.parse(JSON.stringify({
      settings: appStore.appSettings,
      projectId: project.id,
      projectTitle: project.title,
      projectGenre: project.genre,
      projectPlatform: project.targetPlatform || '',
      projectSkills
    })))

    if (result.canceled) {
      setReferenceProgress(null)
      return
    }

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '参考作品拆书失败')
    }

    const nextReferenceWorks = [...(project.referenceWorks ?? []), result.result.referenceWork]
    appStore.updateProject(project.id, {
      referenceWorks: nextReferenceWorks,
      writingStylePrompt: mergeWritingStylePrompt(
        project.writingStylePrompt,
        result.result.suggestedWritingStylePrompt,
        result.result.referenceWork.title
      )
    })
    appStore.mergeKnowledgeDocuments(project.id, result.result.knowledgeDocuments)
    if (appStore.activeWorkflowVolume?.id) {
      appStore.appendWorkflowDocumentEntry(
        appStore.activeWorkflowVolume.id,
        'findings',
        `${result.result.referenceWork.title} 拆书结果`,
        result.result.findingsMarkdown
      )
    }

    setReferenceProgress({
      phase: 'done',
      message: `《${result.result.referenceWork.title}》已加入拆书知识库，风格模板、参考档案和 findings 已同步更新。`,
      current: 1,
      total: 1,
      percent: 100,
      sourceTitle: result.result.referenceWork.title
    })
    message.success(`已完成《${result.result.referenceWork.title}》拆书并归档到知识库`)
  } catch (error) {
    setReferenceProgress({
      phase: 'done',
      message: error instanceof Error ? error.message : '参考作品拆书失败',
      current: 0,
      total: 1,
      percent: 0
    })
    message.error(error instanceof Error ? error.message : '参考作品拆书失败')
  } finally {
    isImportingReferenceNovel.value = false
  }
}

async function generateReferenceInsights(): Promise<void> {
  const project = currentProject.value
  if (!project || isGeneratingReferenceInsights.value) {
    return
  }

  isGeneratingReferenceInsights.value = true
  setReferenceProgress({
    phase: 'extracting',
    message: '正在整理拆书资产与当前流程文件...',
    current: 1,
    total: 3,
    percent: 12
  })
  try {
    window.setTimeout(() => {
      if (!isGeneratingReferenceInsights.value) {
        return
      }
      setReferenceProgress({
        phase: 'aggregating',
        message: '正在提炼参考阶段共性风格、题材爆点和平台偏好...',
        current: 2,
        total: 3,
        percent: 56
      })
    }, 240)

    const result = await window.characterArc.generateAi(JSON.parse(JSON.stringify({
      task: 'workflow-documents',
      settings: appStore.appSettings,
      context: {
        projectTitle: project.title,
        projectGenre: project.genre,
        projectPlatform: project.targetPlatform || '未指定',
        projectPhase: '选题与参考',
        stageId: 'reference',
        stageLabel: '选题与参考',
        requestedDocuments: workflowStageDocumentMap.reference,
        referenceWorks: project.referenceWorks,
        workflowDocuments: appStore.workflowDocuments.map((document) => ({
          key: document.key,
          content: document.content
        })),
        projectSkills: await loadEnabledProjectSkillsContext(project, 'reference'),
        userPrompt: '请重点提炼当前参考作品的风格共性、题材爆点、平台偏好，并写成适合后续立项使用的 findings 与 task_plan。'
      }
    })))

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '参考阶段提炼失败')
    }

    const payload = result.result as Record<string, string>
    appStore.updateWorkflowDocuments(
      appStore.activeWorkflowVolume?.id ?? '',
      workflowStageDocumentMap.reference
        .map((key) => ({
          key,
          content: payload[key] ?? ''
        }))
        .filter((item) => item.content.trim())
    )
    const knowledgeDocument = buildReferenceSkillKnowledgeDocument('long-analyze', payload)
    if (knowledgeDocument) {
      appStore.mergeKnowledgeDocuments(project.id, [knowledgeDocument])
    }

    setReferenceProgress({
      phase: 'done',
      message: '参考阶段提炼已完成，结果已同步到拆书知识库。',
      current: 3,
      total: 3,
      percent: 100
    })
    message.success('已完成参考阶段提炼并同步到知识库')
  } catch (error) {
    setReferenceProgress({
      phase: 'done',
      message: error instanceof Error ? error.message : '参考阶段提炼失败',
      current: 0,
      total: 3,
      percent: 0
    })
    message.error(error instanceof Error ? error.message : '参考阶段提炼失败')
  } finally {
    isGeneratingReferenceInsights.value = false
  }
}

async function runReferenceSkillAction(actionKey: 'long-scan' | 'short-scan' | 'long-analyze' | 'short-analyze'): Promise<void> {
  const project = currentProject.value
  if (!project || activeReferenceSkillActionKey.value) {
    return
  }

  if ((actionKey === 'long-analyze' || actionKey === 'short-analyze') && !referenceAssets.value.length) {
    message.warning('请先导入参考小说并完成至少一次拆书，再执行拆文整理。')
    return
  }

  activeReferenceSkillActionKey.value = actionKey
  setReferenceProgress({
    phase: 'extracting',
    message: `正在整理${resolveReferenceSkillActionLabel(actionKey)}所需的项目上下文与已启用 skills...`,
    current: 1,
    total: 3,
    percent: 16
  })

  try {
    window.setTimeout(() => {
      if (activeReferenceSkillActionKey.value !== actionKey) {
        return
      }
      setReferenceProgress({
        phase: 'aggregating',
        message: `正在按${resolveReferenceSkillActionLabel(actionKey)}口径提炼关键信息...`,
        current: 2,
        total: 3,
        percent: 58
      })
    }, 240)

    const result = await window.characterArc.generateAi(JSON.parse(JSON.stringify({
      task: 'workflow-documents',
      settings: appStore.appSettings,
      context: {
        projectTitle: project.title,
        projectGenre: project.genre,
        projectPlatform: project.targetPlatform || '未指定',
        projectPhase: '选题与参考',
        stageId: 'reference',
        stageLabel: '选题与参考',
        requestedDocuments: workflowStageDocumentMap.reference,
        referenceWorks: project.referenceWorks,
        workflowDocuments: appStore.workflowDocuments.map((document) => ({
          key: document.key,
          content: document.content
        })),
        projectSkills: await loadEnabledProjectSkillsContext(project, 'reference'),
        userPrompt: resolveReferenceSkillPrompt(actionKey)
      }
    })))

    if (!result.success || !result.result) {
      throw new Error(result.error ?? `${resolveReferenceSkillActionLabel(actionKey)}失败`)
    }

    const payload = result.result as Record<string, string>
    appStore.updateWorkflowDocuments(
      appStore.activeWorkflowVolume?.id ?? '',
      workflowStageDocumentMap.reference
        .map((key) => ({
          key,
          content: payload[key] ?? ''
        }))
        .filter((item) => item.content.trim())
    )
    const knowledgeDocument = buildReferenceSkillKnowledgeDocument(actionKey, payload)
    if (knowledgeDocument) {
      appStore.mergeKnowledgeDocuments(project.id, [knowledgeDocument])
    }

    setReferenceProgress({
      phase: 'done',
      message: `${resolveReferenceSkillActionLabel(actionKey)}已完成，结论已加入拆书知识库。`,
      current: 3,
      total: 3,
      percent: 100
    })
    message.success(`${resolveReferenceSkillActionLabel(actionKey)}已完成`)
  } catch (error) {
    setReferenceProgress({
      phase: 'done',
      message: error instanceof Error ? error.message : `${resolveReferenceSkillActionLabel(actionKey)}失败`,
      current: 0,
      total: 3,
      percent: 0
    })
    message.error(error instanceof Error ? error.message : `${resolveReferenceSkillActionLabel(actionKey)}失败`)
  } finally {
    activeReferenceSkillActionKey.value = ''
  }
}

function openDocument(documentView: KnowledgeDocumentView): void {
  selectedDocument.value = documentView
}

function openReferenceAsset(asset: ReferenceAssetLibrary): void {
  if (asset.primaryDocument) {
    openDocument(asset.primaryDocument)
    return
  }
}

const deepAnalyzingAssetId = ref<string | null>(null)

const SOURCE_TEXT_CHAR_CAP = 30_000

function buildDeepAnalyzeSourceText(asset: ReferenceAssetLibrary): string {
  const chunks = appStore.knowledgeDocuments
    .filter((doc) => doc.sourceType === 'reference-chunk' && asset.relatedDocumentIds.includes(doc.id))
    .map((doc) => ({
      label: String(doc.metadata?.chunkLabel ?? doc.title).trim() || doc.title,
      order: Number(doc.metadata?.chunkOrder ?? Number.MAX_SAFE_INTEGER),
      text: doc.content
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
  const project = appStore.currentProject
  if (!project) {
    message.warning('请先选择一个项目再使用 AI 深度拆书。')
    return
  }
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
        projectId: project.id,
        projectTitle: project.title,
        projectGenre: project.genre,
        referenceTitle: asset.title,
        referenceFileName: asset.fileName,
        referenceGenre: asset.topKeywords.slice(0, 3).join('、'),
        sourceText
      }
    })))

    if (!response.success) {
      throw new Error(response.error ?? 'AI 深度拆书失败')
    }
    // 实际产出的 knowledge 文档由 ai-run-event → handleAiRunEvent 自动合并到 store。
    // 这里只给个用户可见的成功消息。
    message.success(`已完成《${asset.title}》深度拆书，新增的知识文档稍后会出现在列表中。`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 深度拆书失败')
  } finally {
    loading.destroy()
    deepAnalyzingAssetId.value = null
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
    .sort((left, right) => {
      if (left.document.sourceType === 'reference-summary' && right.document.sourceType !== 'reference-summary') {
        return -1
      }
      if (right.document.sourceType === 'reference-summary' && left.document.sourceType !== 'reference-summary') {
        return 1
      }
      return right.document.updatedAt.localeCompare(left.document.updatedAt)
    })
}

const progressStepPhases = ['extracting', 'chunk-analysis', 'aggregating', 'saving'] as const
const progressStepLabels = ['读取/切分', '逐块分析', '汇总结论', '归档资产']

const progressCurrentStep = computed(() => {
  const phase = referenceImportProgress.value?.phase
  if (!phase) return 0
  const index = progressStepPhases.indexOf(phase as typeof progressStepPhases[number])
  if (phase === 'chunking') return 1
  if (phase === 'done') return 5
  return index >= 0 ? index + 1 : 0
})
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
        <n-button secondary :disabled="isReferenceOperationActive" @click="importReferenceNovelAnalysis">
          {{ isImportingReferenceNovel ? '拆书中...' : '导入小说并拆书' }}
        </n-button>
        <n-button type="primary" :disabled="isReferenceOperationActive" @click="generateReferenceInsights">
          {{ isGeneratingReferenceInsights ? '提炼中...' : 'AI提炼参考结论' }}
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


    <!-- Progress Modal -->
    <n-modal v-model:show="progressModalVisible">
      <n-card style="width: min(520px, 92vw)" :bordered="false" title="拆书处理中" role="dialog" aria-modal="true">
        <div class="progress-body">
          <div class="progress-top">
            <strong>{{ referenceImportProgress?.sourceTitle ? `正在处理《${referenceImportProgress.sourceTitle}》` : '等待开始' }}</strong>
            <n-tag size="small" type="primary" :bordered="false">{{ referenceImportProgress?.percent ?? 0 }}%</n-tag>
          </div>
          <n-progress type="line" :percentage="referenceImportProgress?.percent ?? 0" :show-indicator="false" />
          <p class="progress-message">{{ referenceImportProgress?.message || '导入后会依次完成：读取正文、切分分块、逐块分析、汇总结论、归档到知识库。' }}</p>
          <n-steps :current="progressCurrentStep" size="small">
            <n-step v-for="(label, index) in progressStepLabels" :key="index" :title="label" />
          </n-steps>
        </div>
      </n-card>
    </n-modal>

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
          <n-tag v-if="selectedDocument" type="info" :bordered="false">{{ selectedDocument.sourceTypeLabel }}</n-tag>
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

          <n-scrollbar style="max-height: 56vh">
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

.progress-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.progress-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.progress-top strong {
  font-size: 14px;
  color: var(--arc-text-primary);
}

.progress-message {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
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
