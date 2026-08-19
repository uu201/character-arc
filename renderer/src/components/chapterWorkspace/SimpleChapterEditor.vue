<script setup lang="ts">
import { nextTick, onBeforeUnmount, watch } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import Underline from '@tiptap/extension-underline'
import { ensureEditorHtmlContent } from '@/features/chapters/editorContent'
import { formatChapterEditorDocument } from '@/features/chapters/chapterFormatting'
import type { ChapterInsertionRequest, ChapterSelectionState } from '@/types/app'
import { EditorSearchExtension } from '@/features/chapters/editorSearch'

export type ChapterRecoverySnapshot = {
  chapterId: string
  content: string
  savedAt: string
}

const props = defineProps<{
  chapterId: string
  modelValue: string
  insertionRequest: ChapterInsertionRequest | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string, chapterId: string]
  'consume-insertion': [requestId: string]
  'selection-change': [selection: ChapterSelectionState | null]
  'recovery-available': [snapshot: ChapterRecoverySnapshot | null]
}>()

const RECOVERY_DEBOUNCE_MS = 1_000
let recoveryTimer: number | null = null
let editorFocused = false
let savedSelection: { from: number; to: number } | null = null

function recoveryKey(chapterId: string): string {
  return `arc:chapter-recovery:${chapterId}`
}

function readRecovery(chapterId: string): ChapterRecoverySnapshot | null {
  try {
    const raw = localStorage.getItem(recoveryKey(chapterId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ChapterRecoverySnapshot>
    if (parsed.chapterId !== chapterId || typeof parsed.content !== 'string' || typeof parsed.savedAt !== 'string') {
      return null
    }
    return parsed as ChapterRecoverySnapshot
  } catch {
    return null
  }
}

function writeRecovery(chapterId: string, content: string): void {
  try {
    localStorage.setItem(recoveryKey(chapterId), JSON.stringify({
      chapterId,
      content,
      savedAt: new Date().toISOString()
    } satisfies ChapterRecoverySnapshot))
  } catch {
    // 恢复快照失败不应中断正文编辑。
  }
}

function scheduleRecovery(content: string): void {
  const chapterId = props.chapterId
  if (recoveryTimer !== null) window.clearTimeout(recoveryTimer)
  recoveryTimer = window.setTimeout(() => {
    recoveryTimer = null
    writeRecovery(chapterId, content)
  }, RECOVERY_DEBOUNCE_MS)
}

function checkRecovery(): void {
  const snapshot = readRecovery(props.chapterId)
  const persisted = ensureEditorHtmlContent(props.modelValue)
  emit('recovery-available', snapshot && snapshot.content !== persisted ? snapshot : null)
}

function restoreRecovery(): void {
  const snapshot = readRecovery(props.chapterId)
  if (!snapshot || !editor.value) return
  editor.value.commands.setContent(snapshot.content, { emitUpdate: false })
  emit('update:modelValue', snapshot.content, props.chapterId)
  emit('recovery-available', null)
}

function discardRecovery(): void {
  try {
    localStorage.removeItem(recoveryKey(props.chapterId))
  } catch {
    // ignore
  }
  emit('recovery-available', null)
}

function formatDocument(): 'empty' | 'unchanged' | 'formatted' {
  if (!editor.value) return 'empty'
  if (!editor.value.getText().trim()) return 'empty'

  const result = formatChapterEditorDocument(editor.value.getJSON())
  if (!result.changed) return 'unchanged'

  editor.value.commands.setContent(result.document, { emitUpdate: true })
  editor.value.commands.focus()
  return 'formatted'
}

function handleSelectionUpdate(): void {
  if (!editor.value) return
  const { from, to } = editor.value.state.selection
  if (from === to) {
    if (editorFocused) emit('selection-change', null)
    return
  }
  const text = editor.value.state.doc.textBetween(from, to, '\n')
  if (!text.trim()) {
    if (editorFocused) emit('selection-change', null)
    return
  }
  savedSelection = { from, to }
  emit('selection-change', { chapterId: props.chapterId, text: text.trim() })
}

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    Placeholder.configure({
      placeholder: '开始写作...',
    }),
    CharacterCount,
    Underline,
    EditorSearchExtension,
  ],
  content: ensureEditorHtmlContent(props.modelValue),
  editorProps: {
    attributes: {
      class: 'simple-editor',
      spellcheck: 'false',
    },
  },
  onUpdate: ({ editor: e }) => {
    const html = e.getHTML()
    emit('update:modelValue', html, props.chapterId)
    scheduleRecovery(html)
  },
  onCreate: () => {
    nextTick(checkRecovery)
  },
  onFocus: () => {
    editorFocused = true
  },
  onBlur: () => {
    editorFocused = false
  },
  onSelectionUpdate: () => {
    handleSelectionUpdate()
  },
})

watch(
  () => props.chapterId,
  (nextChapterId, previousChapterId) => {
    if (recoveryTimer !== null) {
      window.clearTimeout(recoveryTimer)
      recoveryTimer = null
      if (editor.value && previousChapterId) writeRecovery(previousChapterId, editor.value.getHTML())
    }
    savedSelection = null
    nextTick(() => {
      if (editor.value) {
        editor.value.commands.setContent(ensureEditorHtmlContent(props.modelValue), { emitUpdate: false })
      }
      if (nextChapterId) checkRecovery()
    })
  }
)

watch(
  () => props.modelValue,
  (next) => {
    if (!editor.value) return
    const normalized = ensureEditorHtmlContent(next || '')
    if (normalized === editor.value.getHTML()) return
    editor.value.commands.setContent(normalized, { emitUpdate: false })
  }
)

watch(
  () => props.insertionRequest?.id,
  () => {
    const request = props.insertionRequest
    if (!request || !editor.value) return
    if (request.chapterId !== props.chapterId) return

    const e = editor.value

    if (request.mode === 'append') {
      const endPos = e.state.doc.content.size - 1
      e.chain().insertContentAt(endPos, request.content).run()
    } else if (request.mode === 'replace-selection') {
      // 优先用编辑器当前实时选区：点击 AI 面板按钮不会改变 ProseMirror 选区，
      // 故 apply 时它仍是用户选中的那段，比单次失效的 savedSelection 可靠。
      const live = e.state.selection
      const range = live.from !== live.to
        ? { from: live.from, to: live.to }
        : savedSelection
      savedSelection = null
      if (range) {
        // 一步区间替换，避免 delete + insert 两步间的位置漂移与块级节点错位。
        e.chain().insertContentAt(range, request.content).run()
      } else {
        // 没有有效选区时退化为光标处插入——绝不追加到文末（那会产生重复段落）。
        e.commands.insertContent(request.content)
      }
    } else if (request.mode === 'cursor') {
      e.commands.insertContent(request.content)
    } else {
      const endPos = e.state.doc.content.size - 1
      e.chain().insertContentAt(endPos, request.content).run()
    }
    emit('consume-insertion', request.id)
  }
)

onBeforeUnmount(() => {
  if (recoveryTimer !== null) {
    window.clearTimeout(recoveryTimer)
    recoveryTimer = null
    if (editor.value) writeRecovery(props.chapterId, editor.value.getHTML())
  }
  editor.value?.destroy()
})

defineExpose({ editor, restoreRecovery, discardRecovery, formatDocument })
</script>

<template>
  <EditorContent v-if="editor" :editor="editor" />
</template>

<style scoped>
:deep(.simple-editor) {
  outline: none;
  min-height: 300px;
  font-size: inherit;
  font-family: inherit;
  line-height: 1.8;
  color: var(--arc-text-primary);
  caret-color: var(--arc-caret-color);
}

:deep(.simple-editor p) {
  margin: 0 0 1.8em;
  text-indent: 2em;
}

:deep(.simple-editor p:last-child) {
  margin-bottom: 0;
}

:deep(.simple-editor p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--arc-text-hint);
  pointer-events: none;
  height: 0;
}

:deep(.simple-editor h1),
:deep(.simple-editor h2),
:deep(.simple-editor h3) {
  text-indent: 0;
  margin-bottom: 12px;
  font-weight: 700;
}

:deep(.search-hl) {
  background: rgba(255, 200, 0, 0.35);
  border-radius: 2px;
}

:deep(.search-hl-cur) {
  background: rgba(255, 140, 0, 0.6);
}
</style>
