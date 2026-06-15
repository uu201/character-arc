<script setup lang="ts">
import { nextTick, onBeforeUnmount, watch } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import Underline from '@tiptap/extension-underline'
import { ensureEditorHtmlContent } from '@/features/chapters/editorContent'
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

const EMIT_DEBOUNCE_MS = 600
let emitTimer: number | null = null
let pendingEmit = false
let editorFocused = false
let savedSelection: { from: number; to: number } | null = null

function flushEmit(): void {
  if (emitTimer !== null) {
    window.clearTimeout(emitTimer)
    emitTimer = null
  }
  if (pendingEmit && editor.value) {
    pendingEmit = false
    emit('update:modelValue', editor.value.getHTML())
  }
}

function scheduleEmit(html: string): void {
  pendingEmit = true
  if (emitTimer !== null) window.clearTimeout(emitTimer)
  emitTimer = window.setTimeout(() => {
    emitTimer = null
    pendingEmit = false
    emit('update:modelValue', html)
  }, EMIT_DEBOUNCE_MS)
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
  ],
  content: ensureEditorHtmlContent(props.modelValue),
  editorProps: {
    attributes: {
      class: 'simple-editor',
      spellcheck: 'false',
    },
  },
  onUpdate: ({ editor: e }) => {
    scheduleEmit(e.getHTML())
  },
  onFocus: () => {
    editorFocused = true
  },
  onBlur: () => {
    editorFocused = false
    flushEmit()
  },
  onSelectionUpdate: () => {
    handleSelectionUpdate()
  },
})

watch(
  () => props.chapterId,
  () => {
    flushEmit()
    savedSelection = null
    nextTick(() => {
      if (editor.value) {
        editor.value.commands.setContent(ensureEditorHtmlContent(props.modelValue), { emitUpdate: false })
      }
    })
  }
)

watch(
  () => props.modelValue,
  (next) => {
    if (!editor.value) return
    if (pendingEmit) return
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

    flushEmit()
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

    emit('update:modelValue', e.getHTML())
    emit('consume-insertion', request.id)
  }
)

onBeforeUnmount(() => {
  flushEmit()
  editor.value?.destroy()
})
</script>

<template>
  <EditorContent v-if="editor" :editor="editor" />
</template>

<style scoped>
:deep(.simple-editor) {
  outline: none;
  min-height: 300px;
  font-size: inherit;
  line-height: 1.8;
  color: var(--arc-text-primary);
  caret-color: var(--arc-caret-color);
}

:deep(.simple-editor p) {
  margin-bottom: 16px;
  text-indent: 2em;
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
</style>
