<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import {
  BookMarked,
  FileCheck2,
  Globe2,
  Network,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench
} from 'lucide-vue-next'
import type { SurfaceDefinition } from '@shared/assistant-runtime'
import { useAppStore } from '@/stores/app'
import { useAssistant } from '@/composables/useAssistant'
import AssistantSessionList from './AssistantSessionList.vue'
import AssistantMessages from './AssistantMessages.vue'
import AssistantComposer from './AssistantComposer.vue'
import StagedChangesView from './StagedChangesView.vue'

const appStore = useAppStore()
const { selectedProjectId } = storeToRefs(appStore)

const SURFACE: SurfaceDefinition = {
  id: 'global-page',
  scope: 'project',
  autoCommit: false,
  maxSteps: 8
}

const assistant = useAssistant({
  projectId: () => selectedProjectId.value,
  surface: SURFACE
})

const composerValue = computed({
  get: () => assistant.composerValue.value,
  set: (v) => { assistant.composerValue.value = v }
})

type AssistantMode = 'ingest' | 'correct' | 'audit'

const activeMode = ref<AssistantMode>('ingest')

const modeOptions: Array<{
  id: AssistantMode
  label: string
  description: string
}> = [
  { id: 'ingest', label: '录入', description: '沉淀设定、计划和创作记忆' },
  { id: 'correct', label: '修正', description: '收束跑偏设定并产出暂存修改' },
  { id: 'audit', label: '审计', description: '检查矛盾、OOC、伏笔和连续性' }
]

const quickActions: Record<AssistantMode, Array<{ label: string; prompt: string }>> = {
  ingest: [
    { label: '整理项目现状', prompt: '请读取项目资料，整理当前项目概况、下一步创作计划和需要沉淀的创作记忆。' },
    { label: '录入设定草稿', prompt: '我会给你一段设定草稿，请拆成可写入的世界观、人物、组织、大纲或创作记忆暂存变更。' },
    { label: '补全创作记忆', prompt: '请基于现有项目资料，补全当前状态、创作计划、待回收伏笔和素材清单。' }
  ],
  correct: [
    { label: '修正跑偏设定', prompt: '请检查项目里可能跑偏或重复的设定，并把需要修正的内容产出为暂存变更。' },
    { label: '统一人物口径', prompt: '请检查主要人物的定位、动机和关系是否有矛盾，并给出可暂存的修正方案。' },
    { label: '调整大纲承接', prompt: '请检查大纲与现有章节的承接问题，必要时产出大纲或创作记忆的暂存修改。' }
  ],
  audit: [
    { label: '全项目审计', prompt: '请审计当前项目的一致性风险，包括世界观矛盾、人物 OOC、大纲断裂、伏笔未回收和硬约束冲突。' },
    { label: '伏笔审计', prompt: '请读取剧情线索、章节摘要和创作记忆，列出待回收伏笔、风险和建议处理顺序。' },
    { label: '章节连续性审计', prompt: '请检查最近章节和大纲之间的连续性，指出问题并给出最小修正方案。' }
  ]
}

const currentMode = computed(() =>
  modeOptions.find((mode) => mode.id === activeMode.value) ?? modeOptions[0]
)

const assetLinks = computed(() => [
  { id: 'world', label: '世界观', count: appStore.worldviewEntries.length, icon: Globe2 },
  { id: 'characters', label: '角色', count: appStore.characters.length, icon: Users },
  { id: 'relations', label: '关系', count: appStore.characterRelationships.length + appStore.organizations.length, icon: Network },
  { id: 'outline', label: '大纲', count: appStore.outlineItems.length, icon: BookMarked },
  { id: 'threads', label: '伏笔', count: appStore.plotThreads.length, icon: ShieldCheck },
  { id: 'project-knowledge', label: '知识', count: appStore.knowledgeDocuments.length, icon: FileCheck2 }
])

function modeIcon(mode: AssistantMode) {
  if (mode === 'audit') return ShieldCheck
  if (mode === 'correct') return Wrench
  return Sparkles
}

function fillQuickAction(prompt: string): void {
  composerValue.value = prompt
}

function sendWithMode(): void {
  void assistant.send({
    intentHint: `global-assistant-v2:${activeMode.value}`
  })
}

// 暂存栏是否折叠（用户可最小化）
const stageCollapsed = ref(false)
const stageBadgeCount = computed(() =>
  assistant.stagedChanges.value.filter(
    (c) => c.status === 'pending' || c.status === 'accepted' || c.status === 'streaming'
  ).length
)
</script>

<template>
  <div class="v2-page" :class="{ 'stage-collapsed': stageCollapsed }">
    <AssistantSessionList
      :sessions="assistant.sessions.value"
      :active-session-id="assistant.activeSessionId.value"
      @switch="(id) => assistant.switchSession(id)"
      @create="assistant.createSession()"
      @delete="(id) => assistant.deleteSession(id)"
    />

    <div class="main">
      <div v-if="assistant.isStreaming.value" class="stream-strip">
        <span class="dot" /> 生成中…
      </div>

      <AssistantMessages
        :messages="assistant.messages.value"
        :is-streaming="assistant.isStreaming.value"
      />

      <div v-if="assistant.messages.value.length === 0 && !assistant.isStreaming.value" class="starter">
        <div class="starter-head">
          <div>
            <div class="starter-kicker">Global Assistant v2</div>
            <h2>需要我做点什么？</h2>
          </div>
          <div class="mode-switch" role="tablist" aria-label="助手模式">
            <button
              v-for="mode in modeOptions"
              :key="mode.id"
              type="button"
              :class="{ active: activeMode === mode.id }"
              @click="activeMode = mode.id"
            >
              <component :is="modeIcon(mode.id)" :size="14" />
              <span>{{ mode.label }}</span>
            </button>
          </div>
        </div>

        <div class="mode-note">
          <strong>{{ currentMode.label }}</strong>
          <span>{{ currentMode.description }}</span>
        </div>

        <div class="asset-strip">
          <button
            v-for="item in assetLinks"
            :key="item.id"
            type="button"
            class="asset-pill"
            @click="appStore.setPanel(item.id as never)"
          >
            <component :is="item.icon" :size="14" />
            <span>{{ item.count }}</span>
            <em>{{ item.label }}</em>
          </button>
        </div>

        <div class="quick-grid">
          <button
            v-for="action in quickActions[activeMode]"
            :key="action.label"
            type="button"
            class="quick-card"
            @click="fillQuickAction(action.prompt)"
          >
            <span>{{ action.label }}</span>
          </button>
        </div>
      </div>

      <div v-if="assistant.lastError.value" class="err-banner">
        {{ assistant.lastError.value }}
      </div>

      <AssistantComposer
        v-model="composerValue"
        :is-streaming="assistant.isStreaming.value"
        :mode-label="currentMode.label"
        @send="sendWithMode"
        @cancel="assistant.cancel()"
      />
    </div>

    <!-- 折叠态：竖窄条 -->
    <button
      v-if="stageCollapsed"
      class="stage-mini"
      :title="`展开暂存变更 (${stageBadgeCount})`"
      @click="stageCollapsed = false"
    >
      <span class="stage-mini-label">暂存</span>
      <span v-if="stageBadgeCount > 0" class="stage-mini-badge">{{ stageBadgeCount }}</span>
    </button>

    <!-- 展开态：完整变更列表 -->
    <div v-else class="stage-col">
      <div class="stage-col-head">
        <span class="stage-col-title">暂存区</span>
        <button class="collapse-btn" title="最小化" @click="stageCollapsed = true">
          <span>›</span>
        </button>
      </div>
      <StagedChangesView
        class="stage-view"
        :changes="assistant.stagedChanges.value"
        :is-busy="assistant.isStreaming.value"
        @accept="(ids) => assistant.acceptChanges(ids)"
        @reject="(ids) => assistant.rejectChanges(ids)"
        @commit="(ids) => assistant.commitAccepted(ids)"
      />
    </div>
  </div>
</template>

<style scoped>
.v2-page {
  /* Runtime v2 专属主题覆盖：强制 emerald accent，与旧 v1 的主题色区分 */
  --arc-primary: #0d7d5a;
  --arc-primary-hover: #0a6b4e;
  --arc-primary-pressed: #085d43;
  --arc-primary-soft: rgba(13, 125, 90, 0.08);
  --v2-accent-line: rgba(13, 125, 90, 0.22);
  --v2-warn: #b45309;
  --v2-warn-soft: rgba(180, 83, 9, 0.08);
  --v2-danger: #b91c1c;
  --v2-danger-soft: rgba(185, 28, 28, 0.06);
  --v2-add: #047857;
  --v2-add-bg: rgba(4, 120, 87, 0.09);
  --v2-del: #b91c1c;
  --v2-del-bg: rgba(185, 28, 28, 0.07);
  --v2-mono: 'JetBrains Mono', 'Consolas', 'SF Mono', ui-monospace, Menlo, monospace;
  --v2-radius-card: 14px;
  --v2-radius-btn: 8px;
  letter-spacing: -0.005em;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 380px;
  width: 100%;
  height: 100%;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
}
.v2-page.stage-collapsed {
  grid-template-columns: 220px minmax(0, 1fr) 44px;
}
.main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  position: relative;
}
.starter {
  width: min(760px, calc(100% - 64px));
  margin: auto auto 0;
  padding: 26px 0 8px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.starter-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
}
.starter-kicker {
  font-family: var(--v2-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--arc-primary);
  margin-bottom: 6px;
}
.starter h2 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 28px;
  line-height: 1.15;
  font-weight: 700;
}
.mode-switch {
  display: inline-grid;
  grid-template-columns: repeat(3, minmax(62px, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-sm);
}
.mode-switch button {
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  border-radius: 7px;
  padding: 7px 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.mode-switch button.active {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-weight: 600;
}
.mode-note {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 12.5px;
}
.mode-note strong {
  color: var(--arc-text-primary);
  font-size: 13px;
}
.asset-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.asset-pill {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  border-radius: 999px;
  padding: 6px 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
}
.asset-pill:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  transform: translateY(-1px);
}
.asset-pill span {
  font-family: var(--v2-mono);
  color: var(--arc-text-primary);
}
.asset-pill em {
  font-style: normal;
  font-size: 12px;
}
.quick-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.quick-card {
  min-height: 58px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  text-align: left;
  padding: 12px 13px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.35;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}
.quick-card:hover {
  border-color: var(--arc-primary);
  background: var(--arc-primary-soft);
  transform: translateY(-1px);
}
.stream-strip {
  position: absolute;
  top: 12px;
  right: 20px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: #b45309;
  font-family: monospace;
  background: var(--arc-bg-surface);
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(180, 83, 9, 0.2);
}
.stream-strip .dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #b45309;
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse { 50% { opacity: 0.35; } }
.err-banner {
  margin: 0 32px 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(185, 28, 28, 0.06);
  border: 1px solid rgba(185, 28, 28, 0.2);
  color: #b91c1c;
  font-size: 12.5px;
}
/* 暂存栏（展开态） */
.stage-col {
  display: flex;
  flex-direction: column;
  width: 380px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}
.stage-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--arc-border);
  flex-shrink: 0;
}
.stage-col-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--arc-text-primary);
}
.collapse-btn {
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 16px;
  line-height: 1;
  transition: all 0.15s ease;
}
.collapse-btn:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}
.stage-view {
  flex: 1;
  min-height: 0;
  border-left: none;
}
/* 暂存栏（折叠态：竖窄条） */
.stage-mini {
  border: none;
  border-left: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 18px 0;
  gap: 8px;
  transition: background 0.15s ease;
}
.stage-mini:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}
.stage-mini-label {
  writing-mode: vertical-rl;
  font-size: 12px;
  letter-spacing: 0.08em;
  font-family: monospace;
}
.stage-mini-badge {
  font-size: 10px;
  font-family: monospace;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--arc-primary);
  color: #fff;
  font-weight: 600;
}
@media (max-width: 980px) {
  .v2-page,
  .v2-page.stage-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }
  .starter {
    width: calc(100% - 32px);
  }
  .starter-head {
    align-items: stretch;
    flex-direction: column;
  }
  .quick-grid {
    grid-template-columns: 1fr;
  }
}
</style>
