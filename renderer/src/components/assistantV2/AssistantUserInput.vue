<script setup lang="ts">
import { computed, reactive } from 'vue'
import { CheckCircle2, CornerDownRight, Sparkles } from 'lucide-vue-next'
import type { SkillUserInputRequest } from '@shared/assistant-runtime'

const props = defineProps<{
  request: SkillUserInputRequest
  answers?: Record<string, string>
  disabled: boolean
}>()
const emit = defineEmits<{ (e: 'submit', answers: Record<string, string>): void }>()
const choices = reactive<Record<string, number>>({})
const custom = reactive<Record<string, string>>({})
const responses = computed(() => Object.fromEntries(props.request.questions.map((question) => [
  question.id,
  choices[question.id] >= 0
    ? question.options[choices[question.id]]?.label ?? ''
    : (custom[question.id] ?? '').trim()
])))
const canSubmit = computed(() => !props.disabled && !props.answers && Object.values(responses.value).every(Boolean))
</script>

<template>
  <section class="input-card" :aria-labelledby="`input-${request.id}`">
    <header>
      <Sparkles :size="16" aria-hidden="true" />
      <div>
        <span class="eyebrow">{{ answers ? '已记录你的选择' : '需要你的输入' }}</span>
        <h4 :id="`input-${request.id}`">{{ request.step }}</h4>
      </div>
      <CheckCircle2 v-if="answers" :size="17" class="answered-icon" aria-hidden="true" />
      <span v-else class="waiting-badge">等待回答</span>
    </header>
    <form @submit.prevent="canSubmit && emit('submit', responses)">
      <fieldset v-for="question in request.questions" :key="question.id" :disabled="disabled || Boolean(answers)">
        <legend>{{ question.question }}</legend>
        <p v-if="answers" class="answer-copy">{{ answers[question.id] }}</p>
        <template v-else>
          <label v-for="(option, index) in question.options" :key="index" class="option" :class="{ selected: choices[question.id] === index }">
            <input v-model="choices[question.id]" type="radio" :name="`${request.id}-${question.id}`" :value="index" />
            <span class="option-number" aria-hidden="true">{{ index + 1 }}</span>
            <span class="option-copy"><strong>{{ option.label }}</strong><small v-if="option.description">{{ option.description }}</small></span>
          </label>
          <label v-if="question.options.length" class="custom-choice">
            <input v-model="choices[question.id]" type="radio" :name="`${request.id}-${question.id}`" :value="-1" />
            自定义回答
          </label>
          <textarea v-if="!question.options.length || choices[question.id] === -1" v-model="custom[question.id]"
            :aria-label="question.question" rows="3" maxlength="4000" placeholder="输入你的想法，或说明需要调整的方向…" />
        </template>
      </fieldset>
      <footer v-if="!answers">
        <span>提交后从当前步骤继续</span>
        <button type="submit" :disabled="!canSubmit"><CornerDownRight :size="14" aria-hidden="true" />确认并继续</button>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.input-card { margin: 16px 0 4px; border: 1px solid var(--assistant-border, var(--arc-border)); border-radius: 14px; background: var(--arc-bg-surface); overflow: hidden; }
header { display: flex; gap: 10px; align-items: center; padding: 18px 20px; color: var(--arc-text-secondary); }
header > div { flex: 1; min-width: 0; }
header > svg { flex-shrink: 0; }
.eyebrow { font-size: 11px; color: var(--arc-text-hint); }
h4 { margin: 3px 0 0; font-size: 14px; font-weight: 600; color: var(--arc-text-primary); line-height: 1.5; overflow-wrap: anywhere; }
.answered-icon { color: var(--arc-text-secondary); }
.waiting-badge { flex-shrink: 0; padding: 3px 7px; border-radius: 6px; background: var(--assistant-subtle, var(--arc-bg-weak)); color: var(--arc-text-secondary); font-size: 10px; }
form { padding: 0 20px; }
fieldset { padding: 0 0 18px; margin: 0; border: 0; min-width: 0; }
fieldset + fieldset { padding-top: 6px; }
legend { margin-bottom: 8px; padding: 0; font-size: 13px; font-weight: 500; color: var(--arc-text-primary); line-height: 1.7; overflow-wrap: anywhere; }
.option { display: grid; grid-template-columns: 24px minmax(0, 1fr) 14px; gap: 10px; align-items: center; margin: 6px 0; padding: 11px 12px; border: 1px solid transparent; border-radius: 9px; background: var(--assistant-subtle, var(--arc-bg-weak)); cursor: pointer; transition: border-color .15s, background .15s; }
.option:hover { background: var(--assistant-hover, var(--arc-bg-surface-hover)); }
.option.selected { border-color: var(--arc-border-strong); background: var(--assistant-hover, var(--arc-bg-surface-hover)); }
.option:focus-within { outline: 2px solid var(--arc-text-secondary); outline-offset: 2px; }
input { margin: 0; flex-shrink: 0; accent-color: var(--arc-text-primary); }
.option input { grid-column: 3; grid-row: 1; }
.option-number { grid-column: 1; grid-row: 1; display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--assistant-border, var(--arc-border)); border-radius: 6px; color: var(--arc-text-secondary); font-size: 11px; }
.option-copy { grid-column: 2; grid-row: 1; min-width: 0; overflow-wrap: anywhere; }
strong { font-size: 13px; color: var(--arc-text-primary); font-weight: 500; }
small { display: block; margin-top: 3px; font-size: 12px; color: var(--arc-text-secondary); line-height: 1.6; }
.custom-choice { display: flex; gap: 8px; align-items: center; margin: 14px 0 8px; font-size: 12px; color: var(--arc-text-secondary); cursor: pointer; }
textarea { box-sizing: border-box; width: 100%; padding: 10px 12px; resize: vertical; border: 1px solid var(--assistant-border, var(--arc-border)); border-radius: 9px; background: var(--arc-bg-surface); color: var(--arc-text-primary); font: inherit; font-size: 13px; line-height: 1.6; }
textarea:focus-visible, button:focus-visible { outline: 2px solid var(--arc-text-secondary); outline-offset: 2px; }
.answer-copy { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; color: var(--arc-text-secondary); line-height: 1.7; }
footer { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; justify-content: space-between; padding: 14px 0 16px; border-top: 1px solid var(--assistant-border, var(--arc-border)); }
footer span { font-size: 11px; color: var(--arc-text-hint); }
button { display: inline-flex; gap: 6px; align-items: center; padding: 8px 12px; border: 0; border-radius: 8px; background: var(--assistant-action-bg, var(--arc-text-primary)); color: var(--assistant-action-fg, var(--arc-bg-surface)); font: inherit; font-size: 12px; cursor: pointer; }
button:hover:not(:disabled) { opacity: .82; }
button:disabled { opacity: .45; cursor: not-allowed; }
fieldset:disabled .option, fieldset:disabled .custom-choice { cursor: default; opacity: .65; }
@container assistant-messages (max-width: 480px) { header { padding: 14px; gap: 8px; } form { padding: 0 14px; } footer { gap: 10px; } footer button { margin-left: auto; } .option { padding: 10px; gap: 8px; } }
</style>
