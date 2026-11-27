<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { NCheckbox, NPopover, NRadio, NRadioGroup } from 'naive-ui'
import { ArrowUp, ChevronDown, FileText, Paperclip, Sparkles, Square, Undo2, X } from 'lucide-vue-next'
import type {
  SkillUseMode,
  SkillUsePolicy,
  TurnDocumentAttachment,
  TurnImageAttachment
} from '@shared/assistant-runtime'
import type { ProjectSkillItem } from '@/types/app'

const props = withDefaults(defineProps<{
  modelValue: string
  isStreaming: boolean
  isCanceling?: boolean
  modeLabel?: string
  streamingCharCount?: number
  isEditing?: boolean
  restoredLabel?: string
  skillPolicy?: SkillUsePolicy
  availableSkills?: ProjectSkillItem[]
  imageAttachments?: TurnImageAttachment[]
  documentAttachments?: TurnDocumentAttachment[]
}>(), {
  skillPolicy: () => ({ mode: 'auto', skillIds: [] }),
  availableSkills: () => [],
  imageAttachments: () => [],
  documentAttachments: () => []
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'send'): void
  (e: 'cancel'): void
  (e: 'edit-last'): void
  (e: 'clear-restored'): void
  (e: 'update:skill-policy', value: SkillUsePolicy): void
  (e: 'add-images', files: File[]): void
  (e: 'remove-image', ref: string): void
  (e: 'add-documents', files: File[]): void
  (e: 'remove-document', ref: string): void
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const isDraggingAttachment = ref(false)
let lastEscapeAt = 0

const skillPolicyLabel = computed(() => {
  if (props.skillPolicy.mode === 'off') return '技能：不使用'
  if (props.skillPolicy.mode === 'only') return `技能：仅使用（${props.skillPolicy.skillIds.length}）`
  return '技能：自动'
})

const sendDisabled = computed(() => (
  props.isEditing
  || (!props.modelValue.trim() && props.imageAttachments.length === 0 && props.documentAttachments.length === 0)
  || (props.skillPolicy.mode === 'only' && props.skillPolicy.skillIds.length === 0)
))

const inputDisabled = computed(() => props.isStreaming || props.isEditing)

function setSkillMode(mode: SkillUseMode): void {
  emit('update:skill-policy', { ...props.skillPolicy, mode })
}

function toggleSkill(skillId: string, checked: boolean): void {
  const selected = props.skillPolicy.skillIds
  emit('update:skill-policy', {
    mode: 'only',
    skillIds: checked
      ? [...new Set([...selected, skillId])]
      : selected.filter((id) => id !== skillId)
  })
}

function handleInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)
  autosize(target)
}

function addFiles(files: FileList | File[]): void {
  if (inputDisabled.value) return
  const items = Array.from(files)
  const images = items.filter((file) => file.type.startsWith('image/'))
  const documents = items.filter((file) => !file.type.startsWith('image/'))
  if (images.length > 0) emit('add-images', images)
  if (documents.length > 0) emit('add-documents', documents)
}

function openFilePicker(): void {
  if (!inputDisabled.value) fileInputRef.value?.click()
}

function handleFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  if (input.files) addFiles(input.files)
  input.value = ''
}

function handlePaste(event: ClipboardEvent): void {
  const files = event.clipboardData?.files
  if (!files?.length) return
  event.preventDefault()
  addFiles(files)
}

function handleDrop(event: DragEvent): void {
  isDraggingAttachment.value = false
  if (event.dataTransfer?.files) addFiles(event.dataTransfer.files)
}

function formatFileSize(size: number): string {
  return size < 1024 ? `${size} B` : `${Math.max(1, Math.round(size / 1024))} KB`
}

function autosize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = Math.min(180, el.scrollHeight) + 'px'
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !props.isStreaming && !props.isEditing) {
    const now = Date.now()
    if (now - lastEscapeAt <= 600) {
      lastEscapeAt = 0
      event.preventDefault()
      emit('edit-last')
    } else {
      lastEscapeAt = now
    }
    return
  }
  lastEscapeAt = 0
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    if (props.isStreaming || props.isEditing) return
    emit('send')
  }
}

watch(
  () => props.restoredLabel,
  async (label) => {
    if (!label) return
    await nextTick()
    if (!textareaRef.value) return
    textareaRef.value.focus()
    autosize(textareaRef.value)
  }
)
</script>

<template>
  <div class="composer-wrap">
    <div
      class="composer"
      :class="{ streaming: props.isStreaming, editing: props.isEditing, 'drop-active': isDraggingAttachment }"
      @dragenter.prevent="isDraggingAttachment = true"
      @dragover.prevent="isDraggingAttachment = true"
      @dragleave.prevent="isDraggingAttachment = false"
      @drop.prevent="handleDrop"
    >
      <div v-if="props.restoredLabel" class="restored-draft">
        <Undo2 :size="12" />
        <span>{{ props.restoredLabel }}</span>
        <button type="button" title="清除回填内容" aria-label="清除回填内容" @click="emit('clear-restored')">
          <X :size="11" />
        </button>
      </div>
      <div v-if="props.imageAttachments.length" class="image-list">
        <div v-for="image in props.imageAttachments" :key="image.ref" class="image-chip">
          <img :src="image.dataUrl" :alt="image.label" />
          <span :title="image.label">{{ image.label }}</span>
          <button
            type="button"
            :title="`移除 ${image.label}`"
            :aria-label="`移除 ${image.label}`"
            :disabled="inputDisabled"
            @click="emit('remove-image', image.ref)"
          >
            <X :size="11" />
          </button>
        </div>
      </div>
      <div v-if="props.documentAttachments.length" class="document-list">
        <div v-for="document in props.documentAttachments" :key="document.ref" class="document-chip">
          <span class="document-icon"><FileText :size="18" /></span>
          <span class="document-copy">
            <strong :title="document.label">{{ document.label }}</strong>
            <small>{{ formatFileSize(document.size) }}</small>
          </span>
          <button
            type="button"
            :title="`移除 ${document.label}`"
            :aria-label="`移除 ${document.label}`"
            :disabled="inputDisabled"
            @click="emit('remove-document', document.ref)"
          >
            <X :size="11" />
          </button>
        </div>
      </div>
      <textarea
        ref="textareaRef"
        :value="props.modelValue"
        :disabled="props.isEditing"
        :placeholder="props.isEditing ? '正在编辑历史提问' : '描述你的想法，或让助手动手…'"
        aria-label="发送给 AI 助手的消息"
        @input="handleInput"
        @keydown="handleKeydown"
        @paste="handlePaste"
      />
      <div class="foot">
        <div class="actions">
          <input
            ref="fileInputRef"
            class="image-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.markdown,.csv,.json,.log,text/plain,text/markdown,text/csv,application/json"
            multiple
            @change="handleFileChange"
          />
          <button
            type="button"
            class="attach-trigger"
            :disabled="inputDisabled"
            title="上传图片或文本文件（也可粘贴或拖入）"
            aria-label="上传图片或文本文件"
            @click="openFilePicker"
          >
            <Paperclip :size="14" />
          </button>
          <span v-if="props.modeLabel" class="mode-chip">{{ props.modeLabel }}</span>
          <NPopover trigger="click" placement="top-end" :show-arrow="false" :disabled="props.isStreaming || props.isEditing">
            <template #trigger>
              <button
                type="button"
                class="skill-policy-trigger"
                :disabled="props.isStreaming || props.isEditing"
                :title="skillPolicyLabel"
              >
                <Sparkles :size="13" />
                <span>{{ skillPolicyLabel }}</span>
                <ChevronDown :size="12" />
              </button>
            </template>
            <div class="skill-policy-popover assistant-ui">
              <strong>本对话技能规则</strong>
              <NRadioGroup :value="props.skillPolicy.mode" @update:value="setSkillMode">
                <div class="skill-mode-list">
                  <NRadio value="auto">自动匹配</NRadio>
                  <NRadio value="only">仅使用指定</NRadio>
                  <NRadio value="off">不使用</NRadio>
                </div>
              </NRadioGroup>
              <div v-if="props.skillPolicy.mode === 'only'" class="skill-only-list">
                <span v-if="props.availableSkills.length === 0" class="skill-empty">当前项目没有已启用的可用技能。</span>
                <template v-else>
                  <NCheckbox
                    v-for="skill in props.availableSkills"
                    :key="skill.id"
                    :checked="props.skillPolicy.skillIds.includes(skill.id)"
                    @update:checked="toggleSkill(skill.id, $event)"
                  >{{ skill.name }}</NCheckbox>
                </template>
              </div>
              <small v-if="props.skillPolicy.mode === 'only' && props.skillPolicy.skillIds.length === 0" class="skill-warning">
                请至少选择一个技能后再发送。
              </small>
              <small v-else class="skill-policy-note">该选择保留在当前对话中，不会修改项目默认规则。</small>
            </div>
          </NPopover>
          <button
            v-if="props.isStreaming"
            type="button"
            class="send-button stop-button"
            :title="props.isCanceling ? '正在停止生成' : '停止生成'"
            :aria-label="props.isCanceling ? '正在停止生成' : '停止生成'"
            :disabled="props.isCanceling"
            @click="emit('cancel')"
          >
            <Square :size="12" fill="currentColor" />
          </button>
          <button
            v-else
            type="button"
            class="send-button"
            title="发送消息"
            aria-label="发送消息"
            :disabled="sendDisabled"
            @click="emit('send')"
          >
            <ArrowUp :size="17" :stroke-width="2.2" />
          </button>
        </div>
      </div>
    </div>
    <div class="composer-caption">
      <span v-if="props.isEditing">正在编辑历史提问</span>
      <span v-else-if="props.isStreaming">正在回答<template v-if="props.streamingCharCount"> · {{ props.streamingCharCount }} 字</template></span>
      <span v-else>修改会先进入暂存区，经你确认后写回</span>
      <span class="keyboard-hint">Enter 发送 <span>·</span> Shift + Enter 换行</span>
    </div>
  </div>
</template>

<style scoped>
.composer-wrap {
  container-type: inline-size;
  padding: 14px clamp(16px, 4cqi, 40px) 16px;
  background: var(--assistant-surface, var(--arc-bg-surface));
}

.composer {
  max-width: 760px;
  margin: 0 auto;
  background: var(--arc-bg-surface);
  border: 1px solid var(--assistant-border, var(--arc-border));
  border-radius: 18px;
  padding: 14px 14px 10px;
  box-shadow: 0 2px 9px rgb(0 0 0 / 3%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.composer.streaming {
  border-color: var(--arc-border-strong);
  box-shadow: 0 2px 9px rgb(0 0 0 / 3%);
}
.composer.editing {
  opacity: 0.56;
}
.composer.drop-active {
  border-color: var(--arc-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 12%, transparent), var(--arc-shadow-md);
}
.restored-draft {
  align-self: flex-start;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 8px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-family: inherit;
  font-size: 10.5px;
}
.restored-draft span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.restored-draft button {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.restored-draft button:hover {
  background: color-mix(in srgb, var(--arc-primary) 12%, transparent);
}
textarea {
  width: 100%;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--arc-text-primary);
  min-height: 48px;
  max-height: 180px;
  line-height: 1.7;
  padding: 0 2px;
  font-size: 14px;
}
textarea:disabled {
  cursor: not-allowed;
}
textarea::placeholder {
  color: var(--arc-text-hint);
}
.image-list {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.image-chip {
  width: 88px;
  flex: 0 0 auto;
  position: relative;
  display: grid;
  gap: 4px;
  padding: 5px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-body);
}
.image-chip img {
  width: 76px;
  height: 54px;
  border-radius: 6px;
  object-fit: cover;
  background: var(--arc-bg-surface);
}
.image-chip span {
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image-chip button {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  cursor: pointer;
}
.image-chip button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.document-list {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.document-chip {
  width: 176px;
  min-height: 48px;
  flex: 0 0 auto;
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 7px 28px 7px 8px;
  border: 1px solid var(--assistant-border, var(--arc-border));
  border-radius: 10px;
  background: var(--arc-bg-body);
  box-shadow: none;
}
.document-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}
.document-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.document-copy strong {
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 10.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.document-copy small {
  color: var(--arc-text-hint);
  font-family: inherit;
  font-size: 9px;
}
.document-chip button {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
}
.document-chip button:hover {
  background: var(--arc-border);
  color: var(--arc-text-primary);
}
.document-chip button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mode-chip {
  flex: 0 1 auto;
  max-width: 160px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 3px 7px;
  border-radius: 999px;
  background: transparent;
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 400;
}
.actions {
  display: flex;
  min-width: 0;
  flex-shrink: 1;
  align-items: center;
  gap: 5px;
  width: 100%;
}
.image-file-input {
  display: none;
}
.attach-trigger {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
}
.attach-trigger:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--arc-primary) 50%, var(--arc-border));
  color: var(--arc-text-primary);
  background: var(--assistant-subtle, var(--arc-bg-weak));
}
.attach-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.skill-policy-trigger {
  min-width: 0;
  max-width: 170px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 11.5px;
  cursor: pointer;
}
.skill-policy-trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skill-policy-trigger:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--arc-primary) 50%, var(--arc-border));
  color: var(--arc-text-primary);
  background: var(--assistant-subtle, var(--arc-bg-weak));
}
.skill-policy-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.skill-policy-popover {
  width: min(320px, calc(100vw - 40px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px;
}
.skill-policy-popover > strong {
  color: var(--arc-text-primary);
  font-size: 13px;
}
.skill-mode-list,
.skill-only-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.skill-only-list {
  max-height: 210px;
  padding: 9px 10px;
  overflow-y: auto;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
}
.skill-empty,
.skill-policy-note,
.skill-warning {
  color: var(--arc-text-hint);
  font-size: 11px;
  line-height: 1.5;
}
.skill-warning {
  color: var(--arc-danger, #d03050);
}

@container (max-width: 420px) {
  .foot {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }

  .actions {
    width: 100%;
  }

  .skill-policy-trigger {
    max-width: none;
    flex: 1 1 auto;
    justify-content: center;
  }
}

.composer:focus-within {
  border-color: var(--arc-border-strong);
  box-shadow: 0 2px 12px rgb(0 0 0 / 5%);
}

.send-button { display: grid; place-items: center; width: 32px; height: 32px; margin-left: auto; flex: 0 0 32px; padding: 0; border: 0; border-radius: 50%; background: var(--assistant-action-bg, var(--arc-text-primary)); color: var(--assistant-action-fg, var(--arc-bg-surface)); cursor: pointer; transition: opacity .15s, transform .15s; }

.send-button:hover:not(:disabled) { opacity: .82; }

.send-button:active:not(:disabled) { transform: scale(.94); }

.send-button:disabled { background: var(--assistant-hover, var(--arc-border)); color: var(--arc-text-hint); cursor: not-allowed; }

.composer-caption { display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 760px; margin: 9px auto 0; color: var(--arc-text-hint); font-size: 10.5px; line-height: 1.5; }

.keyboard-hint { white-space: nowrap; }

.keyboard-hint > span { margin: 0 3px; }

@container (max-width: 520px) { .keyboard-hint { display: none; } .composer-caption { justify-content: center; font-size: 10px; } .composer-wrap { padding: 10px 12px 12px; } .composer { border-radius: 15px; } }
</style>
