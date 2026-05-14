<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { marked } from 'marked'
import {
  Eye,
  FileText,
  Pencil,
  Save,
  Sparkles
} from 'lucide-vue-next'
import {
  NButton,
  NCard,
  NCheckbox,
  NCheckboxGroup,
  NEmpty,
  NInput,
  NModal,
  NScrollbar,
  NSelect,
  NTag,
  useMessage
} from 'naive-ui'
import { loadEnabledProjectSkillsContext } from '@/features/projectSkills/context'
import { formatVolumeLabel } from '@/features/workspace/outlineVolumes'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { WorkflowDocumentKey } from '@/types/app'

const appStore = useAppStore()
const message = useMessage()

const userPrompt = ref('')
const AI_TASK_KEY = 'workflow-documents'
// 生成流程文件是面板级任务，跨面板切换时通过全局注册表保留进度
const isGenerating = computed(() => appStore.isAiTaskRunning(AI_TASK_KEY))
const editingDocumentKey = ref<WorkflowDocumentKey | null>(null)
const editingContent = ref('')
const isEditMode = ref(false)

function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false }) as string
}

const allDocumentKeys: WorkflowDocumentKey[] = [
  'task_plan', 'findings', 'progress', 'current_status',
  'novel_setting', 'character_relationships', 'pending_hooks', 'resource_ledger'
]

const documentTitleMap: Record<WorkflowDocumentKey, string> = {
  task_plan: '创作计划',
  findings: '灵感与发现',
  progress: '写作进度',
  current_status: '项目概况',
  novel_setting: '世界与设定',
  character_relationships: '人物关系',
  pending_hooks: '伏笔悬念',
  resource_ledger: '素材清单'
}

const currentProject = computed(() => appStore.currentProject)
const outlineVolumes = computed(() => appStore.outlineVolumes)
const activeWorkflowVolumeId = computed(() => appStore.activeWorkflowVolumeId)
const activeWorkflowVolume = computed(() => appStore.activeWorkflowVolume)
const workflowDocuments = computed(() => appStore.workflowDocuments)
const referenceWorks = computed(() => appStore.referenceWorks)
const selectedReferenceWorkIds = computed(() => currentProject.value?.selectedReferenceWorkIds ?? [])

const volumeOptions = computed(() =>
  outlineVolumes.value.map((volume, index) => ({
    label: formatVolumeLabel(volume, index, 'compact'),
    value: volume.id
  }))
)

const selectedVolumeId = computed({
  get: () => activeWorkflowVolumeId.value || outlineVolumes.value[0]?.id || '',
  set: (value: string) => appStore.setActiveWorkflowVolumeId(value)
})

const showEditModal = computed({
  get: () => editingDocumentKey.value !== null,
  set: (value: boolean) => {
    if (!value) editingDocumentKey.value = null
  }
})

const editingDocument = computed(() =>
  editingDocumentKey.value
    ? workflowDocuments.value.find((d) => d.key === editingDocumentKey.value)
    : null
)

function isDefaultContent(content: string): boolean {
  return content.startsWith('# ') && content.includes('待 AI 生成')
}

function updateReferenceSelection(ids: Array<string | number>): void {
  if (!currentProject.value?.id) return
  appStore.updateProject(currentProject.value.id, {
    selectedReferenceWorkIds: ids as string[]
  })
}

function openEditModal(key: WorkflowDocumentKey): void {
  const doc = workflowDocuments.value.find((d) => d.key === key)
  if (!doc) return
  editingDocumentKey.value = key
  editingContent.value = doc.content
  isEditMode.value = false
}

function saveEditingDocument(): void {
  if (!editingDocumentKey.value || !activeWorkflowVolume.value) return
  appStore.updateWorkflowDocument(
    activeWorkflowVolume.value.id,
    editingDocumentKey.value,
    editingContent.value
  )
  message.success(`${documentTitleMap[editingDocumentKey.value]} 已保存`)
  editingDocumentKey.value = null
}

function buildSelectedReferenceContext() {
  return selectedReferenceWorkIds.value.length > 0
    ? referenceWorks.value.filter((w) => selectedReferenceWorkIds.value.includes(w.id))
    : referenceWorks.value
}

function buildGenerationContext() {
  return {
    projectTitle: currentProject.value?.title ?? '',
    projectGenre: currentProject.value?.genre ?? '',
    projectPlatform: currentProject.value?.targetPlatform || '未指定',
    projectPhase: '全部阶段',
    stageId: 'reference',
    stageLabel: '全局生成',
    volumeId: activeWorkflowVolume.value?.id ?? '',
    volumeTitle: activeWorkflowVolume.value?.title ?? '',
    volumeSummary: activeWorkflowVolume.value?.summary ?? '',
    volumeWordTarget: activeWorkflowVolume.value?.wordTarget ?? '',
    requestedDocuments: allDocumentKeys,
    selectedReferenceWorks: buildSelectedReferenceContext().map((work) => ({
      id: work.id,
      title: work.title,
      source: work.source,
      notes: work.notes,
      fileName: work.fileName,
      analysis: work.analysis
    })),
    referenceSelectionMode: selectedReferenceWorkIds.value.length > 0 ? 'manual' : 'auto',
    workflowDocuments: appStore.workflowDocuments.map((d) => ({
      key: d.key,
      content: d.content
    })),
    worldviewTitles: appStore.worldviewEntries.map((e) => e.title),
    characters: appStore.characters.map((c) => ({
      name: c.name,
      role: c.role,
      description: c.description
    })),
    characterRelationships: appStore.characterRelationships.map((r) => ({
      type: r.type,
      description: r.description,
      intensity: r.intensity
    })),
    organizations: appStore.organizations.map((o) => ({
      name: o.name,
      type: o.type,
      description: o.description
    })),
    outlineItems: appStore.outlineItems.map((item) => ({
      title: item.title,
      conflict: item.conflict,
      summary: item.summary,
      status: item.status
    })),
    chapters: appStore.chapters.map((ch) => ({
      title: ch.title,
      summary: ch.summary,
      status: ch.status
    }))
  }
}

const hasReferenceInput = computed(() =>
  selectedReferenceWorkIds.value.length > 0 || referenceWorks.value.length > 0
)

const canGenerate = computed(() =>
  Boolean(currentProject.value?.id) && !isGenerating.value
    && (hasReferenceInput.value || userPrompt.value.trim())
)

const dataSources = computed(() => {
  const items: string[] = []
  const refCount = selectedReferenceWorkIds.value.length
  if (refCount > 0) items.push(`${refCount} 部参考书`)
  const wv = appStore.worldviewEntries.length
  if (wv > 0) items.push(`${wv} 条世界观`)
  const ch = appStore.characters.length
  if (ch > 0) items.push(`${ch} 个角色`)
  const rel = appStore.characterRelationships.length
  if (rel > 0) items.push(`${rel} 组关系`)
  const org = appStore.organizations.length
  if (org > 0) items.push(`${org} 个组织势力`)
  const ol = appStore.outlineItems.length
  if (ol > 0) items.push(`${ol} 条大纲`)
  const chs = appStore.chapters.length
  if (chs > 0) items.push(`${chs} 个章节`)
  if (userPrompt.value.trim()) items.push('你的补充说明')

  console.log(items)

  return items
})

async function generateAllDocuments(): Promise<void> {
  if (!currentProject.value || isGenerating.value) return

  if (!hasReferenceInput.value && !userPrompt.value.trim()) {
    message.warning('没有参考书时，请先填写补充说明，告诉 AI 你想写什么样的小说')
    return
  }

  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: AI_TASK_KEY,
        kind: 'workflow',
        label: 'AI 生成流程文件',
        description: `正在基于当前项目资料整合 ${allDocumentKeys.length} 份流程文件`,
        panel: 'workflow'
      },
      async () => {
        const projectSkills = await loadEnabledProjectSkillsContext(currentProject.value!)
        return window.characterArc.generateAi(toIpcPayload({
          task: 'workflow-documents',
          settings: appStore.appSettings,
          context: {
            ...buildGenerationContext(),
            projectSkills,
            userPrompt: userPrompt.value.trim()
              || '请生成全部流程文件，整合项目现有资料与参考书。'
          }
        }))
      }
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '流程文件生成失败')
    }

    const payload = result.result as Record<string, string>
    appStore.updateWorkflowDocuments(
      activeWorkflowVolume.value?.id ?? '',
      allDocumentKeys
        .map((key) => ({ key, content: payload[key] ?? '' }))
        .filter((item) => item.content.trim())
    )
    message.success('已生成全部流程文件')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '流程文件生成失败')
  }
}

watch(
  () => currentProject.value?.writingStylePrompt,
  (value) => {
    if (!userPrompt.value.trim()) {
      userPrompt.value = value ?? ''
    }
  },
  { immediate: true }
)
</script>

<template>
  <section class="workflow-page">
    <div class="workflow-header">
      <div class="workflow-header-text">
        <span class="workflow-kicker">Workflow Files</span>
        <h2>流程文件生成</h2>
        <p>基于项目资料与可选参考书，一键 AI 生成全部流程文件。</p>
      </div>
    </div>

    <n-card class="workflow-config-card" :bordered="true">
      <div class="workflow-reference-section">
        <div class="workflow-reference-header">
          <div>
            <strong>参考书选择</strong>
            <span class="workflow-hint">可选，勾选后 AI 会优先参考这些拆书结果</span>
          </div>
          <n-button
            size="small"
            secondary
            :disabled="!currentProject?.id"
            @click="appStore.openDeconstructionLibrary()"
          >
            打开拆书知识库
          </n-button>
        </div>

        <template v-if="referenceWorks.length > 0">
          <n-checkbox-group :value="selectedReferenceWorkIds" @update:value="updateReferenceSelection">
            <div class="workflow-reference-list">
              <n-checkbox
                v-for="work in referenceWorks"
                :key="work.id"
                :value="work.id"
                :label="work.title"
              />
            </div>
          </n-checkbox-group>
          <p v-if="selectedReferenceWorkIds.length > 0" class="workflow-hint">
            已选 {{ selectedReferenceWorkIds.length }} 部参考书
          </p>
          <p v-else class="workflow-hint">
            未勾选时系统将结合项目现有资料与全部已沉淀信息进行判断
          </p>
        </template>
        <n-empty v-else size="small" description="还没有参考书">
          <template #extra>
            <n-button
              size="small"
              :disabled="!currentProject?.id"
              @click="appStore.openDeconstructionLibrary()"
            >
              前往拆书知识库导入
            </n-button>
          </template>
        </n-empty>
      </div>

      <div class="workflow-prompt-section">
        <strong>补充说明</strong>
        <span v-if="hasReferenceInput" class="workflow-hint">可选，帮助 AI 更准确地生成流程文件</span>
        <span v-else class="workflow-hint workflow-hint-required">没有参考书时必填，请描述你想写的小说类型、题材、风格等</span>
        <n-input
          v-model:value="userPrompt"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 6 }"
          placeholder="例如：重点补强角色关系、势力结构、分卷推进节奏..."
        />
      </div>

      <div v-if="outlineVolumes.length > 1" class="workflow-volume-section">
        <strong>目标卷</strong>
        <n-select
          v-model:value="selectedVolumeId"
          :options="volumeOptions"
          size="small"
          style="max-width: 240px;"
        />
      </div>

      <div class="workflow-datasource-summary">
        <template v-if="dataSources.length > 0">
          <span class="workflow-datasource-label">AI 将参考：</span>
          <n-tag v-for="item in dataSources" :key="item" size="small" :bordered="false" round>{{ item }}</n-tag>
        </template>
        <span v-else class="workflow-datasource-empty">当前项目暂无可用资料，请先填写补充说明或导入参考书</span>
      </div>

      <div class="workflow-generate-row">
        <n-button
          type="primary"
          size="large"
          round
          strong
          :loading="isGenerating"
          :disabled="!canGenerate"
          @click="generateAllDocuments"
        >
          <template #icon>
            <Sparkles :size="18" />
          </template>
          {{ isGenerating ? '正在生成中...' : '一键 AI 生成全部流程文件' }}
        </n-button>
      </div>
    </n-card>

    <div class="workflow-documents-header">
      <FileText :size="18" />
      <strong>流程文件</strong>
      <n-tag v-if="outlineVolumes.length > 1" size="small" :bordered="false">
        {{ activeWorkflowVolume?.title || '默认卷' }}
      </n-tag>
    </div>

    <div class="workflow-card-grid">
      <n-card
        v-for="doc in workflowDocuments"
        :key="doc.key"
        class="workflow-doc-card"
        :class="{ 'is-placeholder': isDefaultContent(doc.content) }"
        hoverable
        @click="openEditModal(doc.key)"
      >
        <template #header>
          <span class="doc-card-title">{{ documentTitleMap[doc.key] || doc.title }}</span>
        </template>
        <template #header-extra>
          <n-tag
            v-if="isDefaultContent(doc.content)"
            size="small"
            type="default"
            :bordered="false"
          >
            待生成
          </n-tag>
          <n-tag
            v-else
            size="small"
            type="success"
            :bordered="false"
          >
            已生成
          </n-tag>
        </template>
        <div class="doc-card-preview workflow-md" v-html="renderMarkdown(doc.content)" />
        <template #footer>
          <span class="doc-card-time">更新于 {{ new Date(doc.updatedAt).toLocaleString('zh-CN') }}</span>
        </template>
      </n-card>
    </div>

    <n-modal
      v-model:show="showEditModal"
      preset="card"
      :title="editingDocumentKey ? documentTitleMap[editingDocumentKey] : ''"
      style="width: 720px; max-width: 90vw;"
      :mask-closable="true"
    >
      <template #header-extra>
        <n-button
          size="small"
          quaternary
          @click="isEditMode = !isEditMode"
        >
          <template #icon>
            <Pencil v-if="!isEditMode" :size="14" />
            <Eye v-else :size="14" />
          </template>
          {{ isEditMode ? '预览' : '编辑' }}
        </n-button>
      </template>
      <n-scrollbar style="max-height: 60vh;">
        <div v-if="!isEditMode" class="workflow-md modal-preview" v-html="renderMarkdown(editingContent)" />
        <n-input
          v-else
          v-model:value="editingContent"
          type="textarea"
          :autosize="{ minRows: 16, maxRows: 32 }"
          placeholder="输入文件内容..."
        />
      </n-scrollbar>
      <template #footer>
        <div class="modal-footer">
          <span v-if="editingDocument" class="doc-card-time">
            更新于 {{ new Date(editingDocument.updatedAt).toLocaleString('zh-CN') }}
          </span>
          <n-button type="primary" round strong @click="saveEditingDocument">
            <template #icon>
              <Save :size="16" />
            </template>
            保存
          </n-button>
        </div>
      </template>
    </n-modal>
  </section>
</template>

<style scoped>
.workflow-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 880px;
  margin: 0 auto;
  width: 100%;
}

.workflow-header-text h2 {
  margin: 0 0 6px;
  color: var(--arc-text-primary);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.workflow-header-text p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.75;
}

.workflow-kicker {
  display: inline-flex;
  margin-bottom: 8px;
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.workflow-config-card :deep(.n-card__content) {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.workflow-reference-section,
.workflow-prompt-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.workflow-reference-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.workflow-reference-header strong,
.workflow-prompt-section strong,
.workflow-volume-section strong {
  color: var(--arc-text-primary);
  font-size: 14px;
}

.workflow-hint {
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.6;
  margin: 0;
}

.workflow-hint-required {
  color: var(--arc-primary);
  font-weight: 500;
}

.workflow-reference-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
}

.workflow-volume-section {
  display: flex;
  align-items: center;
  gap: 12px;
}

.workflow-generate-row {
  display: flex;
  justify-content: center;
  padding-top: 4px;
}

.workflow-datasource-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--arc-bg-body);
  font-size: 12px;
}

.workflow-datasource-label {
  color: var(--arc-text-secondary);
  font-weight: 500;
  white-space: nowrap;
}

.workflow-datasource-empty {
  color: var(--arc-text-hint);
}

.workflow-documents-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-primary);
  font-size: 15px;
}

.workflow-documents-header strong {
  font-weight: 600;
}

.workflow-card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}

.workflow-doc-card {
  cursor: pointer;
  transition: border-color 0.2s;
}

.workflow-doc-card.is-placeholder {
  opacity: 0.7;
}

.workflow-doc-card.is-placeholder:hover {
  opacity: 1;
}

.doc-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.doc-card-preview {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.7;
  max-height: 4.2em;
  overflow: hidden;
}

.workflow-md :deep(:is(h1, h2, h3, h4)) {
  margin: 0 0 6px;
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}

.workflow-md :deep(p) {
  margin: 0 0 6px;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.72;
}

.workflow-md :deep(:is(ul, ol)) {
  margin: 0 0 6px;
  padding-left: 18px;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.72;
}

.workflow-md :deep(li + li) {
  margin-top: 2px;
}

.workflow-md :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--arc-bg-mix);
  font-size: 12px;
}

.workflow-md :deep(blockquote) {
  margin: 0 0 6px;
  padding-left: 12px;
  border-left: 3px solid var(--arc-border);
  color: var(--arc-text-hint);
  font-size: 13px;
}

.workflow-md :deep(hr) {
  border: none;
  border-top: 1px solid var(--arc-border);
  margin: 10px 0;
}

.modal-preview {
  padding: 4px 0;
}

.modal-preview :deep(:is(h1, h2, h3, h4)) {
  font-size: 16px;
  margin: 8px 0;
}

.modal-preview :deep(:is(p, ul, ol)) {
  font-size: 14px;
}

.doc-card-time {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

@media (max-width: 640px) {
  .workflow-card-grid {
    grid-template-columns: 1fr;
  }

  .workflow-reference-header {
    flex-direction: column;
  }
}
</style>
