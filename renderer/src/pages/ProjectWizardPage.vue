<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ArrowLeft, BookA, CheckCircle2, ChevronRight, Info, Sparkles } from 'lucide-vue-next'
import { NButton, NInput, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import {
  createProjectWorkspaceSeed,
  createProjectWorkspaceSeedFromSpiral,
  type ProjectBootstrapResult,
  type SpiralBootstrapResult
} from '@/features/wizard/projectSeed'
import {
  DEFAULT_PROJECT_GENRE,
  DEFAULT_PROJECT_GENRE_KEY,
  NOVEL_LENGTH_OPTIONS,
  PROJECT_GENRE_GROUP_LABELS,
  PROJECT_GENRE_GROUPS,
  PROJECT_GENRE_OPTIONS,
  resolveNovelLengthLabel
} from '@/features/wizard/projectGenres'
import type { NovelLength } from '@/types/app'

const appStore = useAppStore()
const message = useMessage()

const step = ref(1)
const isGenerating = ref(false)

type GenerationMode = 'off' | 'quick' | 'deep'

const formData = reactive({
  title: '',
  selectedGenreKey: DEFAULT_PROJECT_GENRE_KEY,
  customGenre: '',
  novelLength: 'long' as NovelLength,
  premise: '',
  generationMode: 'deep' as GenerationMode
})

const spiralPhase = ref<'idle' | 'seed' | 'expand' | 'validate'>('idle')
const spiralPhaseLabels: Record<string, string> = {
  idle: '',
  seed: '正在提炼核心骨架（主角矛盾 + 主线方向 + 世界规则）...',
  expand: '正在展开配角、大纲节拍和补充设定...',
  validate: '正在校验一致性并修补缺口...'
}

const steps = [
  { num: 1, title: '基础设定', desc: '确定题材与作品长度' },
  { num: 2, title: '小说简介', desc: '用一句话立住故事钩子' },
  { num: 3, title: '创建方式', desc: '决定是否让 AI 先搭好骨架' }
] as const

const genreGroups = PROJECT_GENRE_GROUPS.map((groupId) => ({
  id: groupId,
  label: PROJECT_GENRE_GROUP_LABELS[groupId],
  options: PROJECT_GENRE_OPTIONS.filter((option) => option.group === groupId)
}))

const selectedGenreOption = computed(() =>
  PROJECT_GENRE_OPTIONS.find((option) => option.key === formData.selectedGenreKey)
)
const isCustomGenre = computed(() => selectedGenreOption.value?.isCustom === true)
const resolvedGenre = computed(() =>
  isCustomGenre.value ? formData.customGenre.trim() : selectedGenreOption.value?.label ?? DEFAULT_PROJECT_GENRE
)
const selectedGenreLabel = computed(() =>
  isCustomGenre.value ? resolvedGenre.value || '自定义题材' : selectedGenreOption.value?.label ?? DEFAULT_PROJECT_GENRE
)
const novelLengthLabel = computed(() => resolveNovelLengthLabel(formData.novelLength))
const currentStep = computed(() => steps[step.value - 1])
const premisePreview = computed(() => formData.premise.trim() || '还未填写故事简介')
const creationModeLabel = computed(() => {
  if (formData.generationMode === 'deep') return '深度生成'
  if (formData.generationMode === 'quick') return '快速生成'
  return '空白项目'
})
const spiralPhaseLabel = computed(() => spiralPhaseLabels[spiralPhase.value] || '')

const canContinue = computed(() => {
  if (step.value === 1) {
    return formData.title.trim().length > 0 && resolvedGenre.value.length > 0
  }
  if (step.value === 2) {
    return formData.premise.trim().length > 0
  }
  return !isGenerating.value
})

function resetWizard(): void {
  step.value = 1
  isGenerating.value = false
  spiralPhase.value = 'idle'
  formData.title = ''
  formData.selectedGenreKey = DEFAULT_PROJECT_GENRE_KEY
  formData.customGenre = ''
  formData.novelLength = 'long'
  formData.premise = ''
  formData.generationMode = 'deep'
}

function goBack(): void {
  if (step.value > 1 && !isGenerating.value) {
    step.value -= 1
    return
  }

  if (!isGenerating.value) {
    appStore.closeWizard()
  }
}

async function cancelGeneration(): Promise<void> {
  if (formData.generationMode === 'deep') {
    await window.characterArc.cancelSpiralBootstrap()
  }
}

function selectGenre(genreKey: string): void {
  formData.selectedGenreKey = genreKey
}

function activateStep(targetStep: number): void {
  if (isGenerating.value) {
    return
  }

  if (targetStep < step.value) {
    step.value = targetStep
  }
}

async function goNext(): Promise<void> {
  if (!canContinue.value || isGenerating.value) {
    return
  }

  if (step.value < 3) {
    step.value += 1
    return
  }

  isGenerating.value = true
  spiralPhase.value = 'idle'

  const wizardValues = {
    title: formData.title,
    genre: resolvedGenre.value,
    novelLength: formData.novelLength,
    premise: formData.premise,
    shouldGenerate: formData.generationMode !== 'off'
  }

  try {
    if (formData.generationMode === 'deep') {
      const cleanup = window.characterArc.onSpiralProgress((event) => {
        spiralPhase.value = event.phase
      })

      try {
        const result = await window.characterArc.spiralBootstrap(
          toIpcPayload({
            settings: appStore.appSettings,
            projectTitle: formData.title,
            projectGenre: resolvedGenre.value,
            projectNovelLength: formData.novelLength,
            projectPremise: formData.premise
          })
        )

        if (!result.success || !result.result) {
          throw new Error(result.error ?? '深度生成失败')
        }

        appStore.createProjectWorkspace(
          createProjectWorkspaceSeedFromSpiral(wizardValues, result.result)
        )
      } finally {
        cleanup()
      }
    } else if (formData.generationMode === 'quick') {
      const result = await window.characterArc.generateAi(
        toIpcPayload({
          task: 'project-bootstrap',
          settings: appStore.appSettings,
          context: {
            projectTitle: formData.title,
            projectGenre: resolvedGenre.value,
            projectNovelLength: formData.novelLength,
            projectPremise: formData.premise
          }
        })
      )

      if (!result.success || !result.result) {
        throw new Error(result.error ?? 'AI 初始化项目失败')
      }

      appStore.createProjectWorkspace(
        createProjectWorkspaceSeed(wizardValues, result.result as ProjectBootstrapResult)
      )
    } else {
      appStore.createProjectWorkspace(createProjectWorkspaceSeed(wizardValues))
    }

    resetWizard()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '创建项目失败，请稍后重试')
  } finally {
    isGenerating.value = false
    spiralPhase.value = 'idle'
  }
}
</script>

<template>
  <section class="wizard-page">
    <div class="wizard-shell">
      <nav class="wizard-sidebar" aria-label="创建步骤">
        <strong class="wizard-nav-title">新建作品</strong>
        <ol class="step-list">
          <li v-for="item in steps" :key="item.num">
            <button
              type="button"
              class="step-item"
              :class="{
                active: step === item.num,
                done: step > item.num,
                clickable: item.num < step && !isGenerating
              }"
              :disabled="item.num > step || isGenerating"
              :aria-current="step === item.num ? 'step' : undefined"
              @click="activateStep(item.num)"
            >
              <span class="step-marker">
                <CheckCircle2 v-if="step > item.num" :size="16" />
                <span v-else>{{ item.num }}</span>
              </span>
              <span class="step-text">
                <strong>{{ item.title }}</strong>
              </span>
            </button>
          </li>
        </ol>
      </nav>

      <section class="wizard-main">
        <header class="wizard-header">
          <n-button quaternary circle class="back-button" @click="goBack">
            <template #icon><ArrowLeft :size="18" /></template>
          </n-button>

          <div class="header-copy">
            <span class="header-kicker">步骤 {{ step }} / {{ steps.length }}</span>
            <h2>{{ currentStep.title }}</h2>
            <p>{{ currentStep.desc }}</p>
          </div>
        </header>

        <div class="wizard-stage arc-scrollbar">
          <Transition name="wizard-step" mode="out-in">
            <div v-if="step === 1" key="step-1" class="step-pane">
              <section class="content-card">
                <div class="section-head">
                  <h3>项目名与题材</h3>
                  <p>先定义作品最核心的识别信息，项目卡片和后续生成都会以这里为准。</p>
                </div>

                <div class="field">
                  <label>作品名称</label>
                  <n-input
                    v-model:value="formData.title"
                    placeholder="例如：星渊拾遗"
                    size="large"
                    class="wizard-naive-input"
                    :maxlength="60"
                    show-count
                    clearable
                  >
                    <template #prefix>
                      <BookA :size="18" />
                    </template>
                  </n-input>
                </div>

                <div class="field">
                  <label>作品题材</label>
                  <div class="genre-stack">
                    <section v-for="group in genreGroups" :key="group.id" class="genre-section">
                      <h4>{{ group.label }}</h4>
                      <div class="genre-grid">
                        <button
                          v-for="genre in group.options"
                          :key="genre.key"
                          type="button"
                          class="genre-chip"
                          :class="{ active: formData.selectedGenreKey === genre.key }"
                          @click="selectGenre(genre.key)"
                        >
                          {{ genre.label }}
                        </button>
                      </div>
                    </section>

                    <section class="genre-section custom-genre-section">
                      <h4>自定义题材</h4>
                      <button
                        type="button"
                        class="genre-chip custom-genre-chip"
                        :class="{ active: isCustomGenre }"
                        @click="selectGenre('custom')"
                      >
                        自定义题材
                      </button>
                      <div v-if="isCustomGenre" class="custom-genre-input-wrap">
                        <n-input
                          v-model:value="formData.customGenre"
                          placeholder="例如：废土美食 / 赛博修仙 / 民俗怪谈"
                          size="medium"
                          :maxlength="30"
                          show-count
                          clearable
                        />
                        <p class="field-hint">会直接按你填写的题材生成，题材名会被写入项目卡片。</p>
                      </div>
                    </section>
                  </div>
                </div>
              </section>

              <section class="content-card">
                <div class="section-head">
                  <h3>目标篇幅</h3>
                  <p>篇幅会影响初始大纲的展开节奏，以及工作台里默认生成的卷章结构。</p>
                </div>

                <div class="length-grid">
                  <button
                    v-for="option in NOVEL_LENGTH_OPTIONS"
                    :key="option.value"
                    type="button"
                    class="length-card"
                    :class="{ active: formData.novelLength === option.value }"
                    @click="formData.novelLength = option.value"
                  >
                    <strong>{{ option.label }}</strong>
                    <span>{{ option.description }}</span>
                  </button>
                </div>
              </section>
            </div>

            <div v-else-if="step === 2" key="step-2" class="step-pane">
              <section class="content-card premise-card">
                <div class="section-head">
                  <h3>故事钩子</h3>
                  <p>用一段清晰的简介把主角、冲突和目标立起来，让 AI 知道故事该从哪里发力。</p>
                </div>

                <div class="field grow">
                  <label class="inline-label">
                    <span>小说简介</span>
                    <Info :size="14" />
                  </label>
                  <n-input
                    v-model:value="formData.premise"
                    type="textarea"
                    placeholder="描述这个故事的主角、核心冲突、目标或最吸引人的设定。例如：一个能看见未来死亡片段的实习法医，被迫和自己即将解剖的尸体合作，追查一场还没发生的连环谋杀。"
                    :autosize="{ minRows: 10, maxRows: 16 }"
                    :maxlength="800"
                    show-count
                    class="wizard-naive-textarea"
                  />
                  <p class="field-hint">AI 会优先根据题材、长短篇和这段简介来生成开局世界观与前三章大纲。</p>
                </div>

              </section>
            </div>

            <div v-else key="step-3" class="step-pane">
              <section class="content-card review-card">
                <div class="review-state">
                  <span class="generate-icon">
                    <Sparkles :size="18" :class="{ pulse: isGenerating }" />
                  </span>

                  <div class="review-copy">
                    <h3>{{ isGenerating ? '正在创建项目工作区...' : '准备创建项目' }}</h3>
                    <p v-if="isGenerating && spiralPhaseLabel">{{ spiralPhaseLabel }}</p>
                    <p v-else-if="isGenerating">正在生成中...</p>
                    <p v-else>最后确认一次摘要和初始化方式。创建完成后会直接进入工作台。</p>
                  </div>
                </div>

                <div v-if="isGenerating && formData.generationMode === 'deep'" class="spiral-progress">
                  <div class="spiral-step" :class="{ active: spiralPhase === 'seed', done: spiralPhase === 'expand' || spiralPhase === 'validate' }">
                    <span class="spiral-dot"></span>
                    <span>核心骨架</span>
                  </div>
                  <div class="spiral-step" :class="{ active: spiralPhase === 'expand', done: spiralPhase === 'validate' }">
                    <span class="spiral-dot"></span>
                    <span>展开设计</span>
                  </div>
                  <div class="spiral-step" :class="{ active: spiralPhase === 'validate' }">
                    <span class="spiral-dot"></span>
                    <span>一致性校验</span>
                  </div>
                </div>

                <dl class="summary-grid">
                  <div>
                    <dt>项目名</dt>
                    <dd>{{ formData.title || '未命名作品' }}</dd>
                  </div>
                  <div>
                    <dt>题材</dt>
                    <dd>{{ selectedGenreLabel }}</dd>
                  </div>
                  <div>
                    <dt>篇幅</dt>
                    <dd>{{ novelLengthLabel }}</dd>
                  </div>
                  <div>
                    <dt>创建方式</dt>
                    <dd>{{ creationModeLabel }}</dd>
                  </div>
                  <div class="summary-block">
                    <dt>简介</dt>
                    <dd>{{ premisePreview }}</dd>
                  </div>
                </dl>

                <div v-if="!isGenerating" class="generation-mode-panel">
                  <div class="section-head">
                    <h3>初始化方式</h3>
                    <p>选择项目创建时的 AI 参与程度。</p>
                  </div>

                  <div class="generation-mode-grid">
                    <button
                      type="button"
                      class="mode-card"
                      :class="{ active: formData.generationMode === 'deep' }"
                      @click="formData.generationMode = 'deep'"
                    >
                      <strong>深度生成</strong>
                      <span>螺旋式推导：从角色核心矛盾出发，生成完整角色、大纲和世界设定。质量更高，耗时约 30 秒。</span>
                    </button>
                    <button
                      type="button"
                      class="mode-card"
                      :class="{ active: formData.generationMode === 'quick' }"
                      @click="formData.generationMode = 'quick'"
                    >
                      <strong>快速生成</strong>
                      <span>一次性生成世界观和大纲骨架，不含角色设计。速度快，约 10 秒。</span>
                    </button>
                    <button
                      type="button"
                      class="mode-card"
                      :class="{ active: formData.generationMode === 'off' }"
                      @click="formData.generationMode = 'off'"
                    >
                      <strong>空白项目</strong>
                      <span>只创建项目骨架与首章草稿，从零开始搭建。</span>
                    </button>
                  </div>
                </div>
              </section>

            </div>
          </Transition>
        </div>

        <footer class="wizard-footer">
          <div class="footer-actions">
            <n-button
              size="large"
              :class="isGenerating ? 'footer-cancel-btn' : 'footer-secondary-btn'"
              @click="isGenerating ? cancelGeneration() : goBack()"
            >
              {{ isGenerating ? '取消生成' : step > 1 ? '上一步' : '取消' }}
            </n-button>
            <n-button
              type="primary"
              size="large"
              :disabled="!canContinue"
              :loading="isGenerating"
              class="footer-primary-btn"
              @click="goNext"
            >
              <template v-if="step < 3" #icon>
                <ChevronRight :size="18" />
              </template>
              <template v-else-if="!isGenerating" #icon>
                <Sparkles :size="18" />
              </template>
              <template v-if="step < 3">下一步</template>
              <template v-else>
                {{ isGenerating ? '创建中...' : formData.generationMode === 'off' ? '直接创建项目' : formData.generationMode === 'deep' ? '开始深度构建' : '开始快速构建' }}
              </template>
            </n-button>
          </div>
        </footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.wizard-page {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
}

.wizard-shell {
  display: flex;
  width: 100%;
  max-width: 1040px;
  height: 100%;
  margin: 0 auto;
  flex-direction: column;
  overflow: hidden;
  background: var(--arc-bg-surface);
}

.wizard-sidebar {
  display: flex;
  min-width: 0;
  min-height: 54px;
  flex-shrink: 0;
  align-items: center;
  gap: 24px;
  padding: 8px 24px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.wizard-nav-title {
  flex-shrink: 0;
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 650;
}

.header-kicker {
  display: inline-flex;
  align-items: center;
  color: var(--arc-text-hint);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.step-list {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.step-item {
  display: inline-flex;
  width: auto;
  align-items: center;
  gap: 7px;
  border: 1px solid transparent;
  border-radius: var(--arc-radius-md);
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: default;
  padding: 6px 9px;
  text-align: left;
  transition:
    border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.step-item.clickable {
  cursor: pointer;
}

.step-item.clickable:hover {
  background: var(--arc-bg-surface-hover);
}

.step-item:disabled {
  opacity: 1;
}

.step-item.active {
  background: var(--arc-primary-soft);
}

.step-item.done:not(.active) {
  color: var(--arc-text-secondary);
}

.step-marker {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 11px;
  font-weight: 700;
}

.step-item.active .step-marker {
  border-color: color-mix(in srgb, var(--arc-primary) 25%, var(--arc-bg-mix));
  background: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.step-item.done .step-marker {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.step-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.step-text strong {
  color: var(--arc-text-primary);
  font-size: 12px;
  font-weight: 650;
}

.summary-grid dt {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.summary-grid dd {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 13px;
  line-height: 1.65;
}

.wizard-main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--arc-bg-surface);
}

.wizard-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  width: min(800px, 100%);
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  margin: 0 auto;
  padding: 22px 24px 14px;
  background: var(--arc-bg-surface);
}

.back-button {
  display: inline-flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  transition:
    border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.back-button:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 16%, var(--arc-border));
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}

.back-button:active {
  transform: scale(0.98);
}

.header-copy {
  min-width: 0;
}

.header-copy h2 {
  margin: 5px 0 0;
  color: var(--arc-text-primary);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0;
}

.header-copy p {
  margin: 5px 0 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.65;
}

.wizard-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 0 24px;
}

.step-pane {
  display: flex;
  width: min(800px, 100%);
  margin: 0 auto;
  flex-direction: column;
  gap: 0;
  padding-bottom: 28px;
}

.grow {
  flex: 1;
}

.content-card {
  border-bottom: 1px solid var(--arc-border);
  padding: 22px 0;
  background: var(--arc-bg-surface);
}

.content-card:last-child {
  border-bottom: 0;
}

.section-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 18px;
}

.section-head h3,
.review-copy h3 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 16px;
  font-weight: 650;
  letter-spacing: 0;
}

.section-head p,
.review-copy p,
.toggle-copy p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.65;
}

.field + .field {
  margin-top: 18px;
}

.field label {
  margin-bottom: 8px;
  color: var(--arc-text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.input-shell {
  position: relative;
}

.wizard-naive-input :deep(.n-input__input-el),
.wizard-naive-input :deep(.n-input__textarea-el) {
  font-size: 15px;
}

.wizard-naive-input :deep(.n-input) {
  --n-border-radius: 6px;
  --n-height: 44px;
}

.wizard-naive-textarea :deep(.n-input) {
  --n-border-radius: 6px;
}

.wizard-naive-textarea :deep(.n-input__textarea-el) {
  padding: 4px 4px 4px 0;
  font-size: 15px;
  line-height: 1.75;
}

.genre-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.genre-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.genre-section h4 {
  margin: 0 0 4px;
  color: var(--arc-text-hint);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.genre-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.genre-chip,
.length-card {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-weak);
  transition:
    border-color 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    color 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.genre-chip {
  border-radius: var(--arc-radius-md);
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  padding: 9px 8px;
  text-align: center;
}

.genre-chip:hover,
.length-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-border));
  background: var(--arc-bg-surface);
}

.length-card:active {
  transform: scale(0.985);
}

.genre-chip.active,
.length-card.active {
  border-color: color-mix(in srgb, var(--arc-primary) 22%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.custom-genre-section {
  align-items: flex-start;
}

.custom-genre-chip {
  min-width: 140px;
}

.custom-genre-input-wrap {
  width: 100%;
}

.length-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.length-card {
  display: flex;
  min-height: 76px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 5px;
  border-radius: var(--arc-radius-md);
  color: var(--arc-text-secondary);
  cursor: pointer;
  padding: 13px 14px;
  text-align: left;
}

.length-card strong {
  font-size: 15px;
}

.length-card span {
  color: inherit;
  font-size: 12px;
  line-height: 1.6;
}

.field-hint {
  margin: 8px 0 0;
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.6;
}

.toggle-panel {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-weak);
  padding: 14px 16px;
}

.toggle-copy strong {
  color: var(--arc-text-primary);
  font-size: 13px;
  font-weight: 650;
}

.review-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.review-state {
  display: flex;
  align-items: center;
  gap: 12px;
}

.generate-icon {
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: var(--arc-radius-md);
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.pulse {
  animation: pulseGlow 1.4s ease-in-out infinite;
}

.review-copy {
  min-width: 0;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 0;
  padding: 14px 0;
  border-top: 1px solid var(--arc-border);
  border-bottom: 1px solid var(--arc-border);
}

.summary-grid div {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary-block {
  grid-column: 1 / -1;
  padding-top: 4px;
}

.toggle-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
}

.toggle-copy {
  min-width: 0;
}

.bootstrap-toggle {
  color: var(--arc-text-primary);
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
}

.generation-mode-panel {
  padding-top: 2px;
}

.generation-mode-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0;
  border-top: 1px solid var(--arc-border);
}

.mode-card {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  border: 0;
  border-bottom: 1px solid var(--arc-border);
  padding: 13px 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.mode-card:hover {
  background: var(--arc-bg-surface-hover);
}

.mode-card.active {
  background: var(--arc-primary-soft);
  box-shadow: inset 2px 0 0 var(--arc-primary);
}

.mode-card strong {
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 650;
}

.mode-card span {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.spiral-progress {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 12px 0;
  border-top: 1px solid var(--arc-border);
  border-bottom: 1px solid var(--arc-border);
}

.spiral-step {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-hint);
  font-size: 13px;
  font-weight: 600;
  transition: color 0.2s;
}

.spiral-step.active {
  color: var(--arc-primary);
}

.spiral-step.done {
  color: var(--arc-text-secondary);
}

.spiral-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--arc-border);
  transition: background 0.2s;
}

.spiral-step.active .spiral-dot {
  background: var(--arc-primary);
  animation: pulseGlow 1.4s ease-in-out infinite;
}

.spiral-step.done .spiral-dot {
  background: var(--arc-primary);
  opacity: 0.6;
}

.wizard-footer {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  flex-shrink: 0;
  padding: 12px 24px 16px;
  border-top: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.footer-actions {
  display: flex;
  width: min(800px, 100%);
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-shrink: 0;
}

.footer-primary-btn,
.footer-secondary-btn,
.footer-cancel-btn {
  --n-height: 38px !important;
  min-width: 104px;
  border-radius: 6px !important;
}

.footer-cancel-btn {
  color: var(--arc-text-secondary);
}

.footer-primary-btn :deep(.n-button__content),
.footer-secondary-btn :deep(.n-button__content) {
  font-weight: 600;
}

.back-button {
  --n-width: 34px !important;
  --n-height: 34px !important;
  border: 1px solid var(--arc-border) !important;
  border-radius: 6px !important;
}

.back-button:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, var(--arc-border)) !important;
}

@media (max-width: 1120px) {
  .genre-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 960px) {
  .wizard-sidebar {
    padding: 8px 18px;
  }

  .step-list {
    gap: 6px;
  }

  .step-item {
    padding: 6px 9px;
    border-radius: 6px;
  }

  .wizard-header,
  .wizard-stage,
  .wizard-footer {
    padding-left: 18px;
    padding-right: 18px;
  }

  .wizard-header {
    padding-top: 18px;
    padding-bottom: 12px;
  }

  .wizard-footer {
    padding: 14px 18px 16px;
  }
}

@media (max-width: 820px) {
  .wizard-sidebar {
    display: flex;
    padding: 8px 14px;
  }

  .wizard-nav-title {
    display: none;
  }

  .step-list {
    justify-content: center;
  }

  .step-item {
    padding: 6px 8px;
  }

  .wizard-header {
    padding: 12px 16px 10px;
    gap: 10px;
  }

  .back-button {
    width: 36px;
    height: 36px;
    border-radius: 10px;
  }

  .header-copy h2 {
    font-size: clamp(18px, 2.4vw, 24px);
  }

  .header-copy p {
    display: none;
  }

  .wizard-stage {
    padding: 12px 16px 0;
  }

  .wizard-footer {
    padding: 10px 16px 14px;
    gap: 10px;
  }

  .footer-actions {
    width: 100%;
  }

  .footer-actions :deep(.n-button) {
    flex: 1;
  }

  .content-card {
    padding: 18px 0;
  }

  .section-head {
    margin-bottom: 12px;
  }

  .section-head h3,
  .review-copy h3 {
    font-size: 16px;
  }

  .genre-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .genre-chip {
    padding: 10px 8px;
    font-size: 12px;
    border-radius: 8px;
  }

  .length-card {
    min-height: 68px;
    padding: 12px;
    border-radius: 10px;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }

  .toggle-panel {
    flex-direction: column;
    align-items: flex-start;
  }

  .generation-mode-grid {
    grid-template-columns: 1fr;
  }

  .spiral-progress {
    flex-wrap: wrap;
    gap: 10px;
  }

  .generate-icon {
    width: 34px;
    height: 34px;
    border-radius: 6px;
  }

  .footer-primary-btn,
  .footer-secondary-btn {
    --n-height: 40px !important;
    min-width: 0;
  }
}

@media (max-width: 560px) {
  .wizard-header,
  .wizard-stage,
  .wizard-footer {
    padding-left: 12px;
    padding-right: 12px;
  }

  .wizard-header {
    padding-top: 10px;
    padding-bottom: 8px;
  }

  .wizard-footer {
    padding: 8px 12px 12px;
  }

  .content-card {
    padding: 16px 0;
  }

  .header-copy h2 {
    font-size: 18px;
  }

  .genre-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .length-grid {
    grid-template-columns: 1fr;
  }

  .footer-primary-btn,
  .footer-secondary-btn {
    --n-height: 38px !important;
  }

  .step-pane {
    gap: 10px;
  }

  .field + .field {
    margin-top: 12px;
  }

  .section-head {
    margin-bottom: 10px;
  }
}

.wizard-step-enter-active {
  transition:
    opacity 0.22s cubic-bezier(0, 0, 0.2, 1),
    transform 0.22s cubic-bezier(0, 0, 0.2, 1);
}

.wizard-step-leave-active {
  transition: opacity 0.14s cubic-bezier(0.4, 0, 1, 1);
}

.wizard-step-enter-from {
  opacity: 0;
  transform: translateX(14px);
}

.wizard-step-leave-to {
  opacity: 0;
}

@keyframes pulseGlow {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.84;
  }
}

</style>
