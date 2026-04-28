<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  ArrowLeft,
  BookA,
  CheckCircle2,
  ChevronRight,
  Info,
  Sparkles,
  Target
} from 'lucide-vue-next'
import { NCheckbox, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { createProjectWorkspaceSeed, type ProjectBootstrapResult } from '@/features/wizard/projectSeed'

const appStore = useAppStore()
const message = useMessage()
const step = ref(1)
const isGenerating = ref(false)
const formData = reactive({
  title: '',
  genre: '科幻',
  targetWordCount: '20万字',
  premise: '',
  shouldGenerate: true
})

const steps = [
  { num: 1, title: '基础设定', desc: '为作品起个响亮的名字' },
  { num: 2, title: '核心点子', desc: '一句话描述你的故事' },
  { num: 3, title: 'AI 生成', desc: '构建世界观与大纲' }
] as const

const canContinue = computed(() => {
  if (step.value === 1) {
    return formData.title.trim().length > 0 && formData.targetWordCount.trim().length > 0
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
  formData.genre = '科幻'
  formData.targetWordCount = '20万字'
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

    // Only call AI when the user explicitly keeps bootstrap generation enabled.
    if (formData.shouldGenerate) {
      const result = await window.characterArc.generateAi({
        task: 'project-bootstrap',
        settings: appStore.appSettings,
        context: {
          projectTitle: formData.title,
          projectGenre: formData.genre,
          projectWordTarget: formData.targetWordCount,
          projectPremise: formData.premise
        }
      })

      if (!result.success || !result.result) {
        throw new Error(result.error ?? 'AI 初始化项目失败')
      }

      bootstrapResult = result.result as ProjectBootstrapResult
    }

    appStore.createProjectWorkspace(createProjectWorkspaceSeed(formData, bootstrapResult))
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
    <div class="bg-orb bg-orb-left"></div>
    <div class="bg-orb bg-orb-right"></div>

    <div class="wizard-card">
      <button class="back-button" @click="goBack">
        <ArrowLeft :size="24" />
      </button>

      <div class="wizard-head">
        <div class="stepper">
          <template v-for="(item, index) in steps" :key="item.num">
            <div class="step-badge" :class="{ active: step === item.num, done: step > item.num }">
              <CheckCircle2 v-if="step > item.num" :size="18" />
              <span v-else>{{ item.num }}</span>
            </div>
            <div
              v-if="index < steps.length - 1"
              class="step-line"
              :class="{ done: step > item.num }"
            ></div>
          </template>
        </div>

        <h2>{{ steps[step - 1].title }}</h2>
        <p>{{ steps[step - 1].desc }}</p>
      </div>

      <div class="wizard-body">
        <Transition name="wizard-step" mode="out-in">
          <div v-if="step === 1" key="step-1" class="step-pane">
            <div class="field">
              <label>作品名称</label>
              <div class="input-shell">
                <BookA :size="18" class="input-icon" />
                <input
                  v-model="formData.title"
                  type="text"
                  placeholder="例如：星渊拾遗"
                  class="wizard-input"
                />
              </div>
            </div>

            <div class="field">
              <label>目标字数</label>
              <div class="input-shell">
                <Target :size="18" class="input-icon" />
                <input
                  v-model="formData.targetWordCount"
                  type="text"
                  placeholder="例如：20万字"
                  class="wizard-input"
                />
              </div>
            </div>

            <div class="field">
              <label>作品题材</label>
              <div class="genre-grid">
                <button
                  v-for="genre in ['科幻', '奇幻', '仙侠', '都市', '悬疑', '历史']"
                  :key="genre"
                  class="genre-chip"
                  :class="{ active: formData.genre === genre }"
                  @click="formData.genre = genre"
                >
                  {{ genre }}
                </button>
              </div>
            </div>
          </div>

          <div v-else-if="step === 2" key="step-2" class="step-pane">
            <div class="field grow">
              <label class="inline-label">
                <span>一句话简介</span>
                <Info :size="14" />
              </label>
              <textarea
                v-model="formData.premise"
                class="wizard-textarea"
                placeholder="描述这个故事的核心冲突、主角的目标或独特的世界观。例如：一个拥有回溯时间能力的侦探，在一次次重启中寻找末日危机的真相..."
              ></textarea>
              <p class="field-hint">越详细的描述，AI 能够生成的设定越准确丰富。</p>
            </div>
          </div>

          <div v-else key="step-3" class="step-pane step-generate">
            <div class="generate-icon-wrap">
              <div class="generate-glow"></div>
              <div class="generate-icon">
                <Sparkles :size="38" :class="{ pulse: isGenerating }" />
                <div v-if="isGenerating" class="progress-ring"></div>
              </div>
            </div>

            <h3>{{ isGenerating ? '正在创建项目工作区...' : '准备就绪' }}</h3>
            <p>
              {{
                isGenerating
                  ? (formData.shouldGenerate
                      ? '正在解析核心点子，生成初始世界观与剧情大纲，并同步创建可继续写作的章节草稿。'
                      : '正在创建空白项目工作区，并为你准备第一个章节草稿。')
                  : `项目名为“${formData.title || '未命名作品'}”，题材为 ${formData.genre}，目标字数 ${formData.targetWordCount}。你可以选择直接创建，或让 AI 先帮你生成初始设定与大纲。`
              }}
            </p>

            <div v-if="!isGenerating" class="package-card">
              <div class="package-head">
                <span>初始化方式</span>
                <span>{{ formData.shouldGenerate ? 'AI 生成初始内容' : '直接创建空白项目' }}</span>
              </div>
              <n-checkbox v-model:checked="formData.shouldGenerate" class="bootstrap-toggle">
                自动调用 AI 生成初始世界观与大纲
              </n-checkbox>
              <ul>
                <li><CheckCircle2 :size="16" /> 项目标题、题材与目标字数会直接写入项目卡片</li>
                <li><CheckCircle2 :size="16" /> 自动生成时，会创建首批世界观词条和章节大纲</li>
                <li><CheckCircle2 :size="16" /> 系统会同步创建可直接进入写作的章节草稿</li>
                <li><CheckCircle2 :size="16" /> 关闭自动生成时，仅保留空白工作区和首章草稿</li>
              </ul>
            </div>
          </div>
        </Transition>
      </div>

      <div class="wizard-footer">
        <button class="primary-action" :disabled="!canContinue" @click="goNext">
          <template v-if="step < 3">
            <span>下一步</span>
            <ChevronRight :size="18" />
          </template>
          <template v-else>
            <Sparkles v-if="!isGenerating" :size="18" />
            <span>{{ isGenerating ? '创建中...' : formData.shouldGenerate ? '开始 AI 构建' : '直接创建项目' }}</span>
          </template>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.wizard-page {
  position: relative;
  display: flex;
  min-height: 100%;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: clamp(24px, 4vw, 48px) 16px;
}

.bg-orb {
  position: absolute;
  width: 26rem;
  height: 26rem;
  border-radius: 999px;
  filter: blur(100px);
  opacity: 0.26;
  pointer-events: none;
}

.bg-orb-left {
  top: 40px;
  left: 80px;
  background: color-mix(in srgb, var(--arc-primary) 62%, white 38%);
}

.bg-orb-right {
  right: 80px;
  bottom: 40px;
  background: linear-gradient(135deg, rgba(109, 93, 252, 0.35), rgba(120, 163, 255, 0.3));
}

.wizard-card {
  position: relative;
  z-index: 1;
  display: flex;
  width: 100%;
  max-width: 840px;
  min-height: min(620px, calc(100dvh - 48px));
  max-height: calc(100dvh - 32px);
  flex-direction: column;
  overflow: auto;
  border: 1px solid rgba(255, 255, 255, 0.75);
  border-radius: 34px;
  background: rgba(255, 255, 255, 0.74);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(28px);
  padding: 32px clamp(22px, 4vw, 40px) 36px;
}

.back-button {
  position: absolute;
  top: 28px;
  left: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-button:hover {
  background: rgba(0, 0, 0, 0.04);
  color: var(--arc-text-primary);
}

.wizard-head {
  margin-top: 52px;
  margin-bottom: 32px;
  text-align: center;
}

.stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
}

.step-badge {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #eceef3;
  color: #9aa0ab;
  font-size: 14px;
  font-weight: 700;
  transition: all 0.28s ease;
}

.step-badge.active {
  background: var(--arc-primary);
  color: white;
  box-shadow: 0 12px 28px color-mix(in srgb, var(--arc-primary) 32%, transparent);
}

.step-badge.done {
  background: #16a34a;
  color: white;
}

.step-line {
  width: 50px;
  height: 4px;
  margin: 0 10px;
  border-radius: 999px;
  background: #eceef3;
}

.step-line.done {
  background: #16a34a;
}

.wizard-head h2 {
  margin: 0 0 8px;
  font-size: clamp(28px, 3vw, 34px);
  font-weight: 650;
  letter-spacing: -0.03em;
}

.wizard-head p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 15px;
}

.wizard-body {
  display: flex;
  flex: 1;
}

.step-pane {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 26px;
}

.grow {
  flex: 1;
}

.field label {
  display: block;
  margin-bottom: 10px;
  margin-left: 4px;
  color: #4b5563;
  font-size: 14px;
  font-weight: 600;
}

.inline-label {
  display: inline-flex !important;
  align-items: center;
  gap: 6px;
}

.input-shell {
  position: relative;
}

.input-icon {
  position: absolute;
  top: 50%;
  left: 16px;
  transform: translateY(-50%);
  color: #9ca3af;
}

.wizard-input,
.wizard-textarea {
  width: 100%;
  border: 1px solid rgba(209, 213, 219, 0.6);
  border-radius: 22px;
  background: rgba(249, 250, 251, 0.76);
  color: var(--arc-text-primary);
  outline: none;
  transition: all 0.24s ease;
}

.wizard-input:focus,
.wizard-textarea:focus {
  border-color: color-mix(in srgb, var(--arc-primary) 72%, white);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--arc-primary) 14%, transparent);
}

.wizard-input {
  padding: 18px 18px 18px 48px;
  font-size: 18px;
}

.genre-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.genre-chip {
  border: 2px solid transparent;
  border-radius: 18px;
  background: rgba(249, 250, 251, 0.78);
  color: #6b7280;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  padding: 14px 12px;
  transition: all 0.24s ease;
}

.genre-chip:hover {
  background: rgba(243, 244, 246, 0.96);
}

.genre-chip.active {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, white);
  background: color-mix(in srgb, var(--arc-primary) 10%, white);
  color: var(--arc-primary);
}

.wizard-textarea {
  min-height: 220px;
  resize: none;
  padding: 18px 20px;
  font-size: 15px;
  line-height: 1.75;
}

.field-hint {
  margin: 12px 0 0 4px;
  color: #9ca3af;
  font-size: 12px;
}

.step-generate {
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 12px 0;
}

.generate-icon-wrap {
  position: relative;
  margin-bottom: 28px;
}

.generate-glow {
  position: absolute;
  inset: -18px;
  border-radius: 28px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--arc-primary) 15%, white), rgba(124, 58, 237, 0.12));
  filter: blur(20px);
}

.generate-icon {
  position: relative;
  display: inline-flex;
  width: 96px;
  height: 96px;
  align-items: center;
  justify-content: center;
  border-radius: 28px;
  background: linear-gradient(135deg, rgba(229, 241, 255, 0.96), rgba(242, 233, 255, 0.92));
  color: var(--arc-primary);
}

.pulse {
  animation: pulseGlow 1.4s ease-in-out infinite;
}

.progress-ring {
  position: absolute;
  inset: -4px;
  border-radius: 30px;
  background: conic-gradient(var(--arc-primary), rgba(124, 58, 237, 0.9), var(--arc-primary));
  mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 0);
  animation: spinRing 2.5s linear infinite;
}

.step-generate h3 {
  margin: 0 0 14px;
  font-size: 28px;
  font-weight: 650;
}

.step-generate p {
  max-width: 420px;
  margin: 0 0 28px;
  color: #6b7280;
  font-size: 14px;
  line-height: 1.75;
}

.package-card {
  width: 100%;
  max-width: 520px;
  border: 1px solid rgba(229, 231, 235, 0.9);
  border-radius: 22px;
  background: rgba(249, 250, 251, 0.8);
  padding: 18px 20px;
  text-align: left;
}

.package-head {
  display: flex;
  justify-content: space-between;
  padding-bottom: 10px;
  margin-bottom: 10px;
  border-bottom: 1px solid rgba(229, 231, 235, 0.9);
  color: #6b7280;
  font-size: 14px;
}

.package-head span:last-child {
  color: #374151;
  font-weight: 600;
}

.bootstrap-toggle {
  display: inline-flex;
  margin-bottom: 16px;
  color: #374151;
  font-size: 14px;
  font-weight: 600;
}

.package-card ul {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
  color: #6b7280;
  font-size: 14px;
}

.package-card li {
  display: flex;
  align-items: center;
  gap: 10px;
}

.package-card li :deep(svg) {
  color: #16a34a;
}

.wizard-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 24px;
  margin-top: 24px;
  border-top: 1px solid rgba(229, 231, 235, 0.75);
}

.primary-action {
  display: inline-flex;
  width: auto;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--arc-primary), color-mix(in srgb, var(--arc-primary) 50%, #7c3aed));
  color: white;
  cursor: pointer;
  font-size: 16px;
  font-weight: 650;
  padding: 16px 28px;
  box-shadow: 0 16px 34px color-mix(in srgb, var(--arc-primary) 28%, transparent);
  transition: transform 0.24s ease, box-shadow 0.24s ease, opacity 0.24s ease;
}

.primary-action:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 22px 44px color-mix(in srgb, var(--arc-primary) 34%, transparent);
}

.primary-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

@media (max-width: 900px) {
  .wizard-card {
    min-height: auto;
    padding-top: 26px;
  }

  .wizard-head {
    margin-top: 44px;
  }

  .genre-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .package-head {
    flex-direction: column;
    gap: 4px;
  }

  .wizard-footer {
    justify-content: stretch;
  }

  .primary-action {
    width: 100%;
  }
}

@media (max-height: 820px) {
  .wizard-page {
    align-items: stretch;
  }

  .wizard-card {
    min-height: auto;
  }
}

@media (max-width: 640px) {
  .wizard-page {
    align-items: stretch;
  }

  .wizard-card {
    border-radius: 26px;
  }

  .stepper {
    transform: scale(0.92);
  }

  .genre-grid {
    grid-template-columns: 1fr;
  }

  .wizard-textarea {
    min-height: 180px;
  }
}

.wizard-step-enter-active,
.wizard-step-leave-active {
  transition: all 0.28s ease;
}

.wizard-step-enter-from {
  opacity: 0;
  transform: translateX(24px);
}

.wizard-step-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}

@keyframes pulseGlow {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.06);
    opacity: 0.82;
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
