<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, Replace, Search, X } from 'lucide-vue-next'
import type { Editor } from '@tiptap/vue-3'

const props = defineProps<{
  visible: boolean
  editor: Editor | null
  initialTerm?: string
  scrollContainer?: HTMLElement | null
}>()

const emit = defineEmits<{
  close: []
}>()

const term = ref('')
const replacement = ref('')
const caseSensitive = ref(false)
const showReplace = ref(false)
const findInputRef = ref<HTMLInputElement | null>(null)

// editor.storage 不是 Vue 响应式对象，必须用本地 ref + transaction 监听同步
const matchCount = ref(0)
const currentMatchIndex = ref(0)

function syncFromStorage(): void {
  const e = props.editor
  if (!e) {
    matchCount.value = 0
    currentMatchIndex.value = 0
    return
  }
  const storage = e.storage.editorSearch
  matchCount.value = storage?.matches.length ?? 0
  currentMatchIndex.value = matchCount.value === 0 ? 0 : (storage?.currentIndex ?? 0) + 1
}

const onEditorUpdate = (): void => {
  syncFromStorage()
}

function attachEditor(e: Editor | null): void {
  if (!e) return
  e.on('transaction', onEditorUpdate)
}

function detachEditor(e: Editor | null): void {
  if (!e) return
  e.off('transaction', onEditorUpdate)
}

function refreshSearch(): void {
  if (!props.editor) return
  props.editor.commands.setSearchTerm(term.value, caseSensitive.value)
  syncFromStorage()
  if (matchCount.value > 0) scrollToCurrentMatch()
}

function scrollToCurrentMatch(): void {
  const e = props.editor
  const container = props.scrollContainer ?? null
  if (!e || !container) return
  const storage = e.storage.editorSearch
  const match = storage?.matches[storage?.currentIndex ?? 0]
  if (!match) return
  try {
    // coordsAtPos 返回的是相对视口的坐标，更精确
    const coords = e.view.coordsAtPos(match.from)
    const containerRect = container.getBoundingClientRect()
    const offsetFromTop = coords.top - containerRect.top
    const target = offsetFromTop - container.clientHeight / 2 + (coords.bottom - coords.top) / 2
    const desired = container.scrollTop + target
    container.scrollTo({ top: Math.max(0, desired), behavior: 'smooth' })
  } catch {
    /* ignore */
  }
}

function findNext(): void {
  if (!props.editor || !term.value) return
  props.editor.commands.nextSearchMatch()
  syncFromStorage()
  scrollToCurrentMatch()
  // 保持焦点在搜索框，方便连续按 Enter
  findInputRef.value?.focus()
}

function findPrev(): void {
  if (!props.editor || !term.value) return
  props.editor.commands.prevSearchMatch()
  syncFromStorage()
  scrollToCurrentMatch()
  findInputRef.value?.focus()
}

function replaceCurrent(): void {
  if (!props.editor || !term.value) return
  if (matchCount.value === 0) return
  props.editor.commands.replaceCurrentMatch(replacement.value)
  // 替换后 doc 改变，plugin 已自动重算 matches；同步本地 ref 并跳到下一个
  nextTick(() => {
    syncFromStorage()
    if (matchCount.value > 0) scrollToCurrentMatch()
  })
}

function replaceAll(): void {
  if (!props.editor || !term.value) return
  if (matchCount.value === 0) return
  props.editor.commands.replaceAllMatches(replacement.value)
  nextTick(() => {
    syncFromStorage()
  })
}

function clearSearchKeepScroll(): void {
  const editor = props.editor
  if (!editor) return
  const container = props.scrollContainer ?? null
  const savedTop = container?.scrollTop ?? 0
  editor.commands.setSearchTerm('', caseSensitive.value)
  // dispatch 可能触发 PM 的 selection-into-view，强制还原滚动位置
  if (container) {
    container.scrollTop = savedTop
    requestAnimationFrame(() => {
      if (container.scrollTop !== savedTop) container.scrollTop = savedTop
    })
  }
}

function handleClose(): void {
  clearSearchKeepScroll()
  emit('close')
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    handleClose()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (e.shiftKey) findPrev()
    else findNext()
  }
}

watch(
  () => props.editor,
  (next, prev) => {
    detachEditor(prev ?? null)
    attachEditor(next)
    syncFromStorage()
  },
  { immediate: true }
)

watch(
  () => props.visible,
  (v) => {
    if (v) {
      if (props.initialTerm) {
        term.value = props.initialTerm
      }
      nextTick(() => {
        findInputRef.value?.focus()
        findInputRef.value?.select()
        if (term.value) refreshSearch()
      })
    } else {
      clearSearchKeepScroll()
    }
  }
)

watch(term, () => {
  if (props.visible) refreshSearch()
})

watch(caseSensitive, () => {
  if (props.visible) refreshSearch()
})

onBeforeUnmount(() => {
  detachEditor(props.editor)
})

defineExpose({
  focus: () => {
    findInputRef.value?.focus()
    findInputRef.value?.select()
  },
  setTerm: (next: string) => {
    term.value = next
    nextTick(() => {
      findInputRef.value?.focus()
      findInputRef.value?.select()
    })
  },
})
</script>

<template>
  <Transition name="arc-find-fade">
    <div v-if="visible" class="arc-find-bar" @keydown="handleKeydown">
      <div class="find-row">
        <div class="find-input-wrap">
          <Search :size="13" class="find-icon" />
          <input
            ref="findInputRef"
            v-model="term"
            class="find-input"
            placeholder="查找"
            spellcheck="false"
          />
          <span class="match-count">
            {{ matchCount === 0 ? '0/0' : `${currentMatchIndex}/${matchCount}` }}
          </span>
        </div>
        <button class="find-btn" :disabled="!matchCount" title="上一个 (Shift+Enter)" @click="findPrev">
          <ChevronUp :size="14" />
        </button>
        <button class="find-btn" :disabled="!matchCount" title="下一个 (Enter)" @click="findNext">
          <ChevronDown :size="14" />
        </button>
        <button
          class="find-btn"
          :class="{ active: caseSensitive }"
          title="区分大小写"
          @click="caseSensitive = !caseSensitive"
        >
          Aa
        </button>
        <button
          class="find-btn"
          :class="{ active: showReplace }"
          title="替换"
          @click="showReplace = !showReplace"
        >
          <Replace :size="14" />
        </button>
        <button class="find-btn close-btn" title="关闭 (Esc)" @click="handleClose">
          <X :size="14" />
        </button>
      </div>
      <div v-if="showReplace" class="replace-row">
        <div class="find-input-wrap">
          <input
            v-model="replacement"
            class="find-input"
            placeholder="替换为"
            spellcheck="false"
          />
        </div>
        <button class="find-btn text-btn" :disabled="!matchCount" @click="replaceCurrent">
          替换
        </button>
        <button class="find-btn text-btn" :disabled="!matchCount" @click="replaceAll">
          全部替换
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.arc-find-bar {
  position: absolute;
  top: 56px;
  right: 24px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  min-width: 360px;
}

.find-row,
.replace-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.find-input-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--arc-bg-body);
  border: 1px solid var(--arc-border);
  border-radius: 5px;
}

.find-input-wrap:focus-within {
  border-color: var(--arc-primary);
}

.find-icon {
  color: var(--arc-text-hint);
  flex-shrink: 0;
}

.find-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 12px;
  color: var(--arc-text-primary);
  min-width: 0;
}

.match-count {
  font-size: 11px;
  color: var(--arc-text-hint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.find-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
  transition: 0.15s;
}

.find-btn:hover:not(:disabled) {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.find-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.find-btn.active {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.find-btn.text-btn {
  padding: 0 10px;
}

.find-btn.close-btn:hover {
  background: var(--arc-danger-soft, rgba(220, 50, 50, 0.1));
  color: var(--arc-danger, #dc3232);
}

.arc-find-fade-enter-active,
.arc-find-fade-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.arc-find-fade-enter-from,
.arc-find-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
