<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Clipboard, ClipboardPaste, Copy, FileText, Scissors, Search, TextCursor } from 'lucide-vue-next'

export interface EditorContextMenuItem {
  id: string
  label: string
  icon: 'copy' | 'cut' | 'paste' | 'paste-plain' | 'select-all' | 'find'
  disabled?: boolean
  separatorBefore?: boolean
}

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  hasSelection: boolean
}>()

const emit = defineEmits<{
  close: []
  action: [id: string]
}>()

const menuRef = ref<HTMLDivElement | null>(null)
const adjustedX = ref(0)
const adjustedY = ref(0)

const items = computed<EditorContextMenuItem[]>(() => [
  { id: 'copy', label: '复制', icon: 'copy', disabled: !props.hasSelection },
  { id: 'cut', label: '剪切', icon: 'cut', disabled: !props.hasSelection },
  { id: 'paste', label: '粘贴', icon: 'paste' },
  { id: 'paste-plain', label: '粘贴为纯文本', icon: 'paste-plain' },
  { id: 'select-all', label: '全选', icon: 'select-all', separatorBefore: true },
  { id: 'find', label: '查找…', icon: 'find', separatorBefore: true },
])

function handleClickOutside(e: MouseEvent): void {
  if (!menuRef.value) return
  if (!menuRef.value.contains(e.target as Node)) {
    emit('close')
  }
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

function handleAction(item: EditorContextMenuItem): void {
  if (item.disabled) return
  emit('action', item.id)
  emit('close')
}

function adjustPosition(): void {
  const el = menuRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  let x = props.x
  let y = props.y
  if (x + rect.width + 8 > vw) x = vw - rect.width - 8
  if (y + rect.height + 8 > vh) y = vh - rect.height - 8
  adjustedX.value = Math.max(4, x)
  adjustedY.value = Math.max(4, y)
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      adjustedX.value = props.x
      adjustedY.value = props.y
      nextTick(adjustPosition)
      document.addEventListener('mousedown', handleClickOutside, true)
      document.addEventListener('keydown', handleKeydown)
    } else {
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('keydown', handleKeydown)
    }
  }
)

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleClickOutside, true)
  document.removeEventListener('keydown', handleKeydown)
})

const iconMap = {
  copy: Copy,
  cut: Scissors,
  paste: Clipboard,
  'paste-plain': ClipboardPaste,
  'select-all': TextCursor,
  find: Search,
  document: FileText,
} as const
</script>

<template>
  <Teleport to="body">
    <Transition name="arc-ctx-fade">
      <div
        v-if="visible"
        ref="menuRef"
        class="arc-ctx-menu"
        :style="{ top: adjustedY + 'px', left: adjustedX + 'px' }"
      >
        <template v-for="item in items" :key="item.id">
          <div v-if="item.separatorBefore" class="arc-ctx-divider" />
          <button
            class="arc-ctx-item"
            :class="{ disabled: item.disabled }"
            :disabled="item.disabled"
            @click="handleAction(item)"
          >
            <component :is="iconMap[item.icon]" :size="14" class="arc-ctx-icon" />
            <span class="arc-ctx-label">{{ item.label }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.arc-ctx-menu {
  position: fixed;
  z-index: 10000;
  min-width: 180px;
  padding: 4px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
}

.arc-ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--arc-text-primary);
  font-size: 12px;
  text-align: left;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.12s;
}

.arc-ctx-item:hover:not(.disabled) {
  background: var(--arc-bg-surface-hover);
}

.arc-ctx-item.disabled {
  color: var(--arc-text-hint);
  cursor: not-allowed;
}

.arc-ctx-icon {
  color: var(--arc-text-secondary);
  flex-shrink: 0;
}

.arc-ctx-item.disabled .arc-ctx-icon {
  color: var(--arc-text-hint);
}

.arc-ctx-label {
  flex: 1;
}

.arc-ctx-divider {
  height: 1px;
  background: var(--arc-border);
  margin: 4px 2px;
}

.arc-ctx-fade-enter-active,
.arc-ctx-fade-leave-active {
  transition: opacity 0.12s, transform 0.12s;
}

.arc-ctx-fade-enter-from,
.arc-ctx-fade-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
</style>
