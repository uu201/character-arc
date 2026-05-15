<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ArrowLeft, BookA, CheckCircle2, ChevronRight, Info, Sparkles } from 'lucide-vue-next'
import { NButton, NInput, NSwitch, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import { createProjectWorkspaceSeed, type ProjectBootstrapResult } from '@/features/wizard/projectSeed'
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

const viewportWidth = ref(window.innerWidth)
const isCompactWizard = computed(() => viewportWidth.value <= 820)

function syncViewport(): void {
  viewportWidth.value = window.innerWidth
}

onMounted(() => window.addEventListener('resize', syncViewport))
onBeforeUnmount(() => window.removeEventListener('resize', syncViewport))

const formData = reactive({
  title: '',
  selectedGenreKey: DEFAULT_PROJECT_GENRE_KEY,
  customGenre: '',
  novelLength: 'long' as NovelLength,
  premise: '',
  shouldGenerate: true
})

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
const creationModeLabel = computed(() => (formData.shouldGenerate ? 'AI 初始化' : '空白项目'))
const sidebarNote = computed(() => {
  if (step.value === 1) {
    return '项目名称、题材和篇幅会直接影响工作台中的项目信息，以及 AI 初始化时的设定偏向。'
  }
  if (step.value === 2) {
    return '简介越具体，AI 生成的世界观、开局冲突和前几章大纲就越贴近你真正想写的故事。'
  }
  return formData.shouldGenerate
    ? '开启 AI 初始化后，系统会直接生成首批世界观、大纲和章节草稿。'
    : '关闭 AI 初始化后，只会创建项目骨架与首章草稿，方便你从零开始搭建。'
})
const footerHint = computed(() => {
  if (step.value < 3) {
    return '创建完成后会直接进入项目工作台。'
  }
  return formData.shouldGenerate
    ? '将生成首批世界观、大纲与章节草稿。'
    : '将创建项目骨架与首章草稿。'
})

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
  formData.title = ''
  formData.selectedGenreKey = DEFAULT_PROJECT_GENRE_KEY
  formData.customGenre = ''
  formData.novelLength = 'long'
  formData.premise = ''
  formData.shouldGenerate = true
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
  try {
    let bootstrapResult: ProjectBootstrapResult | null = null

    if (formData.shouldGenerate) {
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

      bootstrapResult = result.result as ProjectBootstrapResult
    }

    appStore.createProjectWorkspace(
      createProjectWorkspaceSeed(
        {
          title: formData.title,
          genre: resolvedGenre.value,
          novelLength: formData.novelLength,
          premise: formData.premise,
          shouldGenerate: formData.shouldGenerate
        },
        bootstrapResult
      )
    )
    resetWizard()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '创建项目失败，请稍后重试')
  } finally {
    isGenerating.value = false
  }
}
</script>

<template>
  <section class="wizard-page">
    <div class="wizard-shell">
      <aside class="wizard-sidebar">
        <div class="sidebar-copy">
          <span class="sidebar-kicker">新建作品</span>
          <h1>先把作品骨架搭稳，再进入写作工作台。</h1>
          <p>保留三步创建流程，把项目基础、故事钩子和初始化方式一次定清楚。</p>
        </div>

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
                <small>{{ item.desc }}</small>
              </span>
            </button>
          </li>
        </ol>

        <section class="sidebar-panel">
          <div class="panel-eyebrow">当前项目摘要</div>
          <h2>{{ formData.title.trim() || '未命名作品' }}</h2>

          <dl class="sidebar-summary">
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
          </dl>

          <p class="sidebar-note">{{ sidebarNote }}</p>
        </section>
      </aside>

      <section class="wizard-main">
        <div v-if="isCompactWizard" class="compact-steps">
          <button
            v-for="item in steps"
            :key="item.num"
            type="button"
            class="compact-step"
            :class="{
              active: step === item.num,
              done: step > item.num,
              clickable: item.num < step && !isGenerating
            }"
            :disabled="item.num > step || isGenerating"
            @click="activateStep(item.num)"
          >
            <span class="compact-step-marker">
              <CheckCircle2 v-if="step > item.num" :size="14" />
              <span v-else>{{ item.num }}</span>
            </span>
            <span class="compact-step-title">{{ item.title }}</span>
          </button>
          <div class="compact-step-track">
            <div class="compact-step-fill" :style="{ width: ((step - 1) / (steps.length - 1)) * 100 + '%' }"></div>
          </div>
        </div>

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

                <div class="premise-helper-grid">
                  <div class="helper-card">
                    <strong>建议包含</strong>
                    <p>主角处境、核心矛盾、目标驱动，以及最能抓住读者的设定。</p>
                  </div>
                  <div class="helper-card">
                    <strong>避免空泛</strong>
                    <p>少写“这是一个精彩故事”这类泛描述，多写具体冲突和代价。</p>
                  </div>
                </div>
              </section>
            </div>

            <div v-else key="step-3" class="step-pane">
              <section class="content-card review-card">
                <div class="review-state">
                  <div class="generate-icon-wrap">
                    <div class="generate-icon">
                      <Sparkles :size="30" :class="{ pulse: isGenerating }" />
                      <div v-if="isGenerating" class="progress-ring"></div>
                    </div>
                  </div>

                  <div class="review-copy">
                    <h3>{{ isGenerating ? '正在创建项目工作区...' : '准备创建项目' }}</h3>
                    <p>
                      {{
                        isGenerating
                          ? formData.shouldGenerate
                            ? '正在根据题材、作品长度和小说简介生成首批世界观与剧情大纲，并同步创建章节草稿。'
                            : '正在创建项目脚手架，并为你准备首卷与第一章草稿。'
                          : '最后确认一次摘要和初始化方式。创建完成后会直接进入工作台。'
                      }}
                    </p>
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

                <div v-if="!isGenerating" class="toggle-panel">
                  <div class="toggle-copy">
                    <strong>AI 初始化</strong>
                    <p>默认会生成首批世界观、大纲和章节草稿，也可以只创建空白项目骨架。</p>
                  </div>

                  <n-switch v-model:value="formData.shouldGenerate" size="medium" class="bootstrap-toggle">
                    <template #checked>已开启</template>
                    <template #unchecked>已关闭</template>
                  </n-switch>
                </div>
              </section>

              <section v-if="!isGenerating" class="content-card">
                <div class="section-head">
                  <h3>创建后会得到什么</h3>
                  <p>确保你进入工作台时，已经有清晰的项目结构和可继续写作的起点。</p>
                </div>

                <ul class="benefit-list">
                  <li><CheckCircle2 :size="16" /> 项目卡片会保存题材与长篇 / 短篇信息</li>
                  <li><CheckCircle2 :size="16" /> 自动生成时，会按题材、篇幅和简介生成首批设定与剧情骨架</li>
                  <li><CheckCircle2 :size="16" /> 系统会同步创建首卷和可直接进入写作的章节草稿</li>
                  <li><CheckCircle2 :size="16" /> 关闭自动生成时，仅保留项目脚手架与首章草稿</li>
                </ul>
              </section>
            </div>
          </Transition>
        </div>

        <footer class="wizard-footer">
          <div class="footer-meta">
            <span class="footer-label">创建结果</span>
            <p>{{ footerHint }}</p>
          </div>

          <div class="footer-actions">
            <n-button
              size="large"
              :disabled="isGenerating"
              class="footer-secondary-btn"
              @click="goBack"
            >
              {{ step > 1 ? '上一步' : '取消' }}
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
                {{ isGenerating ? '创建中...' : formData.shouldGenerate ? '开始 AI 构建' : '直接创建项目' }}
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
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
}

.wizard-shell {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  width: min(1280px, 100%);
  height: 100%;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-md);
}

.wizard-sidebar {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 24px;
  padding: 28px 24px;
  border-right: 1px solid var(--arc-border);
  overflow-y: auto;
  background: var(--arc-bg-sidebar);
}

.sidebar-copy h1 {
  margin: 10px 0 0;
  color: var(--arc-text-primary);
  font-size: clamp(28px, 3vw, 34px);
  font-weight: 720;
  letter-spacing: -0.04em;
  line-height: 1.08;
}

.sidebar-copy p {
  margin: 12px 0 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.sidebar-kicker,
.header-kicker,
.panel-eyebrow,
.footer-label {
  display: inline-flex;
  align-items: center;
  color: var(--arc-text-hint);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.step-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.step-item {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  width: 100%;
  align-items: start;
  gap: 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 12px;
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
  border-color: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-border));
  background: var(--arc-bg-surface);
}

.step-item:disabled {
  opacity: 1;
}

.step-item.active {
  border-color: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-border));
  background: var(--arc-bg-surface);
}

.step-item.done:not(.active) {
  background: var(--arc-bg-weak);
}

.step-marker {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 13px;
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
  font-size: 14px;
  font-weight: 650;
}

.step-text small {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.sidebar-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: flex-end;
  padding: 18px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
}

.sidebar-panel h2 {
  margin: 10px 0 0;
  color: var(--arc-text-primary);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.sidebar-summary {
  display: grid;
  gap: 12px;
  margin: 18px 0 0;
}

.sidebar-summary div {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  gap: 12px;
}

.sidebar-summary dt,
.summary-grid dt {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.sidebar-summary dd,
.summary-grid dd {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 13px;
  line-height: 1.65;
}

.sidebar-note {
  margin: 18px 0 0;
  color: var(--arc-text-secondary);
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
  align-items: flex-start;
  gap: 16px;
  flex-shrink: 0;
  padding: 28px 28px 18px;
  border-bottom: 1px solid var(--arc-border);
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
  margin: 8px 0 0;
  color: var(--arc-text-primary);
  font-size: clamp(28px, 3vw, 34px);
  font-weight: 720;
  letter-spacing: -0.04em;
}

.header-copy p {
  margin: 8px 0 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.65;
}

.wizard-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 28px 0;
}

.step-pane {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-bottom: 24px;
}

.grow {
  flex: 1;
}

.content-card {
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  padding: 22px 24px;
  background: var(--arc-bg-surface);
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
  font-size: 20px;
  font-weight: 680;
  letter-spacing: -0.03em;
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
  display: block;
  margin-bottom: 8px;
  color: var(--arc-text-secondary);
  display: inline-flex !important;
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
  --n-border-radius: 10px;
  --n-height: 48px;
}

.wizard-naive-textarea :deep(.n-input) {
  --n-border-radius: 10px;
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
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.genre-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
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
  border-radius: 8px;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  padding: 11px 10px;
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
  min-height: 94px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  border-radius: 10px;
  color: var(--arc-text-secondary);
  cursor: pointer;
  padding: 16px;
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

.premise-helper-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}

.helper-card,
.toggle-panel {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-weak);
  padding: 14px 16px;
}

.helper-card strong,
.toggle-copy strong {
  color: var(--arc-text-primary);
  font-size: 13px;
  font-weight: 650;
}

.helper-card p {
  margin: 8px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.65;
}

.review-card {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.review-state {
  display: flex;
  align-items: center;
  gap: 18px;
}

.generate-icon-wrap {
  position: relative;
  flex-shrink: 0;
}

.generate-icon {
  position: relative;
  display: inline-flex;
  width: 72px;
  height: 72px;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 14%, var(--arc-border));
  border-radius: 12px;
  color: var(--arc-primary);
}

.pulse {
  animation: pulseGlow 1.4s ease-in-out infinite;
}

.progress-ring {
  position: absolute;
  inset: -4px;
  border-radius: 24px;
  background: conic-gradient(
    from 0deg,
    color-mix(in srgb, var(--arc-primary) 92%, var(--arc-bg-mix)),
    color-mix(in srgb, var(--arc-primary) 24%, var(--arc-bg-mix)),
    color-mix(in srgb, var(--arc-primary) 92%, var(--arc-bg-mix))
  );
  mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 0);
  animation: spinRing 1.8s linear infinite;
}

.review-copy {
  min-width: 0;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
  margin: 0;
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

.benefit-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
  color: var(--arc-text-secondary);
  font-size: 13px;
}

.benefit-list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  line-height: 1.65;
}

.benefit-list li :deep(svg) {
  color: var(--arc-primary);
  flex-shrink: 0;
  margin-top: 2px;
}

.wizard-footer {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
  padding: 18px 28px 24px;
  border-top: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.footer-meta p {
  margin: 8px 0 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.footer-primary-btn,
.footer-secondary-btn {
  --n-height: 44px !important;
  min-width: 110px;
  border-radius: 10px !important;
}

.footer-primary-btn :deep(.n-button__content),
.footer-secondary-btn :deep(.n-button__content) {
  font-weight: 600;
}

.back-button {
  --n-width: 40px !important;
  --n-height: 40px !important;
  border: 1px solid var(--arc-border) !important;
  border-radius: 10px !important;
}

.back-button:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, var(--arc-border)) !important;
}

@media (max-width: 1120px) {
  .wizard-shell {
    grid-template-columns: 280px minmax(0, 1fr);
  }

  .genre-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 960px) {
  .wizard-shell {
    grid-template-columns: 260px minmax(0, 1fr);
  }

  .wizard-sidebar {
    gap: 14px;
    padding: 18px 14px;
  }

  .sidebar-copy h1 {
    font-size: 22px;
  }

  .sidebar-copy p {
    display: none;
  }

  .step-list {
    gap: 6px;
  }

  .step-item {
    padding: 10px;
    border-radius: 10px;
  }

  .step-text small {
    display: none;
  }

  .sidebar-panel {
    justify-content: flex-start;
    padding: 14px;
    border-radius: 10px;
  }

  .sidebar-panel h2 {
    font-size: 18px;
  }

  .sidebar-note {
    display: none;
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
  .wizard-shell {
    grid-template-columns: 1fr;
    border-radius: 0;
  }

  .wizard-sidebar {
    display: none;
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

  .footer-meta {
    display: none;
  }

  .footer-actions {
    width: 100%;
  }

  .footer-actions :deep(.n-button) {
    flex: 1;
  }

  .content-card {
    border-radius: 10px;
    padding: 16px 14px;
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

  .premise-helper-grid {
    grid-template-columns: 1fr;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }

  .review-state,
  .toggle-panel {
    flex-direction: column;
    align-items: flex-start;
  }

  .generate-icon {
    width: 52px;
    height: 52px;
    border-radius: 10px;
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
    padding: 14px 12px;
    border-radius: 10px;
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

/* Compact step indicator (small windows) */
.compact-steps {
  display: none;
}

.compact-step {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: default;
  font-size: 13px;
  font-weight: 600;
  padding: 6px 10px;
  border-radius: 10px;
  transition: color 0.2s, background 0.2s;
}

.compact-step.clickable {
  cursor: pointer;
}

.compact-step.clickable:hover {
  background: rgba(0, 0, 0, 0.04);
}

.compact-step.active {
  color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix));
}

.compact-step.done:not(.active) {
  color: var(--arc-primary);
  opacity: 0.7;
}

.compact-step-marker {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-surface);
  font-size: 12px;
  font-weight: 700;
}

.compact-step.active .compact-step-marker {
  border-color: color-mix(in srgb, var(--arc-primary) 25%, var(--arc-bg-mix));
  background: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.compact-step.done .compact-step-marker {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.compact-step-title {
  white-space: nowrap;
}

.compact-step-track {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--arc-border);
  border-radius: 1px;
}

.compact-step-fill {
  height: 100%;
  background: var(--arc-primary);
  border-radius: 1px;
  transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@media (max-width: 820px) {
  .compact-steps {
    display: flex;
    align-items: center;
    gap: 4px;
    position: relative;
    padding: 10px 18px 14px;
    border-bottom: 1px solid var(--arc-border);
    background: var(--arc-bg-surface);
  }
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

@keyframes spinRing {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
