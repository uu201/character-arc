<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import CharacterCount from '@tiptap/extension-character-count'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'
import { Heading2, Heading3, Italic, List, ListOrdered, Pilcrow, Quote, Redo2, RotateCcw, Underline as UnderlineIcon } from 'lucide-vue-next'
import { ensureEditorHtmlContent, serializePlainTextToHtml } from '@/features/chapters/editorContent'
import type { ChapterInsertionRequest, ChapterSelectionState } from '@/types/app'

const props = defineProps<{
  chapterId: string
  modelValue: string
  insertionRequest: ChapterInsertionRequest | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  consumeInsertion: [requestId: string]
  selectionChange: [selection: ChapterSelectionState | null]
}>()

const isFocused = ref(false)

type SelectionSnapshotSource = {
  state: {
    selection: {
      from: number
      to: number
      empty: boolean
    }
    doc: {
      textBetween: (from: number, to: number, blockSeparator?: string) => string
    }
  }
}

function emitSelectionSnapshot(instance?: SelectionSnapshotSource | null): void {
  const source = instance ?? editor.value
  if (!source) {
    emit('selectionChange', null)
    return
  }

  const { from, to, empty } = source.state.selection
  if (empty) {
    emit('selectionChange', null)
    return
  }

  const text = source.state.doc.textBetween(from, to, '\n\n').trim()
  emit(
    'selectionChange',
    text
      ? {
          chapterId: props.chapterId,
          text
        }
      : null
  )
}

const editor = useEditor({
  content: ensureEditorHtmlContent(props.modelValue),
  extensions: [
    StarterKit.configure({
      heading: {
        levels: [2, 3]
      }
    }),
    Underline,
    Placeholder.configure({
      placeholder: '从这里开始创作...'
    }),
    CharacterCount
  ],
  editorProps: {
    attributes: {
      class: 'chapter-rich-text arc-scrollbar'
    }
  },
  onFocus: () => {
    isFocused.value = true
  },
  onBlur: ({ editor: instance }) => {
    isFocused.value = false
    emitSelectionSnapshot(instance)
  },
  onSelectionUpdate: ({ editor: instance }) => {
    emitSelectionSnapshot(instance)
  },
  onUpdate: ({ editor: instance }) => {
    const html = instance.getHTML()
    if (html !== props.modelValue) {
      emit('update:modelValue', html)
    }
  }
})

const liveCharacterCount = computed(() => editor.value?.storage.characterCount.characters() ?? 0)

function applyInsertionRequest(request: ChapterInsertionRequest): void {
  const instance = editor.value
  if (!instance || request.chapterId !== props.chapterId) {
    return
  }

  const htmlContent = serializePlainTextToHtml(request.content)

  // Keep AI insertion inside the editor so we can respect the current selection
  // and avoid brittle string slicing against serialized HTML.
  if (request.mode === 'append') {
    instance.chain().focus('end').insertContent(htmlContent).run()
    emit('consumeInsertion', request.id)
    return
  }

  const selection = instance.state.selection
  if (request.mode === 'replace-selection' && !selection.empty) {
    instance.chain().focus().insertContentAt({ from: selection.from, to: selection.to }, htmlContent).run()
    emit('consumeInsertion', request.id)
    return
  }

  instance.chain().focus().insertContent(htmlContent).run()
  emit('consumeInsertion', request.id)
}

// Keep editor state in sync with external changes such as chapter switching or restoring a history snapshot.
watch(
  () => [props.chapterId, props.modelValue] as const,
  ([chapterId, value], previousValue) => {
    const instance = editor.value
    if (!instance) {
      return
    }

    const nextHtml = ensureEditorHtmlContent(value)
    if (nextHtml === instance.getHTML()) {
      return
    }

    instance.commands.setContent(nextHtml, {
      emitUpdate: false
    })

    if (!previousValue || previousValue[0] !== chapterId) {
      instance.commands.focus('end')
      emit('selectionChange', null)
    }
  }
)

// AI insertion is applied inside Tiptap so we can preserve rich-text structure instead of slicing raw HTML strings.
watch(
  () => [props.insertionRequest?.id, props.chapterId, editor.value] as const,
  () => {
    const request = props.insertionRequest
    if (!request) {
      return
    }

    applyInsertionRequest(request)
  }
)

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<template>
  <div class="rich-editor-shell" :class="{ focused: isFocused }">
    <div class="rich-editor-toolbar">
      <div class="toolbar-group">
        <button
          class="toolbar-button"
          :class="{ active: editor?.isActive('paragraph') }"
          type="button"
          @click="editor?.chain().focus().setParagraph().run()"
        >
          <Pilcrow :size="15" />
          <span>正文</span>
        </button>
        <button
          class="toolbar-button"
          :class="{ active: editor?.isActive('heading', { level: 2 }) }"
          type="button"
          @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
        >
          <Heading2 :size="15" />
          <span>二级标题</span>
        </button>
        <button
          class="toolbar-button"
          :class="{ active: editor?.isActive('heading', { level: 3 }) }"
          type="button"
          @click="editor?.chain().focus().toggleHeading({ level: 3 }).run()"
        >
          <Heading3 :size="15" />
          <span>三级标题</span>
        </button>
      </div>

      <div class="toolbar-group compact">
        <button
          class="toolbar-button icon-only"
          :class="{ active: editor?.isActive('italic') }"
          type="button"
          @click="editor?.chain().focus().toggleItalic().run()"
        >
          <Italic :size="15" />
        </button>
        <button
          class="toolbar-button icon-only"
          :class="{ active: editor?.isActive('underline') }"
          type="button"
          @click="editor?.chain().focus().toggleUnderline().run()"
        >
          <UnderlineIcon :size="15" />
        </button>
        <button
          class="toolbar-button icon-only"
          :class="{ active: editor?.isActive('bulletList') }"
          type="button"
          @click="editor?.chain().focus().toggleBulletList().run()"
        >
          <List :size="15" />
        </button>
        <button
          class="toolbar-button icon-only"
          :class="{ active: editor?.isActive('orderedList') }"
          type="button"
          @click="editor?.chain().focus().toggleOrderedList().run()"
        >
          <ListOrdered :size="15" />
        </button>
        <button
          class="toolbar-button icon-only"
          :class="{ active: editor?.isActive('blockquote') }"
          type="button"
          @click="editor?.chain().focus().toggleBlockquote().run()"
        >
          <Quote :size="15" />
        </button>
      </div>

      <div class="toolbar-group compact align-right">
        <span class="toolbar-metric">{{ liveCharacterCount }} 字</span>
        <button
          class="toolbar-button icon-only"
          type="button"
          :disabled="!editor?.can().chain().focus().undo().run()"
          @click="editor?.chain().focus().undo().run()"
        >
          <RotateCcw :size="15" />
        </button>
        <button
          class="toolbar-button icon-only"
          type="button"
          :disabled="!editor?.can().chain().focus().redo().run()"
          @click="editor?.chain().focus().redo().run()"
        >
          <Redo2 :size="15" />
        </button>
      </div>
    </div>

    <EditorContent v-if="editor" :editor="editor" class="rich-editor-content" />
  </div>
</template>

<style scoped>
.rich-editor-shell {
  display: flex;
  min-height: 0;
  height: 100%;
  /* Keep only the editor frame at a stable writing width without freezing the whole page layout. */
  width: min(100%, var(--chapter-editor-width, 880px));
  max-width: var(--chapter-editor-width, 880px);
  margin-right: auto;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #d4d4d8;
  border-radius: 6px;
  background: #ffffff;
  box-shadow: none;
  transition:
    border-color 0.22s ease,
    box-shadow 0.22s ease;
}

.rich-editor-shell.focused {
  border-color: #b8cdf5;
  box-shadow: 0 0 0 1px #b8cdf5;
}

.rich-editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  border-bottom: 1px solid #d4d4d8;
  background: #f7f7f7;
  padding: 8px 10px;
}

.toolbar-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.toolbar-group.compact {
  gap: 6px;
}

.toolbar-group.align-right {
  margin-left: auto;
}

.toolbar-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid #d4d4d8;
  border-radius: 4px;
  background: #ffffff;
  color: #5f6368;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 10px;
  transition:
    border-color 0.18s ease,
    color 0.18s ease,
    background 0.18s ease;
}

.toolbar-button:hover:not(:disabled) {
  border-color: #c7c7cf;
  background: #fafafa;
  color: var(--arc-primary);
}

.toolbar-button.active {
  border-color: #b8cdf5;
  background: #eaf2ff;
  color: #1f4ea3;
}

.toolbar-button.icon-only {
  width: 30px;
  height: 30px;
  justify-content: center;
  padding: 0;
}

.toolbar-button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
  transform: none;
}

.toolbar-metric {
  color: #6a7078;
  font-size: 12px;
  font-weight: 600;
  margin-right: 4px;
}

.rich-editor-content {
  /* Lock the editor viewport to the available column height so long chapters scroll internally. */
  min-height: 0;
  height: 100%;
  flex: 1;
}

.rich-editor-content :deep(.chapter-rich-text) {
  height: 100%;
  min-height: 0;
  color: #333336;
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: 16px;
  line-height: 1.85;
  letter-spacing: 0;
  outline: none;
  overflow-y: auto;
  padding: 16px 18px 20px;
}

.rich-editor-content :deep(.chapter-rich-text p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: #9ca3af;
  pointer-events: none;
}

.rich-editor-content :deep(.chapter-rich-text h2),
.rich-editor-content :deep(.chapter-rich-text h3) {
  color: #202124;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1.3;
  margin: 1em 0 0.5em;
}

.rich-editor-content :deep(.chapter-rich-text h2) {
  font-size: 22px;
}

.rich-editor-content :deep(.chapter-rich-text h3) {
  font-size: 18px;
}

.rich-editor-content :deep(.chapter-rich-text p) {
  margin: 0 0 1.1em;
}

.rich-editor-content :deep(.chapter-rich-text ul),
.rich-editor-content :deep(.chapter-rich-text ol) {
  padding-left: 1.5em;
  margin: 0 0 1.2em;
}

.rich-editor-content :deep(.chapter-rich-text blockquote) {
  border-left: 3px solid #d4d4d8;
  color: #475569;
  margin: 0 0 1.2em;
  padding-left: 12px;
}

@media (max-width: 900px) {
  .toolbar-group.align-right {
    width: 100%;
    margin-left: 0;
    justify-content: flex-end;
  }
}

@media (max-width: 720px) {
  .rich-editor-toolbar {
    padding: 12px;
  }

  .toolbar-group,
  .toolbar-group.align-right {
    width: 100%;
    justify-content: flex-start;
  }

  .rich-editor-content :deep(.chapter-rich-text) {
    font-size: 15px;
    padding: 14px 14px 18px;
  }
}
</style>
