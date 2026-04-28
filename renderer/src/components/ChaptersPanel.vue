<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Globe2, PenTool, Plus, Sparkles } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'

const props = defineProps<{
  searchQuery?: string
}>()

const appStore = useAppStore()
const activeHelper = ref<'polish' | 'world' | null>(null)
const saveState = ref<'saved' | 'saving'>('saved')
const polishPrompt = ref('优化当前段落的氛围感和节奏。')
let saveTimer: number | null = null

const currentWordCount = computed(() => {
  const content = appStore.selectedChapter?.content.trim() ?? ''
  if (!content) {
    return 0
  }

  return content.length
})

const helperTitle = computed(() => (activeHelper.value === 'polish' ? 'AI 润色建议' : '设定查阅'))
const helperDescription = computed(() =>
  activeHelper.value === 'polish'
    ? '这里先提供一个轻量交互反馈，后续接入真实模型后可替换为流式润色结果。'
    : '这里预留了世界观查阅入口，后续可以挂接角色、地理和设定词条检索。'
)
const helperBody = computed(() =>
  activeHelper.value === 'polish'
    ? '建议把动作句与环境句交错排布，先压低外部噪音，再推角色的身体感知。这样能让“苏醒”场景更有压迫感和电影感。'
    : '当前章节与“夜城酸雨”“义体排异”“底层回收站”三个设定关联度最高，适合在写作过程中快速复查。'
)
const filteredChapters = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase() ?? ''
  if (!query) {
    return appStore.chapters
  }

  return appStore.chapters.filter((chapter) =>
    `${chapter.title} ${chapter.content}`.toLowerCase().includes(query)
  )
})

function toggleHelper(panel: 'polish' | 'world'): void {
  activeHelper.value = activeHelper.value === panel ? null : panel
}

watch(
  () => [appStore.selectedChapter?.title, appStore.selectedChapter?.content],
  () => {
    if (!appStore.selectedChapter) {
      return
    }

    saveState.value = 'saving'

    // 用一个短防抖模拟真实的自动保存节奏，避免每个按键都刷新状态文字。
    if (saveTimer) {
      window.clearTimeout(saveTimer)
    }

    saveTimer = window.setTimeout(() => {
      saveState.value = 'saved'
    }, 420)
  },
  { deep: true }
)

onBeforeUnmount(() => {
  if (saveTimer) {
    window.clearTimeout(saveTimer)
  }
})
</script>

<template>
  <section class="chapters-layout">
    <div class="section-head">
      <div>
        <h2>章节创作</h2>
        <p>专注写作模式，AI 随时为你提供灵感。</p>
      </div>
    </div>

    <div class="chapters-shell">
      <aside class="chapter-sidebar">
        <div class="chapter-side-head">
          <span>卷一：苏醒之日</span>
          <button class="mini-icon">
            <Plus :size="15" />
          </button>
        </div>

        <div class="chapter-items arc-scrollbar">
          <button
            v-for="chapter in filteredChapters"
            :key="chapter.id"
            class="chapter-pill"
            :class="{ active: appStore.selectedChapterId === chapter.id }"
            @click="appStore.selectChapter(chapter.id)"
          >
            {{ chapter.title }}
          </button>
        </div>
      </aside>

      <section class="editor-shell">
        <div class="editor-floating-actions">
          <button
            class="tool-badge"
            :class="{ active: activeHelper === 'polish' }"
            title="AI 润色"
            @click="toggleHelper('polish')"
          >
            <Sparkles :size="16" />
          </button>
          <button
            class="tool-badge neutral"
            :class="{ active: activeHelper === 'world' }"
            title="设定查阅"
            @click="toggleHelper('world')"
          >
            <Globe2 :size="16" />
          </button>
        </div>

        <Transition name="helper-fade">
          <div v-if="activeHelper" class="helper-card">
            <div class="helper-head">
              <strong>{{ helperTitle }}</strong>
              <span>{{ helperDescription }}</span>
            </div>

            <template v-if="activeHelper === 'polish'">
              <label class="helper-label">润色指令</label>
              <input v-model="polishPrompt" class="helper-input" type="text" />
            </template>

            <p class="helper-copy">{{ helperBody }}</p>
          </div>
        </Transition>

        <input
          class="chapter-title"
          :value="appStore.selectedChapter?.title"
          @input="appStore.updateChapterTitle(($event.target as HTMLInputElement).value)"
        />

        <textarea
          class="chapter-editor"
          :value="appStore.selectedChapter?.content"
          placeholder="从这里开始创作..."
          @input="appStore.updateChapterContent(($event.target as HTMLTextAreaElement).value)"
        ></textarea>

        <div class="editor-status">
          <span>{{ currentWordCount }} 字</span>
          <span class="status-pill">
            <PenTool :size="12" />
            {{ saveState === 'saving' ? '自动保存中...' : '已保存草稿' }}
          </span>
        </div>
      </section>
    </div>

    <div v-if="filteredChapters.length === 0" class="empty-state">
      没有匹配“{{ props.searchQuery }}”的章节内容。
    </div>
  </section>
</template>

<style scoped>
.chapters-layout {
  max-width: 1180px;
  margin: 0 auto;
}

.section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  margin-bottom: 32px;
  gap: 16px;
}

.section-head h2 {
  margin: 0 0 8px;
  font-size: clamp(30px, 3.4vw, 38px);
  font-weight: 650;
  letter-spacing: -0.04em;
}

.section-head p {
  margin: 0;
  color: #86868b;
  font-size: 15px;
}

.chapters-shell {
  display: flex;
  gap: 24px;
  min-height: 680px;
}

.chapter-sidebar {
  display: flex;
  width: clamp(220px, 24vw, 260px);
  flex-shrink: 0;
  flex-direction: column;
  border: 1px solid rgba(243, 244, 246, 0.9);
  border-radius: 28px;
  background: rgba(245, 245, 247, 0.5);
  padding: 16px;
}

.chapter-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #6b7280;
  font-size: 13px;
  font-weight: 650;
  padding: 0 6px;
  margin-bottom: 16px;
}

.mini-icon {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
}

.mini-icon:hover {
  background: rgba(0, 0, 0, 0.04);
  color: var(--arc-primary);
}

.chapter-items {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding-right: 6px;
}

.chapter-pill {
  width: 100%;
  border: none;
  border-radius: 16px;
  background: transparent;
  color: #515154;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  padding: 14px 16px;
  text-align: left;
  transition: all 0.22s ease;
}

.chapter-pill:hover {
  background: rgba(0, 0, 0, 0.04);
}

.chapter-pill.active {
  background: white;
  color: var(--arc-primary);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.editor-shell {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  border: 1px solid rgba(243, 244, 246, 0.9);
  border-radius: 28px;
  background: white;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.04);
  padding: 44px clamp(26px, 4vw, 54px) 28px;
}

.editor-floating-actions {
  position: absolute;
  top: 22px;
  right: 22px;
  display: flex;
  gap: 10px;
}

.tool-badge {
  display: inline-flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, white);
  color: var(--arc-primary);
  cursor: pointer;
  transition: all 0.22s ease;
}

.tool-badge:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--arc-primary) 16%, white);
}

.tool-badge.active {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--arc-primary) 12%, transparent);
}

.tool-badge.neutral {
  background: #f9fafb;
  color: #6b7280;
}

.tool-badge.neutral.active {
  background: color-mix(in srgb, var(--arc-primary) 8%, white);
  color: var(--arc-primary);
}

.helper-card {
  margin-bottom: 18px;
  border: 1px solid rgba(229, 231, 235, 0.92);
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(255, 255, 255, 0.98));
  padding: 16px 18px;
}

.helper-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}

.helper-head strong {
  font-size: 14px;
}

.helper-head span {
  color: #86868b;
  font-size: 12px;
  line-height: 1.6;
}

.helper-label {
  display: block;
  margin-bottom: 8px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
}

.helper-input {
  width: 100%;
  border: 1px solid rgba(209, 213, 219, 0.72);
  border-radius: 14px;
  background: white;
  outline: none;
  padding: 12px 14px;
  margin-bottom: 12px;
}

.helper-input:focus {
  border-color: color-mix(in srgb, var(--arc-primary) 24%, white);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--arc-primary) 10%, transparent);
}

.helper-copy {
  margin: 0;
  color: #4b5563;
  font-size: 13px;
  line-height: 1.75;
}

.chapter-title {
  width: 100%;
  border: none;
  background: transparent;
  color: #1d1d1f;
  font-size: clamp(30px, 4vw, 42px);
  font-weight: 650;
  letter-spacing: -0.04em;
  margin-bottom: 28px;
  outline: none;
}

.chapter-editor {
  flex: 1;
  width: 100%;
  min-height: 420px;
  border: none;
  resize: none;
  background: transparent;
  color: #333336;
  font-size: clamp(16px, 2vw, 18px);
  line-height: 1.95;
  outline: none;
}

.editor-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 16px;
  margin-top: 16px;
  border-top: 1px solid rgba(243, 244, 246, 0.9);
  color: #86868b;
  font-size: 12px;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.empty-state {
  margin-top: 18px;
  border: 1px dashed rgba(209, 213, 219, 0.95);
  border-radius: 22px;
  color: #86868b;
  font-size: 14px;
  padding: 22px;
  text-align: center;
}

.helper-fade-enter-active,
.helper-fade-leave-active {
  transition: all 0.2s ease;
}

.helper-fade-enter-from,
.helper-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (max-width: 1080px) {
  .chapters-shell {
    flex-direction: column;
    min-height: auto;
  }

  .chapter-sidebar {
    width: 100%;
  }

  .chapter-items {
    max-height: 220px;
  }

  .editor-shell {
    min-height: 520px;
  }
}

@media (max-width: 720px) {
  .editor-shell {
    padding: 58px 20px 22px;
  }

  .editor-floating-actions {
    top: 16px;
    right: 16px;
  }

  .editor-status {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
