<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { CircleHelp } from 'lucide-vue-next'
import { NButton, NCheckbox, NCheckboxGroup, NInputNumber, NInput, NModal, NSelect, NSwitch, NTooltip } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { parseChapterWordTarget } from '@/features/chapters/wordTarget'
import type { NovelWorkflowStageId, ProjectSkillItem } from '@/types/app'
import {
  createDefaultFirstDraftSteps,
  FIRST_DRAFT_STEP_DEFINITIONS,
  type FirstDraftConfig,
  type FirstDraftFailurePolicy,
  type FirstDraftSkillMode,
  type FirstDraftStepConfig,
  type FirstDraftStepId
} from './useChapterFirstDraft'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'confirm', config: FirstDraftConfig): void
  (e: 'cancel'): void
}>()

const appStore = useAppStore()

const chapter = computed(() => appStore.selectedChapter)
const project = computed(() => appStore.currentProject)

const targetWordCount = ref(3000)
const selectedRefIds = ref<string[]>([])
const userPrompt = ref('')
const expandedStepId = ref<FirstDraftStepId | null>('draft')
const steps = reactive<Record<FirstDraftStepId, FirstDraftStepConfig>>(createDefaultFirstDraftSteps())

const referenceWorks = computed(() => appStore.referenceWorks)
const projectSkills = computed(() => project.value?.projectSkills ?? [])
const selectableProjectSkills = computed(() =>
  projectSkills.value.filter((skill) =>
    skill.category !== 'tool'
    && skill.category !== 'cover'
    && skill.compatibility !== 'external-only'
  )
)

const skillCategoryLabels = {
  market: '通用',
  analysis: '分析',
  writing: '写作',
  polish: '润色',
  cover: '封面',
  tool: '工具'
} as const

const skillCategoryUsage: Record<NonNullable<ProjectSkillItem['category']>, string> = {
  market: '用于扫榜、市场趋势、题材卖点和读者期待分析。',
  analysis: '用于拆解参考作品、章节结构、节奏和叙事手法。',
  writing: '用于正文起草，影响情节推进、角色表达和场景写法。',
  polish: '用于润色、改写、去 AI 味和统一文风。',
  cover: '用于封面方向、视觉关键词和图片提示词。',
  tool: '用于调用外部工具或补充专门处理能力。'
}
const defaultSkillUsage = '用于补充当前步骤的专门提示词和写作约束。'

const workflowStageLabels: Record<NovelWorkflowStageId, string> = {
  reference: '拆书',
  premise: '立意',
  setting: '设定',
  outline: '大纲',
  draft: '初稿'
}

function getSkillCategoryLabel(skill: ProjectSkillItem): string {
  return skill.category ? skillCategoryLabels[skill.category] : '通用'
}

function getSkillSourceLabel(skill: ProjectSkillItem): string {
  return skill.scope === 'project' ? '导入' : '内置'
}

function getSkillUsageText(skill: ProjectSkillItem): string {
  const description = skill.description?.trim()
  const fallback = skill.category ? skillCategoryUsage[skill.category] : defaultSkillUsage
  const stages = skill.stageIds
    .map((stageId) => workflowStageLabels[stageId])
    .filter(Boolean)
    .join('、')
  const stageText = stages ? `适用：${stages}。` : ''
  return [description || fallback, stageText].filter(Boolean).join(' ')
}

const skillById = computed(() => new Map(projectSkills.value.map((skill) => [skill.id, skill])))

const skillModeOptions: Array<{ label: string; value: FirstDraftSkillMode }> = [
  { label: '自动选择', value: 'auto' },
  { label: '手动指定', value: 'manual' }
]

const activeStep = computed(() =>
  FIRST_DRAFT_STEP_DEFINITIONS.find((step) => step.id === expandedStepId.value) ?? FIRST_DRAFT_STEP_DEFINITIONS[1]
)

function getSkillModeText(stepId: FirstDraftStepId): string {
  const step = steps[stepId]
  if (step.skillMode === 'auto') return '自动选择技巧'
  if (step.skillIds.length === 0) return '手动：不使用技巧'
  return `手动：${step.skillIds.length} 个技巧`
}

function getSkillModeHint(stepId: FirstDraftStepId): string {
  return steps[stepId].skillMode === 'auto'
    ? '默认由系统按当前步骤和上下文自动匹配提示词技巧。'
    : '只使用你勾选的提示词技巧；不选择则本步骤不使用提示词技巧。'
}

function getSelectedSkills(stepId: FirstDraftStepId): ProjectSkillItem[] {
  const selected: ProjectSkillItem[] = []
  for (const skillId of steps[stepId].skillIds) {
    const skill = skillById.value.get(skillId)
    if (skill && isSelectableSkill(skill)) selected.push(skill)
  }
  return selected
}

function isSkillSelected(stepId: FirstDraftStepId, skillId: string): boolean {
  return steps[stepId].skillIds.includes(skillId)
}

function isSelectableSkill(skill: ProjectSkillItem): boolean {
  return selectableProjectSkills.value.some((item) => item.id === skill.id)
}

function toggleStepSkill(stepId: FirstDraftStepId, skillId: string): void {
  const skill = skillById.value.get(skillId)
  if (!skill || !isSelectableSkill(skill)) return
  const current = steps[stepId].skillIds
  steps[stepId].skillIds = current.includes(skillId)
    ? current.filter((id) => id !== skillId)
    : [...current, skillId]
}

const failureOptions: Array<{ label: string; value: FirstDraftFailurePolicy }> = [
  { label: '跳过并继续', value: 'skip' },
  { label: '停止流程', value: 'stop' }
]

watch(() => props.show, (visible) => {
  if (!visible) return
  targetWordCount.value = parseChapterWordTarget(chapter.value?.wordTarget) || 3000
  selectedRefIds.value = [...(project.value?.selectedReferenceWorkIds ?? [])]
  userPrompt.value = ''
  expandedStepId.value = 'draft'
  Object.assign(steps, createDefaultFirstDraftSteps())
})

function toggleStep(stepId: FirstDraftStepId, value: boolean): void {
  const meta = FIRST_DRAFT_STEP_DEFINITIONS.find((item) => item.id === stepId)
  steps[stepId].enabled = meta?.required ? true : value
}

function toggleExpanded(stepId: FirstDraftStepId): void {
  expandedStepId.value = stepId
}

function handleConfirm(): void {
  const selectableSkillIds = new Set(selectableProjectSkills.value.map((skill) => skill.id))
  emit('confirm', {
    targetWordCount: targetWordCount.value,
    selectedReferenceWorkIds: selectedRefIds.value,
    userPrompt: userPrompt.value.trim(),
    steps: FIRST_DRAFT_STEP_DEFINITIONS.reduce((acc, item) => {
      acc[item.id] = {
        ...steps[item.id],
        id: item.id,
        enabled: item.required ? true : steps[item.id].enabled,
        skillMode: steps[item.id].skillMode,
        skillIds: steps[item.id].skillIds.filter((skillId) => selectableSkillIds.has(skillId)),
        userPrompt: steps[item.id].userPrompt.trim()
      }
      return acc
    }, {} as Record<FirstDraftStepId, FirstDraftStepConfig>)
  })
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="生成初稿配置"
    :style="{ width: 'min(920px, 94vw)' }"
    :mask-closable="true"
    :closable="true"
    :bordered="false"
    @close="$emit('cancel')"
    @mask-click="$emit('cancel')"
  >
    <div class="config-form arc-scrollbar">
      <div class="overview-grid">
        <section class="config-section compact-panel">
          <div>
            <label class="section-label">目标字数</label>
            <p class="section-hint">正文生成会按这个目标控制篇幅。</p>
          </div>
          <n-input-number
            v-model:value="targetWordCount"
            :min="500"
            :max="10000"
            :step="500"
            size="small"
          />
        </section>

        <section class="config-section prompt-panel">
          <label class="section-label">全局补充指令（可选）</label>
          <n-input
            v-model:value="userPrompt"
            type="textarea"
            placeholder="如：这章节奏要快、多写对白、强调角色内心冲突..."
            :rows="3"
            size="small"
          />
        </section>
      </div>

      <section v-if="referenceWorks.length > 0" class="config-section reference-panel">
        <div class="section-title-row">
          <div>
            <label class="section-label">参考作品（拆书库）</label>
            <p class="section-hint">勾选的作品风格将注入初稿步骤，不勾选则不参考。</p>
          </div>
          <span class="selection-count">{{ selectedRefIds.length }} / {{ referenceWorks.length }}</span>
        </div>
        <n-checkbox-group v-model:value="selectedRefIds">
          <div class="checkbox-list">
            <n-checkbox v-for="work in referenceWorks" :key="work.id" :value="work.id" :label="work.title" />
          </div>
        </n-checkbox-group>
      </section>

      <section class="config-section workflow-section">
        <div class="section-title-row">
          <div>
            <label class="section-label">生成步骤</label>
            <p class="section-hint">每一步都可以配置提示词技巧和补充提示词；初稿步骤为必选。</p>
          </div>
        </div>

        <div class="workflow-layout">
          <div class="step-list">
            <article
              v-for="step in FIRST_DRAFT_STEP_DEFINITIONS"
              :key="step.id"
              class="step-item"
              :class="{ active: expandedStepId === step.id, disabled: !steps[step.id].enabled }"
            >
              <button type="button" class="step-main" @click="toggleExpanded(step.id)">
                <span class="step-index">{{ FIRST_DRAFT_STEP_DEFINITIONS.findIndex((item) => item.id === step.id) + 1 }}</span>
                <span class="step-copy">
                  <span class="step-label">{{ step.label }}</span>
                  <span class="step-desc">{{ step.description }}</span>
                  <span class="step-skill-status">{{ getSkillModeText(step.id) }}</span>
                </span>
              </button>
              <n-switch
                :value="steps[step.id].enabled"
                :disabled="step.required"
                size="small"
                @update:value="(value) => toggleStep(step.id, value)"
              />
            </article>
          </div>

          <section v-if="activeStep" class="step-detail">
            <div class="step-detail-head">
              <div>
                <span class="step-detail-kicker">当前步骤</span>
                <h3>{{ activeStep.label }}</h3>
                <p>{{ activeStep.description }}</p>
              </div>
              <span class="step-detail-status">{{ getSkillModeText(activeStep.id) }}</span>
            </div>

            <div class="step-config">
              <section class="field-block">
                <div class="field-block-head">
                  <label class="field-label">提示词技巧</label>
                  <n-tooltip trigger="hover">
                    <template #trigger>
                      <button type="button" class="field-help" aria-label="提示词技巧说明">
                        <CircleHelp :size="14" />
                      </button>
                    </template>
                    {{ getSkillModeHint(activeStep.id) }}
                  </n-tooltip>
                </div>
                <n-select
                  v-model:value="steps[activeStep.id].skillMode"
                  size="small"
                  :options="skillModeOptions"
                />
              </section>

              <template v-if="steps[activeStep.id].skillMode === 'manual'">
                <section class="field-block">
                  <div class="field-block-head">
                    <label class="field-label">指定skills</label>
                    <div class="field-head-actions">
                      <n-tooltip trigger="hover">
                        <template #trigger>
                          <button type="button" class="field-help" aria-label="指定skills说明">
                            <CircleHelp :size="14" />
                          </button>
                        </template>
                        工具类 skills 已隐藏；不选则本步骤不使用 skills。
                      </n-tooltip>
                      <span class="field-count">{{ getSelectedSkills(activeStep.id).length }} 个</span>
                    </div>
                  </div>
                  <div v-if="selectableProjectSkills.length > 0" class="skill-picker-list arc-scrollbar">
                    <button
                      v-for="skill in selectableProjectSkills"
                      :key="skill.id"
                      type="button"
                      class="skill-picker-card"
                      :class="{ selected: isSkillSelected(activeStep.id, skill.id), muted: !skill.enabled }"
                      @click="toggleStepSkill(activeStep.id, skill.id)"
                    >
                      <span class="skill-picker-head">
                        <strong>{{ skill.name }}</strong>
                        <span>{{ getSkillCategoryLabel(skill) }} · {{ getSkillSourceLabel(skill) }}{{ skill.enabled ? '' : ' · 未启用' }}</span>
                      </span>
                      <span class="skill-picker-desc">{{ getSkillUsageText(skill) }}</span>
                      <span class="skill-picker-mark">{{ isSkillSelected(activeStep.id, skill.id) ? '已选' : '选择' }}</span>
                    </button>
                  </div>
                  <div v-else class="skill-picker-empty">
                    当前项目还没有适合初稿流程手动指定的 skills。
                  </div>
                </section>
              </template>

              <section class="field-block">
                <div class="field-block-head">
                  <label class="field-label">补充提示词</label>
                  <n-tooltip trigger="hover">
                    <template #trigger>
                      <button type="button" class="field-help" aria-label="补充提示词说明">
                        <CircleHelp :size="14" />
                      </button>
                    </template>
                    只影响当前步骤。
                  </n-tooltip>
                </div>
                <n-input
                  v-model:value="steps[activeStep.id].userPrompt"
                  type="textarea"
                  :rows="3"
                  size="small"
                  placeholder="例如：修复时优先保留对白、去 AI 味时不要口语化过度..."
                />
              </section>

              <section class="field-block compact-field-block">
                <div class="field-block-head">
                  <label class="field-label">失败时</label>
                  <n-tooltip trigger="hover">
                    <template #trigger>
                      <button type="button" class="field-help" aria-label="失败策略说明">
                        <CircleHelp :size="14" />
                      </button>
                    </template>
                    {{ activeStep.required ? '必选步骤失败时会停止流程。' : '控制当前步骤失败后的流程行为。' }}
                  </n-tooltip>
                </div>
                <n-select
                  v-model:value="steps[activeStep.id].failurePolicy"
                  size="small"
                  :options="failureOptions"
                  :disabled="activeStep.required"
                />
              </section>
            </div>
          </section>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <n-button size="small" @click="$emit('cancel')">取消</n-button>
        <n-button type="primary" size="small" @click="handleConfirm">开始生成</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.config-form {
  display: flex;
  max-height: min(76vh, 760px);
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding: 2px 6px 2px 0;
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.overview-grid {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 12px;
}

.compact-panel,
.prompt-panel,
.reference-panel,
.workflow-section {
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.2));
  border-radius: 8px;
  background: var(--arc-bg-surface, #fff);
  padding: 12px;
}

.compact-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: space-between;
  gap: 14px;
}

.section-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.section-label {
  color: var(--arc-text-primary, #333);
  font-size: 13px;
  font-weight: 600;
}

.section-hint {
  margin: 2px 0 0;
  color: var(--arc-text-hint, #999);
  font-size: 12px;
  line-height: 1.5;
}

.selection-count {
  flex: 0 0 auto;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.22));
  border-radius: 999px;
  color: var(--arc-text-secondary, #666);
  font-size: 11px;
  line-height: 1;
  padding: 5px 8px;
}

.checkbox-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  max-height: 86px;
  overflow-y: auto;
  padding-right: 4px;
}

.workflow-layout {
  display: grid;
  grid-template-columns: minmax(240px, 0.82fr) minmax(0, 1.18fr);
  gap: 12px;
  align-items: start;
}

.step-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.step-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.25));
  border-radius: 8px;
  background: var(--arc-bg-body, rgba(248, 248, 248, 0.72));
  padding: 9px 10px;
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.step-item.active {
  border-color: color-mix(in srgb, var(--arc-primary, #6a8cff) 45%, var(--arc-border, rgba(120, 120, 120, 0.25)));
  background: color-mix(in srgb, var(--arc-primary, #6a8cff) 7%, var(--arc-bg-surface, #fff));
  box-shadow: inset 3px 0 0 var(--arc-primary, #6a8cff);
}

.step-item.disabled {
  opacity: 0.62;
}

.step-main {
  display: flex;
  align-items: flex-start;
  min-width: 0;
  gap: 10px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  text-align: left;
}

.step-index {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--arc-bg-surface, #fff);
  color: var(--arc-text-secondary, #666);
  font-size: 11px;
  font-weight: 700;
}

.step-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 4px;
}

.step-label {
  color: var(--arc-text-primary, #222);
  font-size: 13px;
  font-weight: 600;
}

.step-desc {
  overflow: hidden;
  color: var(--arc-text-secondary, #666);
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-skill-status {
  width: fit-content;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.22));
  border-radius: 999px;
  color: var(--arc-text-secondary, #666);
  font-size: 11px;
  line-height: 1;
  padding: 5px 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-detail {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.25));
  border-radius: 8px;
  background: var(--arc-bg-body, rgba(248, 248, 248, 0.72));
  padding: 12px;
}

.step-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--arc-border, rgba(120, 120, 120, 0.18));
}

.step-detail-kicker {
  color: var(--arc-text-hint, #999);
  font-size: 11px;
  font-weight: 700;
}

.step-detail-head h3 {
  margin: 2px 0 4px;
  color: var(--arc-text-primary, #222);
  font-size: 16px;
  line-height: 1.25;
}

.step-detail-head p {
  margin: 0;
  color: var(--arc-text-secondary, #666);
  font-size: 12px;
  line-height: 1.5;
}

.step-detail-status {
  flex: 0 0 auto;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary, #6a8cff) 10%, transparent);
  color: var(--arc-primary, #4f6edb);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  padding: 6px 9px;
}

.step-config {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field-block {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}

.field-block-head {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
}

.compact-field-block {
  max-width: 340px;
}

.field-label {
  color: var(--arc-text-secondary, #666);
  font-size: 12px;
  font-weight: 600;
}

.field-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.field-count {
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.22));
  border-radius: 999px;
  color: var(--arc-text-hint, #999);
  font-size: 11px;
  line-height: 1;
  padding: 4px 7px;
}

.field-help {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 0;
  background: transparent;
  color: var(--arc-text-hint, #999);
  cursor: help;
  padding: 0;
  transition: color 0.16s ease, transform 0.16s ease;
}

.field-help svg {
  display: block;
}

.field-help:hover,
.field-help:focus-visible {
  color: var(--arc-primary, #4f6edb);
  transform: translateY(-1px);
  outline: none;
}

.skill-picker-list {
  display: grid;
  max-height: 260px;
  grid-template-columns: 1fr;
  gap: 8px;
  overflow-y: auto;
  padding-right: 3px;
}

.skill-picker-card {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.22));
  border-radius: 8px;
  background: var(--arc-bg-surface, #fff);
  color: inherit;
  cursor: pointer;
  padding: 9px 58px 9px 10px;
  text-align: left;
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.skill-picker-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary, #6a8cff) 34%, var(--arc-border, rgba(120, 120, 120, 0.22)));
  background: color-mix(in srgb, var(--arc-primary, #6a8cff) 4%, var(--arc-bg-surface, #fff));
}

.skill-picker-card.selected {
  border-color: color-mix(in srgb, var(--arc-primary, #6a8cff) 58%, var(--arc-border, rgba(120, 120, 120, 0.22)));
  background: color-mix(in srgb, var(--arc-primary, #6a8cff) 8%, var(--arc-bg-surface, #fff));
  box-shadow: inset 3px 0 0 var(--arc-primary, #6a8cff);
}

.skill-picker-card.muted {
  opacity: 0.72;
}

.skill-picker-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.skill-picker-head strong {
  min-width: 0;
  overflow: hidden;
  color: var(--arc-text-primary, #222);
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-picker-head span {
  flex: 0 0 auto;
  color: var(--arc-text-hint, #999);
  font-size: 11px;
}

.skill-picker-desc {
  color: var(--arc-text-secondary, #666);
  font-size: 12px;
  line-height: 1.5;
}

.skill-picker-mark {
  position: absolute;
  top: 9px;
  right: 10px;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.2));
  border-radius: 999px;
  color: var(--arc-text-secondary, #666);
  font-size: 11px;
  line-height: 1;
  padding: 4px 7px;
}

.skill-picker-card.selected .skill-picker-mark {
  border-color: color-mix(in srgb, var(--arc-primary, #6a8cff) 36%, transparent);
  background: color-mix(in srgb, var(--arc-primary, #6a8cff) 12%, transparent);
  color: var(--arc-primary, #4f6edb);
  font-weight: 650;
}

.skill-picker-empty {
  border: 1px dashed var(--arc-border, rgba(120, 120, 120, 0.28));
  border-radius: 8px;
  color: var(--arc-text-hint, #999);
  font-size: 12px;
  padding: 14px;
  text-align: center;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 640px) {
  .overview-grid,
  .workflow-layout {
    grid-template-columns: 1fr;
  }

  .config-form {
    max-height: min(78vh, 720px);
  }

  .field-label {
    align-self: flex-start;
  }

  .field-block-head {
    align-items: center;
  }

  .compact-field-block {
    max-width: none;
  }

  .step-detail {
    position: static;
  }
}
</style>
