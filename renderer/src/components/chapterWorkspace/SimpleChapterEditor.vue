<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ensureEditorHtmlContent, serializePlainTextToHtml } from '@/features/chapters/editorContent'
import type { ChapterInsertionRequest, ChapterSelectionState } from '@/types/app'

const props = defineProps<{
  chapterId: string
  modelValue: string
  insertionRequest: ChapterInsertionRequest | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'consume-insertion': [requestId: string]
  'selection-change': [selection: ChapterSelectionState | null]
}>()

const editorRef = ref<HTMLDivElement | null>(null)
let savedRange: Range | null = null

const EMIT_DEBOUNCE_MS = 600
let emitTimer: number | null = null
let pendingHtml: string | null = null

function flushEmit(): void {
  if (emitTimer !== null) {
    window.clearTimeout(emitTimer)
    emitTimer = null
  }
  if (pendingHtml !== null) {
    const html = pendingHtml
    pendingHtml = null
    if (html !== props.modelValue) emit('update:modelValue', html)
  }
}

function scheduleEmit(html: string): void {
  pendingHtml = html
  if (emitTimer !== null) window.clearTimeout(emitTimer)
  emitTimer = window.setTimeout(flushEmit, EMIT_DEBOUNCE_MS)
}

function handleInput(): void {
  if (!editorRef.value) return
  scheduleEmit(editorRef.value.innerHTML)
}

function handleSelection(): void {
  if (!editorRef.value) return
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    emit('selection-change', null)
    return
  }
  const range = sel.getRangeAt(0)
  if (!editorRef.value.contains(range.commonAncestorContainer)) {
    emit('selection-change', null)
    return
  }
  const text = sel.toString().trim()
  if (!text) {
    emit('selection-change', null)
    return
  }
  savedRange = range.cloneRange()
  emit('selection-change', { chapterId: props.chapterId, text })
}

function syncContent(): void {
  if (!editorRef.value) return
  editorRef.value.innerHTML = ensureEditorHtmlContent(props.modelValue || '')
}

function applyInsertion(request: ChapterInsertionRequest): void {
  const root = editorRef.value
  if (!root || request.chapterId !== props.chapterId) return
  flushEmit()

  const html = serializePlainTextToHtml(request.content)
  const wrapper = document.createElement('div')
  wrapper.innerHTML = html
  const fragment = document.createDocumentFragment()
  while (wrapper.firstChild) fragment.appendChild(wrapper.firstChild)

  const sel = window.getSelection()
  const liveRange = sel && sel.rangeCount > 0 && root.contains(sel.anchorNode) && !sel.isCollapsed
    ? sel.getRangeAt(0)
    : null
  const usableRange = liveRange || (savedRange && root.contains(savedRange.commonAncestorContainer) ? savedRange : null)

  if (request.mode === 'append') {
    root.appendChild(fragment)
  } else if (request.mode === 'replace-selection' && usableRange) {
    usableRange.deleteContents()
    usableRange.insertNode(fragment)
  } else if (request.mode === 'cursor' && usableRange) {
    usableRange.collapse(false)
    usableRange.insertNode(fragment)
  } else if (liveRange) {
    liveRange.collapse(false)
    liveRange.insertNode(fragment)
  } else {
    root.appendChild(fragment)
  }

  savedRange = null
  emit('update:modelValue', root.innerHTML)
  emit('consume-insertion', request.id)
}

watch(
  () => props.chapterId,
  () => {
    flushEmit()
    nextTick(syncContent)
  },
  { immediate: true }
)

watch(
  () => props.modelValue,
  (next) => {
    const root = editorRef.value
    if (!root) return
    const normalized = ensureEditorHtmlContent(next || '')
    if (normalized === root.innerHTML) return
    if (document.activeElement === root) return
    root.innerHTML = normalized
  }
)

watch(
  () => props.insertionRequest?.id,
  () => {
    const request = props.insertionRequest
    if (request) nextTick(() => applyInsertion(request))
  }
)

onMounted(() => {
  try {
    document.execCommand('defaultParagraphSeparator', false, 'p')
  } catch {
    // ignore on browsers that don't support this command
  }
  nextTick(syncContent)
  document.addEventListener('selectionchange', handleSelection)
})

onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', handleSelection)
  flushEmit()
})
</script>

<template>
  <div
    ref="editorRef"
    class="simple-editor"
    contenteditable="true"
    spellcheck="false"
    @input="handleInput"
    @blur="flushEmit"
  />
</template>

<style scoped>
.simple-editor {
  font-size: inherit;
  line-height: 2;
  color: var(--arc-text-primary);
  outline: none;
  min-height: 400px;
  user-select: text;
  white-space: pre-wrap;
  word-break: break-word;
}

.simple-editor :deep(p) {
  margin: 0 0 1em;
  text-indent: 2em;
}

.simple-editor :deep(p:last-child) {
  margin-bottom: 0;
}
</style>
