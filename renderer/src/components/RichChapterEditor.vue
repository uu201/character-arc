<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import CharacterCount from '@tiptap/extension-character-count'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'
import { ChevronDown, ChevronUp, Heading2, Heading3, Italic, List, ListOrdered, Pilcrow, Quote, Redo2, RotateCcw, Search, Underline as UnderlineIcon, X } from 'lucide-vue-next'
import { EditorSearchExtension } from '@/features/chapters/editorSearch'
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
  shortcut: [payload: { action: 'save-draft' | 'save-version' | 'search' }]
}>()

const isFocused = ref(false)

// ── 搜索/替换状态 ─────────────────────────────
const showSearch = ref(false)
const searchTerm = ref('')
const replaceTerm = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const matchCount = ref(0)
const currentMatchIndex = ref(0)

function openSearch() {
  showSearch.value = true
  nextTick(() => searchInputRef.value?.focus())
}

function closeSearch() {
  showSearch.value = false
  searchTerm.value = ''
  replaceTerm.value = ''
  matchCount.value = 0
  currentMatchIndex.value = 0
  editor.value?.commands.setSearchTerm('')
  editor.value?.commands.focus()
}

function syncSearchRefs() {
  const storage = editor.value?.storage.editorSearch
  matchCount.value = storage?.matches?.length ?? 0
  currentMatchIndex.value = storage?.currentIndex ?? 0
}

function handleSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { closeSearch(); return }
  if (e.key === 'Enter') {
    if (e.shiftKey) { editor.value?.commands.prevSearchMatch() } else { editor.value?.commands.nextSearchMatch() }
    syncSearchRefs()
  }
}

function handleReplaceKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { closeSearch() }
  if (e.key === 'Enter') { replaceOne() }
}

function replaceOne() {
  editor.value?.commands.replaceCurrentMatch(replaceTerm.value)
  syncSearchRefs()
}

function replaceAll() {
  editor.value?.commands.replaceAllMatches(replaceTerm.value)
  syncSearchRefs()
}

watch(searchTerm, (term) => {
  editor.value?.commands.setSearchTerm(term)
  syncSearchRefs()
})

// ── 选区快照 ──────────────────────────────────
type SelectionSnapshotSource = {
  state: {
    selection: { from: number; to: number; empty: boolean }
    doc: { textBetween: (from: number, to: number, blockSeparator?: string) => string }
  }
}

function emitSelectionSnapshot(instance?: SelectionSnapshotSource | null): void {
  const source = instance ?? editor.value
  if (!source) { emit('selectionChange', null); return }
  const { from, to, empty } = source.state.selection
  if (empty) { emit('selectionChange', null); return }
  const text = source.state.doc.textBetween(from, to, '\n\n').trim()
  emit('selectionChange', text ? { chapterId: props.chapterId, text } : null)
}

// ── TipTap 编辑器 ─────────────────────────────
const editor = useEditor({
  content: ensureEditorHtmlContent(props.modelValue),
  extensions: [
    StarterKit.configure({ heading: { levels: [2, 3] } }),
    Underline,
    Placeholder.configure({ placeholder: '从这里开始创作...' }),
    CharacterCount,
    EditorSearchExtension
  ],
  editorProps: {
    attributes: { class: 'chapter-rich-text arc-scrollbar' },
    handleKeyDown(_, event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault()
        openSearch()
        emit('shortcut', { action: 'search' })
        return true
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        emit('shortcut', { action: event.shiftKey ? 'save-version' : 'save-draft' })
        return true
      }
      return false
    }
  },
  onFocus: () => { isFocused.value = true },
  onBlur: ({ editor: instance }) => {
    isFocused.value = false
    emitSelectionSnapshot(instance)
  },
  onSelectionUpdate: ({ editor: instance }) => { emitSelectionSnapshot(instance) },
  onUpdate: ({ editor: instance }) => {
    const html = instance.getHTML()
    if (html !== props.modelValue) emit('update:modelValue', html)
  }
})

const liveCharacterCount = computed(() => editor.value?.storage.characterCount.characters() ?? 0)

function applyInsertionRequest(request: ChapterInsertionRequest): void {
  const instance = editor.value
  if (!instance || request.chapterId !== props.chapterId) return
  const htmlContent = serializePlainTextToHtml(request.content)
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

watch(
  () => [props.chapterId, props.modelValue] as const,
  ([chapterId, value], previousValue) => {
    const instance = editor.value
    if (!instance) return
    const nextHtml = ensureEditorHtmlContent(value)
    if (nextHtml === instance.getHTML()) return
    instance.commands.setContent(nextHtml, { emitUpdate: false })
    if (!previousValue || previousValue[0] !== chapterId) {
      instance.commands.focus('end')
      emit('selectionChange', null)
    }
  }
)

watch(
  () => [props.insertionRequest?.id, props.chapterId, editor.value] as const,
  () => {
    const request = props.insertionRequest
    if (!request) return
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
          :title="'搜索 (Ctrl+F)'"
          @click="openSearch"
        >
          <Search :size="15" />
        </button>
        <button
          class="toolbar-button icon-only"
          type="button"
          :title="'撤销'"
          :disabled="!editor?.can().chain().focus().undo().run()"
          @click="editor?.chain().focus().undo().run()"
        >
          <RotateCcw :size="15" />
        </button>
        <button
          class="toolbar-button icon-only"
          type="button"
          :title="'重做'"
          :disabled="!editor?.can().chain().focus().redo().run()"
          @click="editor?.chain().focus().redo().run()"
        >
          <Redo2 :size="15" />
        </button>
        <span class="toolbar-shortcuts">Ctrl+S 保存，Ctrl+Shift+S 存版本</span>
      </div>
    </div>

    <!-- 搜索/替换栏 -->
    <Transition name="search-bar">
      <div v-if="showSearch" class="search-bar">
        <div class="search-row">
          <div class="search-input-wrap">
            <Search :size="13" class="search-icon" />
            <input
              ref="searchInputRef"
              v-model="searchTerm"
              class="search-input"
              type="text"
              placeholder="搜索..."
              @keydown="handleSearchKeydown"
            />
            <span v-if="searchTerm" class="search-count">
              {{ matchCount ? `${currentMatchIndex + 1}/${matchCount}` : '无结果' }}
            </span>
          </div>
          <button class="search-nav-btn" title="上一个 (Shift+Enter)" :disabled="!matchCount" @click="editor?.commands.prevSearchMatch(); syncSearchRefs()">
            <ChevronUp :size="14" />
          </button>
          <button class="search-nav-btn" title="下一个 (Enter)" :disabled="!matchCount" @click="editor?.commands.nextSearchMatch(); syncSearchRefs()">
            <ChevronDown :size="14" />
          </button>
          <button class="search-close-btn" title="关闭 (Esc)" @click="closeSearch">
            <X :size="14" />
          </button>
        </div>
        <div class="search-row">
          <input
            v-model="replaceTerm"
            class="search-input replace-input"
            type="text"
            placeholder="替换为..."
            @keydown="handleReplaceKeydown"
          />
          <button class="search-action-btn" :disabled="!matchCount" @click="replaceOne">替换</button>
          <button class="search-action-btn" :disabled="!matchCount" @click="replaceAll">全部替换</button>
        </div>
      </div>
    </Transition>

    <EditorContent v-if="editor" :editor="editor" class="rich-editor-content" />
  </div>
</template>

<style scoped>
.rich-editor-shell {
  display: flex;
  min-height: 0;
  height: 100%;
  width: 100%;
  max-width: none;
  margin-right: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  box-shadow: none;
  transition:
    border-color 0.22s ease,
    box-shadow 0.22s ease;
}

.rich-editor-shell.focused {
  border-color: color-mix(in srgb, var(--arc-primary) 48%, var(--arc-border));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--arc-primary) 48%, var(--arc-border));
}

.rich-editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-sidebar);
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
  border: 1px solid var(--arc-border);
  border-radius: 4px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
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
  border-color: var(--arc-border-strong);
  background: var(--arc-bg-weak);
  color: var(--arc-primary);
}

.toolbar-button.active {
  border-color: color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-bg-surface));
  color: var(--arc-primary);
}

.toolbar-button.icon-only {
  width: 30px;
  height: 30px;
  justify-content: center;
  padding: 0;
}

.toolbar-shortcuts {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.toolbar-button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
  transform: none;
}

.toolbar-metric {
  color: var(--arc-text-hint);
  font-size: 12px;
  font-weight: 600;
  margin-right: 4px;
}

/* ── 搜索/替换栏 ── */
.search-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-sidebar);
  padding: 8px 10px;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.search-input-wrap {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 6px;
  border: 1px solid var(--arc-border);
  border-radius: 4px;
  background: var(--arc-bg-surface);
  padding: 0 8px;
}

.search-icon {
  color: var(--arc-text-hint);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  border: none;
  background: transparent;
  color: var(--arc-text-primary);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.search-input::placeholder {
  color: var(--arc-text-hint);
}

.replace-input {
  flex: 1;
  height: 30px;
  border: 1px solid var(--arc-border);
  border-radius: 4px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  font: inherit;
  font-size: 13px;
  outline: none;
  padding: 0 8px;
}

.replace-input:focus {
  border-color: color-mix(in srgb, var(--arc-primary) 48%, var(--arc-border));
}

.search-count {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.search-nav-btn,
.search-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--arc-border);
  border-radius: 4px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.search-nav-btn:hover:not(:disabled),
.search-close-btn:hover {
  border-color: var(--arc-border-strong);
  color: var(--arc-primary);
}

.search-nav-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.search-action-btn {
  height: 30px;
  border: 1px solid var(--arc-border);
  border-radius: 4px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 0 10px;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.search-action-btn:hover:not(:disabled) {
  border-color: var(--arc-border-strong);
  color: var(--arc-primary);
}

.search-action-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

/* 搜索栏展开动画 */
.search-bar-enter-active,
.search-bar-leave-active {
  transition: all 0.18s ease;
  overflow: hidden;
}

.search-bar-enter-from,
.search-bar-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.search-bar-enter-to,
.search-bar-leave-from {
  max-height: 120px;
  opacity: 1;
}

/* ── 搜索高亮（全局，因为 TipTap 编辑器内容在 :deep 范围外无法穿透） ── */
.rich-editor-content :deep(.search-hl) {
  background: color-mix(in srgb, #f59e0b 35%, transparent);
  border-radius: 2px;
}

.rich-editor-content :deep(.search-hl-cur) {
  background: color-mix(in srgb, #f59e0b 70%, transparent);
  outline: 1px solid #f59e0b;
}

/* ── 编辑器内容区 ── */
.rich-editor-content {
  min-height: 0;
  height: 100%;
  flex: 1;
}

.rich-editor-content :deep(.chapter-rich-text) {
  height: 100%;
  min-height: 0;
  color: var(--arc-text-primary);
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
  color: var(--arc-text-hint);
  pointer-events: none;
}

.rich-editor-content :deep(.chapter-rich-text h2),
.rich-editor-content :deep(.chapter-rich-text h3) {
  color: var(--arc-text-primary);
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
  border-left: 3px solid var(--arc-border-strong);
  color: var(--arc-text-secondary);
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
