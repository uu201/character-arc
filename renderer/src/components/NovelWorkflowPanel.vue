<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, BookOpenText, Compass, GitBranch, LibraryBig, Save, Sparkles, ScrollText, Users2 } from 'lucide-vue-next'
import { NButton, NInput, useMessage } from 'naive-ui'
import { workflowStageDocumentMap } from '@/features/novelWorkflow/documents'
import { loadEnabledProjectSkillsContext } from '@/features/projectSkills/context'
import { novelWorkflowStageDefinitions } from '@/features/novelWorkflow/stages'
import { useAppStore } from '@/stores/app'
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
const projectSkillItems = ref<Array<import('@/types/app').ProjectSkillItem>>([])
const targetPlatformDraft = ref('')
const referenceTitleDraft = ref('')
const referenceSourceDraft = ref('')
const premiseDraft = ref('')
const settingDraft = ref('')

const currentProject = computed(() => appStore.currentProject)
const workflowStageStates = computed(() => currentProject.value?.novelWorkflowStages ?? [])
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

if (activeDocument.value) {
  draftContent.value = activeDocument.value.content
}

if (currentProject.value) {
  targetPlatformDraft.value = currentProject.value.targetPlatform
  premiseDraft.value = currentProject.value.writingStylePrompt
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
    draftContent.value = workflowDocuments.value.find((document) => document.key === firstDocument)?.content ?? ''
  }
}

function setDocument(key: WorkflowDocumentKey): void {
  activeDocumentKey.value = key
  draftContent.value = workflowDocuments.value.find((document) => document.key === key)?.content ?? ''
}

function saveDocument(): void {
  if (!activeDocument.value) {
    return
  }

  appStore.updateWorkflowDocument(activeDocument.value.key, draftContent.value)
  message.success(`${activeDocument.value.title} 已更新`)
}

function saveReferenceSettings(): void {
  if (!currentProject.value?.id) {
    return
  }

  appStore.updateProject(currentProject.value.id, {
    targetPlatform: targetPlatformDraft.value,
    referenceWorks:
      referenceTitleDraft.value.trim()
        ? [
            ...(currentProject.value.referenceWorks ?? []),
            {
              id: `ref-${Date.now()}`,
              title: referenceTitleDraft.value.trim(),
              source: referenceSourceDraft.value.trim() || '未标注来源',
              notes: ''
            }
          ]
        : currentProject.value.referenceWorks
  })

  if (referenceTitleDraft.value.trim()) {
    referenceTitleDraft.value = ''
    referenceSourceDraft.value = ''
  }

  message.success('参考阶段基础信息已更新')
}

async function generateReferenceInsights(): Promise<void> {
  if (!currentProject.value || isGeneratingReferenceInsights.value) {
    return
  }

  isGeneratingReferenceInsights.value = true
  try {
    const result = await window.characterArc.generateAi({
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
    })

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '参考阶段提炼失败')
    }

    const payload = result.result as Record<string, string>
    appStore.updateWorkflowDocuments(
      workflowStageDocumentMap.reference
        .map((key) => ({
          key,
          content: payload[key] ?? ''
        }))
        .filter((item) => item.content.trim())
    )
    message.success('已生成参考阶段流程文件')
  } catch (error) {
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
    const result = await window.characterArc.generateAi({
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
    })

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '故事立项生成失败')
    }

    const payload = result.result as Record<string, string>
    appStore.updateWorkflowDocuments(
      workflowStageDocumentMap.premise
        .map((key) => ({
          key,
          content: payload[key] ?? ''
        }))
        .filter((item) => item.content.trim())
    )
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
    const result = await window.characterArc.generateAi({
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
    })

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '设定搭建生成失败')
    }

    const payload = result.result as Record<string, string>
    appStore.updateWorkflowDocuments(
      workflowStageDocumentMap.setting
        .map((key) => ({
          key,
          content: payload[key] ?? ''
        }))
        .filter((item) => item.content.trim())
    )
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
    const result = await window.characterArc.generateAi({
      task: 'workflow-documents',
      settings: appStore.appSettings,
      context: {
        projectTitle: currentProject.value.title,
        projectGenre: currentProject.value.genre,
        projectPlatform: '未指定',
        projectPhase: workflowStages.value.find((stage) => stage.state === 'doing')?.title ?? '待立项',
        stageId: activeStage.value.id,
        stageLabel: activeStage.value.title,
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
    })

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '流程文件生成失败')
    }

    const payload = result.result as Record<string, string>
    appStore.updateWorkflowDocuments(
      (workflowStageDocumentMap[activeStage.value.id] ?? [])
        .map((key) => ({
          key,
          content: payload[key] ?? ''
        }))
        .filter((item) => item.content.trim())
    )

    if (activeDocumentKey.value) {
      draftContent.value = payload[activeDocumentKey.value] ?? draftContent.value
    }

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
        <p>这里不是说明页，而是把写小说时真正会手动维护的状态、文件和动作，固定成一个项目工作台。流程文件优先由 AI 生成，你只负责补充和修订。</p>
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
            <p>{{ activeStage.description }}</p>
          </div>
          <div class="workflow-stage-status-row">
            <button
              class="status-chip"
              :class="{ active: activeStage.state === 'todo' }"
              @click="updateStageStatus(activeStage.id, 'todo')"
            >
              未开始
            </button>
            <button
              class="status-chip"
              :class="{ active: activeStage.state === 'doing' }"
              @click="updateStageStatus(activeStage.id, 'doing')"
            >
              进行中
            </button>
            <button
              class="status-chip"
              :class="{ active: activeStage.state === 'done' }"
              @click="updateStageStatus(activeStage.id, 'done')"
            >
              已完成
            </button>
          </div>
        </div>

        <div class="workflow-focus-card">
          <strong>这一阶段真正要做的事</strong>
          <p>{{ activeStage.focus }}</p>
          <small>{{ activeStage.summary }}</small>
        </div>

        <div class="workflow-panel-actions">
          <button
            v-for="action in activeStage.actions"
            :key="`${activeStage.id}-${action.panel}`"
            class="panel-action-button"
            @click="openPanel(action.panel)"
          >
            <span>{{ action.label }}</span>
            <ArrowRight :size="14" />
          </button>
        </div>

        <div v-if="activeStage.id === 'reference'" class="workflow-focus-card reference-settings-card">
          <strong>参考阶段基础输入</strong>
          <div class="reference-form-grid">
            <n-input v-model:value="targetPlatformDraft" placeholder="目标平台，例如：番茄 / 飞卢 / 起点" />
            <n-input v-model:value="referenceTitleDraft" placeholder="参考作品标题" />
            <n-input v-model:value="referenceSourceDraft" placeholder="作品来源，例如：番茄 / 起点 / TXT" />
          </div>
          <div class="workflow-panel-actions">
            <n-button round strong secondary @click="saveReferenceSettings">保存参考信息</n-button>
            <n-button type="primary" round strong :disabled="isGeneratingReferenceInsights" @click="generateReferenceInsights">
              {{ isGeneratingReferenceInsights ? '提炼中...' : 'AI提炼参考阶段' }}
            </n-button>
          </div>
        </div>

        <div v-if="activeStage.id === 'premise'" class="workflow-focus-card reference-settings-card">
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

        <div v-if="activeStage.id === 'setting'" class="workflow-focus-card reference-settings-card">
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
            <p>这里只放固定的项目流程文件。它们是 AI 的工作记忆，不是另做一套资源系统。</p>
          </div>
        </div>

        <div class="workflow-doc-tabs">
          <button
            v-for="document in stageDocuments"
            :key="document?.key"
            class="doc-tab"
            :class="{ active: document?.key === activeDocument?.key }"
            @click="document && setDocument(document.key)"
          >
            {{ document?.title }}
          </button>
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
            <p>这里只识别当前项目目录里的 skills。它们是阶段动作的 AI 内部资源，不是全局安装，不是技能市场。</p>
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
              <button class="status-chip" :class="{ active: skill.enabled }" @click="toggleProjectSkill(skill.id)">
                {{ skill.enabled ? '已启用' : '已停用' }}
              </button>
            </div>
            <p class="project-skill-description">{{ skill.description || '当前 skill 未提供描述。' }}</p>
            <div class="project-skill-stage-row">
              <span class="project-skill-stage-label">适用阶段</span>
              <div class="project-skill-stage-chips">
                <button
                  v-for="stage in workflowStages"
                  :key="`${skill.id}-${stage.id}`"
                  class="doc-tab"
                  :class="{ active: skill.stageIds.includes(stage.id) }"
                  @click="toggleProjectSkillStage(skill.id, stage.id)"
                >
                  {{ stage.title }}
                </button>
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
  border: 1px solid rgba(226, 232, 240, 0.84);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.98);
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
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 18px;
  background: rgba(248, 250, 252, 0.94);
  color: var(--arc-text-secondary);
  cursor: pointer;
  padding: 12px;
  text-align: left;
}

.workflow-stage-item.active {
  border-color: rgba(59, 130, 246, 0.28);
  background: rgba(239, 246, 255, 0.94);
  color: #1d4ed8;
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
.workflow-doc-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.status-chip,
.panel-action-button,
.doc-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.status-chip,
.doc-tab {
  border: 1px solid rgba(226, 232, 240, 0.9);
  background: white;
  color: var(--arc-text-secondary);
  padding: 8px 10px;
}

.status-chip.active,
.doc-tab.active {
  border-color: rgba(59, 130, 246, 0.26);
  background: rgba(239, 246, 255, 0.94);
  color: #1d4ed8;
}

.panel-action-button {
  border: 1px solid rgba(226, 232, 240, 0.9);
  background: rgba(248, 250, 252, 0.96);
  color: var(--arc-text-primary);
  padding: 8px 12px;
}

.workflow-focus-card {
  border: 1px solid rgba(226, 232, 240, 0.78);
  border-radius: 20px;
  background:
    radial-gradient(circle at right top, rgba(219, 234, 254, 0.22), transparent 36%),
    rgba(248, 250, 252, 0.96);
  padding: 14px 16px;
  margin-bottom: 14px;
}

.reference-settings-card {
  margin-top: 12px;
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

.workflow-focus-card strong {
  display: block;
  margin-bottom: 6px;
  color: var(--arc-text-primary);
  font-size: 14px;
}

.workflow-focus-card p {
  margin: 0 0 6px;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.workflow-focus-card small {
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.6;
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
  border: 1px solid rgba(226, 232, 240, 0.84);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.98);
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
  border: 1px dashed rgba(203, 213, 225, 0.92);
  border-radius: 22px;
  background: rgba(248, 250, 252, 0.82);
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
}
</style>
