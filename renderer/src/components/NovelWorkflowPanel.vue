<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowRight, BookOpenText, Compass, FileText, GitBranch, LibraryBig, Save, Sparkles, ScrollText, Users2 } from 'lucide-vue-next'
import { NButton, NInput, useMessage } from 'naive-ui'
import { workflowStageDocumentMap } from '@/features/novelWorkflow/documents'
import { formatVolumeLabel } from '@/features/workspace/outlineVolumes'
import { loadEnabledProjectSkillsContext } from '@/features/projectSkills/context'
import { novelWorkflowStageDefinitions } from '@/features/novelWorkflow/stages'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { NovelWorkflowStageId, PanelName, WorkflowDocumentKey } from '@/types/app'

const appStore = useAppStore()
const message = useMessage()
const activeStageId = ref<NovelWorkflowStageId>(novelWorkflowStageDefinitions[0].id)
const activeDocumentKey = ref<WorkflowDocumentKey>('task_plan')
const draftContent = ref('')
const isGeneratingWorkflowDocuments = ref(false)
const isScanningProjectSkills = ref(false)
const isGeneratingReferenceInsights = ref(false)
const isGeneratingPremiseInsights = ref(false)
const isGeneratingSettingInsights = ref(false)
const isImportingReferenceNovel = ref(false)
const referenceImportProgress = ref<CharacterArcReferenceImportProgressPayload | null>(null)
const projectSkillItems = ref<Array<import('@/types/app').ProjectSkillItem>>([])
const premiseDraft = ref('')
const settingDraft = ref('')

const currentProject = computed(() => appStore.currentProject)
const outlineVolumes = computed(() => appStore.outlineVolumes)
const activeWorkflowVolumeId = computed(() => appStore.activeWorkflowVolumeId)
const activeWorkflowVolume = computed(() => appStore.activeWorkflowVolume)
const workflowStageStates = computed(() => currentProject.value?.novelWorkflowStages ?? [])
const referenceWorks = computed(() => currentProject.value?.referenceWorks ?? [])
const latestAnalyzedReference = computed(() =>
  [...referenceWorks.value].reverse().find((work) => work.analysis)
)
const analyzedReferenceCount = computed(() => referenceWorks.value.filter((work) => work.analysis).length)
const totalReferenceStyleRules = computed(() =>
  referenceWorks.value.reduce((count, work) => count + (work.analysis?.styleRules.length ?? 0), 0)
)
const referenceFindingsDocument = computed(() =>
  workflowDocuments.value.find((document) => document.key === 'findings')
)
const hasReferenceFindingsContent = computed(() =>
  Boolean(referenceFindingsDocument.value?.content.trim() && !/待 AI 生成|待补充/.test(referenceFindingsDocument.value.content))
)
const isReferenceOperationActive = computed(() => isImportingReferenceNovel.value || isGeneratingReferenceInsights.value)
const workflowStages = computed(() =>
  novelWorkflowStageDefinitions.map((definition) => ({
    ...definition,
    state: workflowStageStates.value.find((item) => item.id === definition.id)?.status ?? 'todo'
  }))
)
const activeStage = computed(
  () => workflowStages.value.find((stage) => stage.id === activeStageId.value) ?? workflowStages.value[0]
)
const workflowDocuments = computed(() => appStore.workflowDocuments)
const resolvedProjectSkills = computed(() => {
  const stateMap = new Map((currentProject.value?.projectSkills ?? []).map((skill) => [skill.id, skill]))
  return projectSkillItems.value.map((skill) => ({
    ...skill,
    enabled: stateMap.get(skill.id)?.enabled ?? skill.enabled,
    stageIds: stateMap.get(skill.id)?.stageIds ?? skill.stageIds
  }))
})
const activeDocument = computed(
  () => workflowDocuments.value.find((document) => document.key === activeDocumentKey.value) ?? workflowDocuments.value[0]
)

const stageDocuments = computed(() =>
  (workflowStageDocumentMap[activeStage.value.id] ?? []).map((key) => workflowDocuments.value.find((document) => document.key === key)).filter(Boolean)
)

function syncDraftContentFromActiveDocument(): void {
  draftContent.value = activeDocument.value?.content ?? ''
}

watch(
  activeDocument,
  () => {
    syncDraftContentFromActiveDocument()
  },
  { immediate: true }
)

// 分卷切换时同步文档内容
watch(
  () => activeWorkflowVolumeId.value,
  () => {
    const firstDocKey = workflowStageDocumentMap[activeStage.value.id]?.[0]
    if (firstDocKey) {
      activeDocumentKey.value = firstDocKey
    }
    syncDraftContentFromActiveDocument()
  }
)

if (currentProject.value) {
  premiseDraft.value = currentProject.value.writingStylePrompt
}

const cleanupReferenceImportProgress = window.characterArc.onReferenceImportProgress((payload) => {
  referenceImportProgress.value = payload
})

onBeforeUnmount(() => {
  cleanupReferenceImportProgress()
})

function selectVolume(volumeId: string): void {
  appStore.setActiveWorkflowVolumeId(volumeId)
}

void scanProjectSkills()

function openPanel(panel: PanelName): void {
  if (panel === 'chapters') {
    appStore.openChapterStudio()
    return
  }
  appStore.setPanel(panel)
}

function setStage(stageId: NovelWorkflowStageId): void {
  activeStageId.value = stageId
  const firstDocument = workflowStageDocumentMap[stageId]?.[0]
  if (firstDocument) {
    activeDocumentKey.value = firstDocument
    syncDraftContentFromActiveDocument()
  }
}

function setDocument(key: WorkflowDocumentKey): void {
  activeDocumentKey.value = key
  syncDraftContentFromActiveDocument()
}

function saveDocument(): void {
  if (!activeDocument.value || !activeWorkflowVolume.value) {
    return
  }

  appStore.updateWorkflowDocument(activeWorkflowVolume.value.id, activeDocument.value.key, draftContent.value)
  message.success(`${activeDocument.value.title} 已更新`)
}

function openReferenceFindings(): void {
  setDocument('findings')
}

function resolveReferenceImportPhaseLabel(phase?: CharacterArcReferenceImportProgressPayload['phase']): string {
  switch (phase) {
    case 'extracting':
      return '读取正文'
    case 'chunking':
      return '切分分块'
    case 'chunk-analysis':
      return '逐块分析'
    case 'aggregating':
      return '汇总结论'
    case 'saving':
      return '回填项目'
    case 'done':
      return '已完成'
    default:
      return '等待开始'
  }
}

function setReferenceProgress(payload: CharacterArcReferenceImportProgressPayload | null): void {
  referenceImportProgress.value = payload
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
  if (!currentProject.value || isImportingReferenceNovel.value) {
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
    const result = await window.characterArc.importReferenceNovelAnalysis(toIpcPayload({
      settings: appStore.appSettings,
      projectTitle: currentProject.value.title,
      projectGenre: currentProject.value.genre,
      projectPlatform: currentProject.value.targetPlatform || ''
    }))

    if (result.canceled) {
      setReferenceProgress(null)
      return
    }

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '参考作品拆书失败')
    }

    const nextReferenceWorks = [...referenceWorks.value, result.result.referenceWork]
    appStore.updateProject(currentProject.value.id, {
      referenceWorks: nextReferenceWorks,
      writingStylePrompt: mergeWritingStylePrompt(
        currentProject.value.writingStylePrompt,
        result.result.suggestedWritingStylePrompt,
        result.result.referenceWork.title
      )
    })

    if (activeWorkflowVolume.value?.id) {
      appStore.appendWorkflowDocumentEntry(
        activeWorkflowVolume.value.id,
        'findings',
        `${result.result.referenceWork.title} 拆书结果`,
        result.result.findingsMarkdown
      )
      syncDraftContentFromActiveDocument()
    }

    setReferenceProgress({
      phase: 'done',
      message: `《${result.result.referenceWork.title}》拆书完成，风格模板、参考档案和 findings 已更新。`,
      current: 1,
      total: 1,
      percent: 100,
      sourceTitle: result.result.referenceWork.title
    })
    message.success(`已完成《${result.result.referenceWork.title}》拆书并回填风格规则`)
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
  if (!currentProject.value || isGeneratingReferenceInsights.value) {
    return
  }

  isGeneratingReferenceInsights.value = true
  setReferenceProgress({
    phase: 'extracting',
    message: '正在整理参考作品、拆书结果和当前流程文件...',
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

    const result = await window.characterArc.generateAi(toIpcPayload({
      task: 'workflow-documents',
      settings: appStore.appSettings,
      context: {
        projectTitle: currentProject.value.title,
        projectGenre: currentProject.value.genre,
        projectPlatform: currentProject.value.targetPlatform || '未指定',
        projectPhase: '选题与参考',
        stageId: 'reference',
        stageLabel: '选题与参考',
        requestedDocuments: workflowStageDocumentMap.reference,
        referenceWorks: currentProject.value.referenceWorks,
        workflowDocuments: appStore.workflowDocuments.map((document) => ({
          key: document.key,
          content: document.content
        })),
        projectSkills: await loadEnabledProjectSkillsContext(currentProject.value, 'reference'),
        userPrompt: '请重点提炼当前参考作品的风格共性、题材爆点、平台偏好，并写成适合后续立项使用的 findings 与 task_plan。'
      }
    }))

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '参考阶段提炼失败')
    }

    const payload = result.result as Record<string, string>
    setReferenceProgress({
      phase: 'saving',
      message: '正在把提炼结果写回参考阶段流程文件...',
      current: 3,
      total: 3,
      percent: 88
    })
    appStore.updateWorkflowDocuments(
      activeWorkflowVolume.value?.id ?? '',
      workflowStageDocumentMap.reference
        .map((key) => ({
          key,
          content: payload[key] ?? ''
        }))
        .filter((item) => item.content.trim())
    )
    syncDraftContentFromActiveDocument()
    setReferenceProgress({
      phase: 'done',
      message: '参考阶段文件已更新，后续立项会直接读取这些阶段结论。',
      current: 3,
      total: 3,
      percent: 100
    })
    message.success('已生成参考阶段流程文件')
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

async function generatePremiseInsights(): Promise<void> {
  if (!currentProject.value || isGeneratingPremiseInsights.value) {
    return
  }

  isGeneratingPremiseInsights.value = true
  try {
    const result = await window.characterArc.generateAi(toIpcPayload({
      task: 'workflow-documents',
      settings: appStore.appSettings,
      context: {
        projectTitle: currentProject.value.title,
        projectGenre: currentProject.value.genre,
        projectPlatform: currentProject.value.targetPlatform || '未指定',
        projectPhase: '故事立项',
        stageId: 'premise',
        stageLabel: '故事立项',
        requestedDocuments: workflowStageDocumentMap.premise,
        referenceWorks: currentProject.value.referenceWorks,
        worldviewTitles: appStore.worldviewEntries.map((entry) => entry.title),
        workflowDocuments: appStore.workflowDocuments.map((document) => ({
          key: document.key,
          content: document.content
        })),
        projectSkills: await loadEnabledProjectSkillsContext(currentProject.value, 'premise'),
        userPrompt:
          premiseDraft.value.trim() ||
          '请生成适合当前小说项目的故事背景、主角路线、外挂或金手指方向，并写入 current_status 与 novel_setting。'
      }
    }))

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '故事立项生成失败')
    }

    const payload = result.result as Record<string, string>
    appStore.updateWorkflowDocuments(
      activeWorkflowVolume.value?.id ?? '',
      workflowStageDocumentMap.premise
        .map((key) => ({
          key,
          content: payload[key] ?? ''
        }))
        .filter((item) => item.content.trim())
    )
    syncDraftContentFromActiveDocument()
    message.success('已生成故事立项阶段流程文件')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '故事立项生成失败')
  } finally {
    isGeneratingPremiseInsights.value = false
  }
}

async function generateSettingInsights(): Promise<void> {
  if (!currentProject.value || isGeneratingSettingInsights.value) {
    return
  }

  isGeneratingSettingInsights.value = true
  try {
    const result = await window.characterArc.generateAi(toIpcPayload({
      task: 'workflow-documents',
      settings: appStore.appSettings,
      context: {
        projectTitle: currentProject.value.title,
        projectGenre: currentProject.value.genre,
        projectPlatform: currentProject.value.targetPlatform || '未指定',
        projectPhase: '设定搭建',
        stageId: 'setting',
        stageLabel: '设定搭建',
        requestedDocuments: workflowStageDocumentMap.setting,
        referenceWorks: currentProject.value.referenceWorks,
        workflowDocuments: appStore.workflowDocuments.map((document) => ({
          key: document.key,
          content: document.content
        })),
        characters: appStore.characters.map((character) => ({
          name: character.name,
          role: character.role,
          description: character.description
        })),
        characterRelationships: appStore.characterRelationships.map((relationship) => ({
          type: relationship.type,
          description: relationship.description,
          intensity: relationship.intensity
        })),
        organizations: appStore.organizations.map((organization) => ({
          name: organization.name,
          type: organization.type,
          description: organization.description
        })),
        projectSkills: await loadEnabledProjectSkillsContext(currentProject.value, 'setting'),
        userPrompt:
          settingDraft.value.trim() ||
          '请生成当前小说项目的势力框架、关键角色骨架、关系盘初稿，并写入 novel_setting、character_relationships 与 findings。'
      }
    }))

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '设定搭建生成失败')
    }

    const payload = result.result as Record<string, string>
    appStore.updateWorkflowDocuments(
      activeWorkflowVolume.value?.id ?? '',
      workflowStageDocumentMap.setting
        .map((key) => ({
          key,
          content: payload[key] ?? ''
        }))
        .filter((item) => item.content.trim())
    )
    syncDraftContentFromActiveDocument()
    message.success('已生成设定搭建阶段流程文件')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '设定搭建生成失败')
  } finally {
    isGeneratingSettingInsights.value = false
  }
}

async function generateWorkflowDocuments(): Promise<void> {
  if (!currentProject.value || isGeneratingWorkflowDocuments.value) {
    return
  }

  isGeneratingWorkflowDocuments.value = true

  try {
    const result = await window.characterArc.generateAi(toIpcPayload({
      task: 'workflow-documents',
      settings: appStore.appSettings,
      context: {
        projectTitle: currentProject.value.title,
        projectGenre: currentProject.value.genre,
        projectPlatform: currentProject.value.targetPlatform || '未指定',
        projectPhase: workflowStages.value.find((stage) => stage.state === 'doing')?.title ?? '待立项',
        stageId: activeStage.value.id,
        stageLabel: activeStage.value.title,
        volumeId: activeWorkflowVolume.value?.id ?? '',
        volumeTitle: activeWorkflowVolume.value?.title ?? '',
        volumeSummary: activeWorkflowVolume.value?.summary ?? '',
        volumeWordTarget: activeWorkflowVolume.value?.wordTarget ?? '',
        requestedDocuments: workflowStageDocumentMap[activeStage.value.id] ?? [],
        workflowDocuments: appStore.workflowDocuments.map((document) => ({
          key: document.key,
          content: document.content
        })),
        worldviewTitles: appStore.worldviewEntries.map((entry) => entry.title),
        characters: appStore.characters.map((character) => ({
          name: character.name,
          role: character.role,
          description: character.description
        })),
        characterRelationships: appStore.characterRelationships.map((relationship) => ({
          type: relationship.type,
          description: relationship.description,
          intensity: relationship.intensity
        })),
        outlineItems: appStore.outlineItems.map((item) => ({
          title: item.title,
          conflict: item.conflict,
          summary: item.summary,
          status: item.status
        })),
        chapters: appStore.chapters.map((chapter) => ({
          title: chapter.title,
          summary: chapter.summary,
          status: chapter.status
        })),
        projectSkills: await loadEnabledProjectSkillsContext(currentProject.value, activeStage.value.id),
        userPrompt: '请生成适合当前项目继续创作使用的第一版流程文件。'
      }
    }))

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '流程文件生成失败')
    }

    const payload = result.result as Record<string, string>
    appStore.updateWorkflowDocuments(
      activeWorkflowVolume.value?.id ?? '',
      (workflowStageDocumentMap[activeStage.value.id] ?? [])
        .map((key) => ({
          key,
          content: payload[key] ?? ''
        }))
        .filter((item) => item.content.trim())
    )
    syncDraftContentFromActiveDocument()

    message.success('AI 已生成当前项目流程文件')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '流程文件生成失败')
  } finally {
    isGeneratingWorkflowDocuments.value = false
  }
}

async function scanProjectSkills(): Promise<void> {
  if (isScanningProjectSkills.value) {
    return
  }

  isScanningProjectSkills.value = true
  try {
    const result = await window.characterArc.scanProjectSkills()
    if (!result.success) {
      throw new Error(result.error ?? '项目技能扫描失败')
    }

    projectSkillItems.value = result.skills ?? []
    if (currentProject.value?.id) {
      appStore.updateProject(currentProject.value.id, {
        projectSkills: (result.skills ?? []).map((skill) => ({
          ...skill,
          enabled:
            currentProject.value?.projectSkills.find((item) => item.id === skill.id)?.enabled ?? skill.enabled,
          stageIds:
            currentProject.value?.projectSkills.find((item) => item.id === skill.id)?.stageIds ??
            novelWorkflowStageDefinitions.map((stage) => stage.id)
        }))
      })
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '项目技能扫描失败')
  } finally {
    isScanningProjectSkills.value = false
  }
}

function toggleProjectSkill(skillId: string): void {
  if (!currentProject.value?.id) {
    return
  }

  const nextSkills = resolvedProjectSkills.value.map((skill) =>
    skill.id === skillId
      ? {
          ...skill,
          enabled: !skill.enabled
        }
      : skill
  )

  appStore.updateProject(currentProject.value.id, {
    projectSkills: nextSkills
  })
}

function toggleProjectSkillStage(skillId: string, stageId: NovelWorkflowStageId): void {
  if (!currentProject.value?.id) {
    return
  }

  const nextSkills = resolvedProjectSkills.value.map((skill) => {
    if (skill.id !== skillId) {
      return skill
    }

    const nextStageIds = skill.stageIds.includes(stageId)
      ? skill.stageIds.filter((id) => id !== stageId)
      : [...skill.stageIds, stageId]

    return {
      ...skill,
      stageIds: nextStageIds
    }
  })

  appStore.updateProject(currentProject.value.id, {
    projectSkills: nextSkills
  })
}

function updateStageStatus(stageId: string, status: 'todo' | 'doing' | 'done'): void {
  if (!currentProject.value?.id) {
    return
  }

  const nextStages = workflowStageStates.value.map((stage) =>
    stage.id === stageId
      ? { ...stage, status }
      : status === 'doing' && stage.status === 'doing'
        ? { ...stage, status: 'todo' as const }
        : stage
  )

  appStore.updateProject(currentProject.value.id, {
    novelWorkflowStages: nextStages
  })
}

function resolveStageIcon(stageId: string) {
  switch (stageId) {
    case 'reference':
      return LibraryBig
    case 'premise':
      return Compass
    case 'setting':
      return Users2
    case 'outline':
      return GitBranch
    case 'draft':
      return ScrollText
    default:
      return BookOpenText
  }
}

function resolveStageStatusLabel(status: string): string {
  switch (status) {
    case 'doing':
      return '进行中'
    case 'done':
      return '已完成'
    default:
      return '未开始'
  }
}
</script>

<template>
  <section class="workflow-layout">
    <aside class="workflow-stage-rail">
      <div class="workflow-stage-rail-head">
        <span class="workflow-kicker">Novel Workflow</span>
        <h2>小说流程</h2>
        <div class="workflow-generate-actions">
          <n-button type="primary" round strong :disabled="isGeneratingWorkflowDocuments" @click="generateWorkflowDocuments">
            <template #icon>
              <Sparkles :size="16" />
            </template>
            {{ isGeneratingWorkflowDocuments ? '生成中...' : 'AI生成本阶段文件' }}
          </n-button>
        </div>
      </div>

      <div class="workflow-stage-list">
        <button
          v-for="stage in workflowStages"
          :key="stage.id"
          class="workflow-stage-item"
          :class="{ active: activeStage.id === stage.id }"
          @click="setStage(stage.id)"
        >
          <component :is="resolveStageIcon(stage.id)" :size="18" />
          <div class="workflow-stage-copy">
            <strong>{{ stage.title }}</strong>
            <span>{{ resolveStageStatusLabel(stage.state) }}</span>
          </div>
        </button>
      </div>
    </aside>

    <div class="workflow-main">
      <section class="workflow-stage-shell">
        <div class="workflow-stage-shell-head">
          <div>
            <span class="workflow-stage-shell-kicker">当前阶段</span>
            <h3>{{ activeStage.title }}</h3>
          </div>
          <div class="workflow-stage-status-row">
            <n-button
              size="small"
              :type="activeStage.state === 'todo' ? 'primary' : 'default'"
              :secondary="activeStage.state !== 'todo'"
              @click="updateStageStatus(activeStage.id, 'todo')"
            >未开始</n-button>
            <n-button
              size="small"
              :type="activeStage.state === 'doing' ? 'primary' : 'default'"
              :secondary="activeStage.state !== 'doing'"
              @click="updateStageStatus(activeStage.id, 'doing')"
            >进行中</n-button>
            <n-button
              size="small"
              :type="activeStage.state === 'done' ? 'primary' : 'default'"
              :secondary="activeStage.state !== 'done'"
              @click="updateStageStatus(activeStage.id, 'done')"
            >已完成</n-button>
          </div>
        </div>

        <div class="workflow-panel-actions">
          <n-button
            v-for="action in activeStage.actions"
            :key="`${activeStage.id}-${action.panel}`"
            secondary
            size="small"
            icon-placement="right"
            @click="openPanel(action.panel)"
          >
            {{ action.label }}
            <template #icon><ArrowRight :size="14" /></template>
          </n-button>
        </div>

        <div v-if="activeStage.id === 'reference'" class="reference-analysis-card">
          <div class="reference-analysis-hero">
            <div class="reference-analysis-copy">
              <span class="reference-analysis-kicker">Reference Lab</span>
              <strong>选题与参考</strong>
              <div class="reference-analysis-stats">
                <div class="reference-analysis-stat">
                  <span>已分析参考</span>
                  <strong>{{ analyzedReferenceCount }}</strong>
                </div>
                <div class="reference-analysis-stat">
                  <span>累计风格规则</span>
                  <strong>{{ totalReferenceStyleRules }}</strong>
                </div>
                <div class="reference-analysis-stat">
                  <span>阶段 findings</span>
                  <strong>{{ hasReferenceFindingsContent ? '已沉淀' : '待整理' }}</strong>
                </div>
              </div>
            </div>
            <div class="reference-analysis-command">
              <div class="reference-analysis-phase-wrap">
                <span class="reference-analysis-phase">{{ resolveReferenceImportPhaseLabel(referenceImportProgress?.phase) }}</span>
                <small>拆书和参考提炼共用这一套状态区。</small>
              </div>
              <div class="reference-analysis-actions">
                <n-button round strong secondary :disabled="isReferenceOperationActive" @click="importReferenceNovelAnalysis">
                  {{ isImportingReferenceNovel ? '拆书中...' : '导入小说并拆书' }}
                </n-button>
                <n-button type="primary" round strong :disabled="isReferenceOperationActive" @click="generateReferenceInsights">
                  {{ isGeneratingReferenceInsights ? '提炼中...' : 'AI提炼参考阶段' }}
                </n-button>
              </div>
            </div>
          </div>
          <div class="reference-progress-card" :class="{ active: Boolean(referenceImportProgress) }">
              <div class="reference-progress-meta">
                <div>
                  <span class="reference-progress-label">当前任务</span>
                  <strong>{{ referenceImportProgress?.sourceTitle ? `正在处理《${referenceImportProgress.sourceTitle}》` : '等待开始拆书分析' }}</strong>
                </div>
                <span>{{ referenceImportProgress?.percent ?? 0 }}%</span>
              </div>
              <div class="reference-progress-track">
                <div class="reference-progress-fill" :style="{ width: `${referenceImportProgress?.percent ?? 0}%` }" />
              </div>
              <p>{{ referenceImportProgress?.message || '导入后会依次完成：读取正文、切分分块、逐块分析、汇总模板、回填项目。' }}</p>
              <small v-if="referenceImportProgress && referenceImportProgress.total > 1">
                当前进度：{{ referenceImportProgress.current }} / {{ referenceImportProgress.total }}
              </small>
              <div class="reference-progress-steps">
                <span :class="{ active: ['extracting', 'chunking', 'chunk-analysis', 'aggregating', 'saving', 'done'].includes(referenceImportProgress?.phase ?? '') }">读取/切分</span>
                <span :class="{ active: ['chunk-analysis', 'aggregating', 'saving', 'done'].includes(referenceImportProgress?.phase ?? '') }">逐块分析</span>
                <span :class="{ active: ['aggregating', 'saving', 'done'].includes(referenceImportProgress?.phase ?? '') }">汇总结论</span>
                <span :class="{ active: ['saving', 'done'].includes(referenceImportProgress?.phase ?? '') }">回填项目</span>
              </div>
            </div>
          <div v-if="latestAnalyzedReference?.analysis" class="reference-analysis-footnote">
            最近一次完成拆书：<strong>{{ latestAnalyzedReference.title }}</strong>
            <span>已提炼 {{ latestAnalyzedReference.analysis.styleRules.length }} 条风格规则，并回填到项目风格约束。</span>
          </div>
          <div v-if="referenceWorks.length > 0" class="reference-assets-head">
            <div>
              <span>已沉淀资产</span>
              <strong>参考作品档案</strong>
            </div>
            <small>你已经拆过的作品会留在这里，方便回看和继续提炼。</small>
          </div>
          <div v-if="referenceWorks.length > 0" class="reference-work-list">
            <article v-for="work in referenceWorks" :key="work.id" class="reference-work-card">
              <div class="reference-work-head">
                <div>
                  <strong>{{ work.title }}</strong>
                  <p>{{ work.source }}<span v-if="work.fileName"> · {{ work.fileName }}</span></p>
                </div>
                <span v-if="work.analysis?.chapterCount" class="reference-work-badge">{{ work.analysis.chapterCount }} 段/章</span>
              </div>
              <p class="reference-work-summary">{{ work.analysis?.overview || work.notes || '已录入参考作品，等待进一步提炼。' }}</p>
              <div v-if="work.analysis?.metrics?.length" class="reference-work-metrics">
                <span v-for="metric in work.analysis.metrics.slice(0, 4)" :key="`${work.id}-${metric.label}`">
                  {{ metric.label }}：{{ metric.value }}
                </span>
              </div>
              <ul v-if="work.analysis?.styleRules?.length" class="reference-work-rules">
                <li v-for="rule in work.analysis.styleRules.slice(0, 3)" :key="`${work.id}-${rule}`">{{ rule }}</li>
              </ul>
            </article>
          </div>
        </div>

        <div v-if="activeStage.id === 'premise'" class="reference-settings-card">
          <strong>故事立项输入</strong>
          <div class="reference-form-grid single">
            <n-input
              v-model:value="premiseDraft"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 9 }"
              placeholder="在这里写你的故事点子、主角起点、外挂方向，或者你希望 AI 重点考虑的核心卖点。"
            />
          </div>
          <div class="workflow-panel-actions">
            <n-button type="primary" round strong :disabled="isGeneratingPremiseInsights" @click="generatePremiseInsights">
              {{ isGeneratingPremiseInsights ? '生成中...' : 'AI生成故事立项' }}
            </n-button>
          </div>
        </div>

        <div v-if="activeStage.id === 'setting'" class="reference-settings-card">
          <strong>设定搭建输入</strong>
          <div class="reference-form-grid single">
            <n-input
              v-model:value="settingDraft"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 9 }"
              placeholder="在这里补充你希望优先搭建的势力、角色、关系方向，或者你想强调的设定边界。"
            />
          </div>
          <div class="workflow-panel-actions">
            <n-button type="primary" round strong :disabled="isGeneratingSettingInsights" @click="generateSettingInsights">
              {{ isGeneratingSettingInsights ? '生成中...' : 'AI生成设定骨架' }}
            </n-button>
          </div>
        </div>
      </section>

      <section class="workflow-doc-shell">
        <div class="workflow-doc-shell-head">
          <div>
            <span class="workflow-stage-shell-kicker">流程文件</span>
            <h3>当前阶段文件</h3>
          </div>
        </div>

        <div v-if="outlineVolumes.length > 1" class="workflow-volume-tabs">
          <n-button
            v-for="(volume, index) in outlineVolumes"
            :key="volume.id"
            size="small"
            :type="volume.id === activeWorkflowVolumeId || (!activeWorkflowVolumeId && index === 0) ? 'primary' : 'default'"
            :secondary="!(volume.id === activeWorkflowVolumeId || (!activeWorkflowVolumeId && index === 0))"
            @click="selectVolume(volume.id)"
          >
            {{ formatVolumeLabel(volume, index, 'compact') }}
          </n-button>
        </div>

        <div class="workflow-doc-tabs">
          <n-button
            v-for="document in stageDocuments"
            :key="document?.key"
            size="small"
            :type="document?.key === activeDocument?.key ? 'primary' : 'default'"
            :secondary="document?.key !== activeDocument?.key"
            @click="document && setDocument(document.key)"
          >
            {{ document?.title }}
          </n-button>
        </div>

        <div v-if="activeDocument" class="workflow-doc-editor">
          <div class="workflow-doc-meta">
            <strong>{{ activeDocument.title }}</strong>
            <span>更新于 {{ new Date(activeDocument.updatedAt).toLocaleString('zh-CN') }}</span>
          </div>
          <n-input
            v-model:value="draftContent"
            type="textarea"
            class="workflow-doc-input"
            :autosize="{ minRows: 18, maxRows: 26 }"
          />
          <div class="workflow-doc-actions">
            <n-button type="primary" round strong @click="saveDocument">
              <template #icon>
                <Save :size="16" />
              </template>
              保存流程文件
            </n-button>
          </div>
        </div>
      </section>

      <section class="workflow-doc-shell">
        <div class="workflow-doc-shell-head">
          <div>
            <span class="workflow-stage-shell-kicker">项目 Skills</span>
            <h3>.project-skills/</h3>
          </div>
          <div class="workflow-generate-actions">
            <n-button round strong secondary :disabled="isScanningProjectSkills" @click="scanProjectSkills">
              {{ isScanningProjectSkills ? '扫描中...' : '重新扫描' }}
            </n-button>
          </div>
        </div>

        <div v-if="resolvedProjectSkills.length > 0" class="project-skill-list">
          <article v-for="skill in resolvedProjectSkills" :key="skill.id" class="project-skill-card">
            <div class="project-skill-head">
              <div>
                <strong>{{ skill.name }}</strong>
                <p>{{ skill.path }}</p>
              </div>
              <n-button
                size="small"
                :type="skill.enabled ? 'primary' : 'default'"
                :secondary="!skill.enabled"
                @click="toggleProjectSkill(skill.id)"
              >{{ skill.enabled ? '已启用' : '已停用' }}</n-button>
            </div>
            <p class="project-skill-description">{{ skill.description || '当前 skill 未提供描述。' }}</p>
            <div class="project-skill-stage-row">
              <span class="project-skill-stage-label">适用阶段</span>
              <div class="project-skill-stage-chips">
                <n-button
                  v-for="stage in workflowStages"
                  :key="`${skill.id}-${stage.id}`"
                  size="tiny"
                  :type="skill.stageIds.includes(stage.id) ? 'primary' : 'default'"
                  :secondary="!skill.stageIds.includes(stage.id)"
                  @click="toggleProjectSkillStage(skill.id, stage.id)"
                >{{ stage.title }}</n-button>
              </div>
            </div>
          </article>
        </div>
        <div v-else class="workflow-empty-state">
          <BookOpenText :size="18" />
          <strong>还没有识别到项目级 skills</strong>
          <p>把下载好的 skill 放进项目根目录的 <code>.project-skills/</code> 后，再点重新扫描。</p>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.workflow-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 18px;
  max-width: 1240px;
  margin: 0 auto;
}

.workflow-stage-rail,
.workflow-stage-shell,
.workflow-doc-shell {
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  box-shadow: 0 18px 32px rgba(15, 23, 42, 0.04);
}

.workflow-stage-rail {
  padding: 18px;
}

.workflow-stage-rail-head {
  margin-bottom: 16px;
}

.workflow-generate-actions {
  display: flex;
  margin-top: 14px;
}

.workflow-kicker,
.workflow-stage-shell-kicker {
  display: inline-flex;
  margin-bottom: 8px;
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.workflow-stage-rail-head h2,
.workflow-stage-shell-head h3,
.workflow-doc-shell-head h3 {
  margin: 0 0 8px;
  color: var(--arc-text-primary);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.workflow-stage-rail-head p,
.workflow-stage-shell-head p,
.workflow-doc-shell-head p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.75;
}

.workflow-stage-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.workflow-stage-item {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  padding: 12px;
  text-align: left;
}

.workflow-stage-item.active {
  border-color: color-mix(in srgb, var(--arc-primary) 20%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.workflow-stage-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 4px;
}

.workflow-stage-copy strong {
  color: var(--arc-text-primary);
  font-size: 14px;
}

.workflow-stage-copy span {
  color: inherit;
  font-size: 12px;
}

.workflow-main {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.workflow-stage-shell,
.workflow-doc-shell {
  padding: 18px;
}

.workflow-stage-shell-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.workflow-stage-status-row,
.workflow-panel-actions,
.workflow-doc-tabs,
.workflow-volume-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.workflow-volume-tabs {
  margin-bottom: 6px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--arc-border);
}

.reference-settings-card {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-body);
  padding: 14px 16px;
  margin-top: 12px;
  margin-bottom: 14px;
}

.reference-settings-card strong {
  display: block;
  margin-bottom: 10px;
  color: var(--arc-text-primary);
  font-size: 14px;
}

.reference-form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.reference-form-grid.single {
  grid-template-columns: 1fr;
}

.reference-analysis-card {
  position: relative;
  overflow: hidden;
  border-color: color-mix(in srgb, var(--arc-primary) 16%, var(--arc-border));
  background: var(--arc-bg-surface);
  padding: 20px;
}

.reference-analysis-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(90deg, var(--arc-glass-06) 0 1px, transparent 1px 18px);
  pointer-events: none;
}

.reference-analysis-hero,
.reference-analysis-footnote,
.reference-assets-head,
.reference-work-list {
  position: relative;
  z-index: 1;
}

.reference-analysis-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.9fr);
  gap: 16px;
  align-items: stretch;
}

.reference-analysis-copy {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.reference-analysis-kicker {
  display: inline-flex;
  align-self: flex-start;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.92);
  color: rgba(241, 245, 249, 0.98);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
  padding: 6px 10px;
  text-transform: uppercase;
}

.reference-analysis-copy strong {
  margin: 0;
  font-size: 24px;
  letter-spacing: -0.04em;
}

.reference-analysis-copy p {
  margin: 0;
  max-width: 50rem;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.82;
}

.reference-analysis-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;
}

.reference-analysis-stat {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-glass-08);
  padding: 12px;
}

.reference-analysis-stat span {
  display: block;
  color: var(--arc-text-hint);
  font-size: 11px;
  margin-bottom: 6px;
}

.reference-analysis-stat strong {
  display: block;
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 18px;
  letter-spacing: -0.03em;
}

.reference-analysis-command {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 16%, var(--arc-border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
  padding: 16px;
}

.reference-analysis-phase-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.reference-analysis-phase {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-bg-mix));
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 800;
  padding: 6px 10px;
  white-space: nowrap;
}

.reference-analysis-phase-wrap small {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.reference-analysis-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.reference-progress-card {
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-body);
  padding: 16px;
  margin-top: 14px;
}

.reference-progress-card.active {
  border-color: color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
}

.reference-progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.reference-progress-label {
  display: block;
  color: var(--arc-text-hint);
  font-size: 11px;
  margin-bottom: 6px;
}

.reference-progress-meta strong {
  margin: 0;
}

.reference-progress-meta span {
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 700;
}

.reference-progress-track {
  overflow: hidden;
  height: 8px;
  border-radius: 999px;
  background: var(--arc-border);
  margin-top: 10px;
}

.reference-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #60a5fa, #2563eb);
  transition: width 180ms ease;
}

.reference-progress-card p {
  margin: 10px 0 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.72;
}

.reference-progress-card small {
  display: block;
  margin-top: 8px;
  color: var(--arc-text-hint);
  font-size: 11px;
}

.reference-progress-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.reference-progress-steps span {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 700;
  padding: 6px 10px;
}

.reference-progress-steps span.active {
  border-color: color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface));
  color: var(--arc-primary);
}

.reference-analysis-footnote {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.7;
  padding: 0 2px;
}

.reference-assets-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  margin-top: 6px;
}

.reference-assets-head span {
  display: inline-flex;
  margin-bottom: 6px;
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.reference-assets-head strong {
  display: block;
  margin: 0;
}

.reference-assets-head small {
  max-width: 24rem;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.reference-work-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.reference-work-card {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 14px;
}

.reference-work-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.reference-work-head strong {
  display: block;
  margin-bottom: 4px;
  color: var(--arc-text-primary);
  font-size: 14px;
}

.reference-work-head p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.reference-work-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(219, 234, 254, 0.92);
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 700;
  padding: 5px 10px;
  white-space: nowrap;
}

.reference-work-summary {
  margin: 10px 0 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.72;
}

.reference-work-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  margin-top: 10px;
}

.reference-work-metrics span {
  display: inline-flex;
  border-radius: 999px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 11px;
  padding: 5px 10px;
}

.reference-work-rules {
  margin: 12px 0 0;
  padding-left: 18px;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.reference-work-rules li + li {
  margin-top: 4px;
}

.workflow-doc-shell-head {
  margin-bottom: 14px;
}

.workflow-doc-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.workflow-doc-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.workflow-doc-meta strong {
  color: var(--arc-text-primary);
  font-size: 14px;
}

.workflow-doc-meta span {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.workflow-doc-actions {
  display: flex;
  justify-content: flex-end;
}

.project-skill-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.project-skill-card {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 14px 16px;
}

.project-skill-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.project-skill-head strong {
  color: var(--arc-text-primary);
  font-size: 14px;
}

.project-skill-head p {
  margin: 4px 0 0;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.project-skill-description {
  margin: 10px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.75;
}

.workflow-empty-state {
  display: flex;
  min-height: 140px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-body);
  color: var(--arc-text-secondary);
  text-align: center;
  padding: 20px;
}

.workflow-empty-state strong {
  color: var(--arc-text-primary);
  font-size: 14px;
}

.workflow-empty-state p {
  max-width: 32rem;
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
}

@media (max-width: 980px) {
  .workflow-layout {
    grid-template-columns: 1fr;
  }

  .workflow-stage-shell-head,
  .workflow-doc-meta {
    flex-direction: column;
    align-items: flex-start;
  }

  .reference-form-grid {
    grid-template-columns: 1fr;
  }

  .reference-analysis-hero {
    grid-template-columns: 1fr;
  }

  .reference-analysis-stats,
  .reference-work-list {
    grid-template-columns: 1fr;
  }
}
</style>
