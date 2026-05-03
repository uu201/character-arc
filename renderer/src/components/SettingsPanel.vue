<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Download, FileJson, FileStack, FileText, FolderOutput, Lightbulb, Moon, Network, PenTool, Save, Users } from 'lucide-vue-next'
import { NButton, NCard, NFormItem, NInput, NModal, NSelect, NSwitch, useMessage } from 'naive-ui'
import { getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { autoSaveOptions } from '@/features/settings/autoSave'
import { buildProjectWritingStyleContext, writingStylePresets } from '@/features/writingStyles/presets'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type {
  CharacterArcExportEnvelope,
  ImportConflictMode,
  ImportExportModuleType,
  ProjectImportPayload
} from '@/types/app'

const appStore = useAppStore()
const message = useMessage()
const importConflictMode = ref<ImportConflictMode>('copy')
const importModalVisible = ref(false)
const pendingImportPayload = ref<ProjectImportPayload | null>(null)
const pendingImportMeta = ref<CharacterArcImportMeta | null>(null)
const draftWritingStylePresetId = ref('')
const draftWritingStylePrompt = ref('')

const autoSaveSelectOptions = [...autoSaveOptions]
const uiScaleOptions = [
  { label: '75%', value: 0.75 },
  { label: '85%', value: 0.85 },
  { label: '100%', value: 1 },
  { label: '110%', value: 1.1 },
  { label: '125%', value: 1.25 },
  { label: '140%', value: 1.4 }
]

const activeWritingStyle = computed(() =>
  buildProjectWritingStyleContext({
    writingStylePresetId: draftWritingStylePresetId.value,
    writingStylePrompt: draftWritingStylePrompt.value
  })
)
const hasStyleDraftChanges = computed(() => {
  const project = appStore.currentProject
  if (!project) {
    return false
  }

  return (
    draftWritingStylePresetId.value !== (project.writingStylePresetId ?? '') ||
    draftWritingStylePrompt.value !== (project.writingStylePrompt ?? '')
  )
})
// 导入冲突策略选项
const importConflictOptions = [
  { label: '新建副本', value: 'copy' as const },
  { label: '覆盖当前模块', value: 'overwrite' as const }
]
// 导入模块类型到中文标签的映射
const importModuleLabelMap: Record<ImportExportModuleType, string> = {
  project: '完整项目',
  characters: '角色资料',
  outline: '剧情大纲',
  inspiration: '灵感卡片',
  relations: '关系组织',
  chapters: '章节数据'
}

function saveWritingStyleSettings(): void {
  if (!appStore.currentProject?.id) {
    return
  }

  appStore.updateProject(appStore.currentProject.id, {
    writingStylePresetId: draftWritingStylePresetId.value || 'cinematic-cool',
    writingStylePrompt: draftWritingStylePrompt.value
  })
  message.success('写作风格设置已保存')
}

function buildExportStem(suffix: string): string {
  const projectTitle = appStore.currentProject?.title?.trim() || 'characterarc'
  const safeTitle = projectTitle.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-')
  return `${safeTitle}-${suffix}`
}

// 构建导出信封：包装数据为标准的 CharacterArc 导出格式，包含版本号和模块类型
function buildExportEnvelope(moduleType: ImportExportModuleType, data: ProjectImportPayload): CharacterArcExportEnvelope {
  return {
    app: 'CharacterArc',
    schemaVersion: '2.0',
    moduleType,
    compatibilityNote: '2.x 导出文件可直接导入当前版本；1.x 旧导出会按兼容模式解析，并默认按完整项目导入。',
    exportedAt: new Date().toISOString(),
    data
  }
}

// 导出完整项目为 JSON 文件
async function handleExportJson(): Promise<void> {
  const payload = {
    project: appStore.currentProject,
    worldviewEntries: appStore.worldviewEntries,
    characters: appStore.characters,
    organizations: appStore.organizations,
    characterRelationships: appStore.characterRelationships,
    organizationMemberships: appStore.organizationMemberships,
    inspirationEntries: appStore.inspirationEntries,
    outlineVolumes: appStore.outlineVolumes,
    outlineItems: appStore.outlineItems,
    chapters: appStore.chapters,
    chapterVersions: appStore.chapterVersions
  }

  const result = await window.characterArc.exportJson(toIpcPayload({
    data: buildExportEnvelope('project', payload),
    title: '导出完整项目 JSON',
    defaultPath: `${buildExportStem('project')}.json`
  }))
  if (result.success) {
    message.success('项目数据已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出 JSON 失败，请稍后重试')
  }
}

// 导出章节正文为 TXT 文件（仅包含纯文本内容）
async function handleExportText(): Promise<void> {
  const payload = {
    project: appStore.currentProject,
    outlineVolumes: appStore.outlineVolumes,
    chapters: appStore.chapters.map((chapter) => ({
      volumeId: chapter.volumeId,
      title: chapter.title,
      content: getPlainTextFromEditorContent(chapter.content)
    })),
    exportedAt: new Date().toISOString()
  }

  const result = await window.characterArc.exportText(toIpcPayload({
    data: payload,
    title: '导出章节正文 TXT',
    defaultPath: `${buildExportStem('chapters')}.txt`
  }))
  if (result.success) {
    message.success('章节内容已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出 TXT 失败，请稍后重试')
  }
}

// 导出角色资料为 JSON 文件
async function handleExportCharacters(): Promise<void> {
  const result = await window.characterArc.exportJson(toIpcPayload({
    data: buildExportEnvelope('characters', {
      project: appStore.currentProject,
      characters: appStore.characters
    }),
    title: '导出角色资料 JSON',
    defaultPath: `${buildExportStem('characters')}.json`
  }))

  if (result.success) {
    message.success('角色资料已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出角色资料失败，请稍后重试')
  }
}

// 导出大纲节点为 JSON 文件
async function handleExportOutline(): Promise<void> {
  const result = await window.characterArc.exportJson(toIpcPayload({
    data: buildExportEnvelope('outline', {
      project: appStore.currentProject,
      outlineVolumes: appStore.outlineVolumes,
      outlineItems: appStore.outlineItems
    }),
    title: '导出大纲节点 JSON',
    defaultPath: `${buildExportStem('outline')}.json`
  }))

  if (result.success) {
    message.success('大纲节点已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出大纲节点失败，请稍后重试')
  }
}

// 导出灵感卡片为 JSON 文件
async function handleExportInspiration(): Promise<void> {
  const result = await window.characterArc.exportJson(toIpcPayload({
    data: buildExportEnvelope('inspiration', {
      project: appStore.currentProject,
      inspirationEntries: appStore.inspirationEntries
    }),
    title: '导出灵感卡片 JSON',
    defaultPath: `${buildExportStem('inspiration')}.json`
  }))

  if (result.success) {
    message.success('灵感卡片已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出灵感卡片失败，请稍后重试')
  }
}

// 导出关系组织数据为 JSON 文件
async function handleExportRelations(): Promise<void> {
  const result = await window.characterArc.exportJson(toIpcPayload({
    data: buildExportEnvelope('relations', {
      project: appStore.currentProject,
      characters: appStore.characters,
      organizations: appStore.organizations,
      characterRelationships: appStore.characterRelationships,
      organizationMemberships: appStore.organizationMemberships
    }),
    title: '导出关系组织 JSON',
    defaultPath: `${buildExportStem('relations')}.json`
  }))

  if (result.success) {
    message.success('关系组织数据已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出关系组织数据失败，请稍后重试')
  }
}

// 导出章节数据（含正文和元信息）为 JSON 文件
async function handleExportChaptersJson(): Promise<void> {
  const result = await window.characterArc.exportJson(toIpcPayload({
    data: buildExportEnvelope('chapters', {
      project: appStore.currentProject,
      outlineVolumes: appStore.outlineVolumes,
      chapters: appStore.chapters,
      chapterVersions: appStore.chapterVersions
    }),
    title: '导出章节数据 JSON',
    defaultPath: `${buildExportStem('chapters')}.json`
  }))

  if (result.success) {
    message.success('章节数据已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出章节数据失败，请稍后重试')
  }
}

// 导入 JSON 文件：完整项目直接导入，模块数据弹出确认弹窗让用户选择冲突策略
async function handleImportJson(): Promise<void> {
  const result = await window.characterArc.importJson()
  if (result.canceled) {
    return
  }

  if (!result.success || !result.payload) {
    message.error(result.error ?? '导入失败，请检查项目文件格式')
    return
  }

  const payload = result.payload as ProjectImportPayload
  const meta = result.meta ?? {
    schemaVersion: '1.0',
    moduleType: 'project' as const,
    compatibilityNote: '这是旧版 1.x 导出文件，系统已按兼容模式识别为完整项目导入。',
    isLegacy: true
  }

  if (meta.moduleType === 'project') {
    appStore.importProjectData(payload)
    message.success(meta.isLegacy ? '旧版项目数据已按兼容模式导入' : '项目数据已导入')
    return
  }

  pendingImportPayload.value = payload
  pendingImportMeta.value = meta
  importConflictMode.value = 'copy'
  importModalVisible.value = true
}

// 确认模块导入：根据用户选择的冲突策略执行导入
function confirmModuleImport(): void {
  if (!pendingImportPayload.value || !pendingImportMeta.value) {
    return
  }

  appStore.importModuleData(pendingImportMeta.value.moduleType, pendingImportPayload.value, importConflictMode.value)
  importModalVisible.value = false
  message.success(`${importModuleLabelMap[pendingImportMeta.value.moduleType]}已导入到当前项目`)
}

function closeImportModal(): void {
  importModalVisible.value = false
  pendingImportPayload.value = null
  pendingImportMeta.value = null
}

watch(
  () => appStore.currentProject,
  (project) => {
    draftWritingStylePresetId.value = project?.writingStylePresetId ?? ''
    draftWritingStylePrompt.value = project?.writingStylePrompt ?? ''
  },
  { immediate: true }
)
</script>

<template>
  <section class="settings-panel">
    <div class="section-head">
      <div>
        <h2>项目设置</h2>
        <p>管理当前项目的备份、导入导出与创作偏好。</p>
      </div>
    </div>

    <div class="settings-wrap">
      <n-card class="setting-card" :bordered="false">
        <template #header>
          <div class="block-title">
            <Save :size="18" />
            <span>存储与备份</span>
          </div>
        </template>
        <div class="storage-status" :class="{ error: appStore.persistenceError }">
          <strong>{{ appStore.persistenceError ? '本地数据状态异常' : '本地数据状态正常' }}</strong>
          <span>
            {{ appStore.persistenceError || '当前工作区内容已接入本地 SQLite 持久化。' }}
          </span>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-name">自动保存时间间隔</div>
            <div class="setting-hint">
              {{ appStore.isLiveAutoSave ? '正文与工作区修改会尽快落盘。' : `正文修改会按 ${appStore.autoSaveIntervalLabel} 进入自动保存队列。` }}
            </div>
          </div>
          <n-select
            class="compact-select"
            :options="autoSaveSelectOptions"
            :value="appStore.appSettings.autoSaveInterval"
            @update:value="(value) => appStore.updateAppSetting('autoSaveInterval', value ?? '5m')"
          />
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-name">界面缩放比例</div>
            <div class="setting-hint">调整整个应用的显示比例，适配高分屏和不同窗口尺寸。</div>
          </div>
          <n-select
            class="compact-select"
            :options="uiScaleOptions"
            :value="appStore.appSettings.uiScale"
            @update:value="(value) => appStore.updateAppSetting('uiScale', value ?? 1)"
          />
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-name">
              <Moon :size="14" style="vertical-align: -2px; margin-right: 5px;" />
              深色模式
            </div>
            <div class="setting-hint">将界面切换为深色背景，适合夜间长时间写作。</div>
          </div>
          <n-switch
            :value="appStore.appSettings.darkMode"
            @update:value="(value) => appStore.updateAppSetting('darkMode', value)"
          />
        </div>
        <div class="setting-actions">
          <n-button round strong @click="handleImportJson">
            <template #icon>
              <Download :size="16" />
            </template>
            导入 JSON
          </n-button>
          <n-button round strong @click="handleExportJson">
            <template #icon>
              <FolderOutput :size="16" />
            </template>
            导出项目为 JSON
          </n-button>
          <n-button round strong @click="handleExportText">
            <template #icon>
              <FileText :size="16" />
            </template>
            导出为 TXT
          </n-button>
        </div>
        <div class="module-export-block">
          <div class="module-export-copy">
            <div class="setting-name">按模块导出</div>
            <div class="setting-hint">把角色、大纲或章节单独导出，便于分发和复用。</div>
          </div>
          <div class="module-export-grid">
            <button class="module-export-card" @click="handleExportCharacters">
              <Users :size="18" />
              <strong>角色资料</strong>
              <span>导出角色卡与标签</span>
            </button>
            <button class="module-export-card" @click="handleExportOutline">
              <FileStack :size="18" />
              <strong>剧情大纲</strong>
              <span>导出大纲节点与冲突</span>
            </button>
            <button class="module-export-card" @click="handleExportInspiration">
              <Lightbulb :size="18" />
              <strong>灵感卡片</strong>
              <span>导出标题、桥段与转折素材</span>
            </button>
            <button class="module-export-card" @click="handleExportRelations">
              <Network :size="18" />
              <strong>关系组织</strong>
              <span>导出势力、人物关系与成员归属</span>
            </button>
            <button class="module-export-card" @click="handleExportChaptersJson">
              <FileJson :size="18" />
              <strong>章节 JSON</strong>
              <span>导出正文与元信息</span>
            </button>
          </div>
        </div>
      </n-card>

      <n-card class="setting-card" :bordered="false">
        <template #header>
          <div class="block-title">
            <PenTool :size="18" />
            <span>写作风格系统</span>
          </div>
        </template>
        <div class="style-hero">
          <div>
            <strong>{{ activeWritingStyle.label }}</strong>
            <p>{{ activeWritingStyle.description }}</p>
          </div>
          <span class="style-hero-badge">项目默认风格</span>
        </div>
        <div class="style-preset-grid">
          <button
            v-for="preset in writingStylePresets"
            :key="preset.id"
            class="style-preset-card"
            :class="{ active: draftWritingStylePresetId === preset.id }"
            :style="{ background: preset.accent }"
            @click="draftWritingStylePresetId = preset.id"
          >
            <strong>{{ preset.label }}</strong>
            <span>{{ preset.description }}</span>
          </button>
        </div>
        <n-form-item label="补充风格要求">
          <n-input
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 7 }"
            v-model:value="draftWritingStylePrompt"
            placeholder="例如：对话更克制，避免现代网络口头禅；环境描写多用霓虹、雨幕、金属反光等意象。"
          />
        </n-form-item>
        <div class="style-save-row">
          <div class="style-save-hint">
            <strong>保存前预览</strong>
            <span>修改风格预设或补充规则后，需要点击保存才会写入当前项目。</span>
          </div>
          <n-button type="primary" round strong :disabled="!hasStyleDraftChanges" @click="saveWritingStyleSettings">
            <template #icon>
              <Save :size="16" />
            </template>
            保存设置
          </n-button>
        </div>
        <div class="style-footnote">
          当前章节助理、灵感生成、大纲扩写和角色/设定生成都会优先参考这里的项目风格。
        </div>
      </n-card>
    </div>

    <n-modal
      :show="importModalVisible"
      preset="card"
      class="arc-editor-modal import-modal"
      title="导入模块数据"
      :bordered="false"
      @close="closeImportModal"
    >
      <div class="import-modal-body">
        <div class="storage-status">
          <strong>{{ pendingImportMeta ? `检测到 ${importModuleLabelMap[pendingImportMeta.moduleType]} 导入包` : '等待导入文件' }}</strong>
          <span>{{ pendingImportMeta?.compatibilityNote || '请确认导入策略后再继续。' }}</span>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-name">Schema 版本</div>
            <div class="setting-hint">旧版本文件会按兼容模式导入，当前不会直接拒绝 1.x 导出。</div>
          </div>
          <div class="import-meta-pill">{{ pendingImportMeta?.schemaVersion || '--' }}</div>
        </div>

        <n-form-item label="冲突处理策略">
          <n-select v-model:value="importConflictMode" :options="importConflictOptions" />
        </n-form-item>

        <div class="setting-hint">
          新建副本会尽量保留当前项目现有数据；覆盖当前模块只覆盖对应模块，不会删除整个项目。
        </div>
      </div>

      <template #footer>
        <div class="setting-actions">
          <n-button round strong @click="closeImportModal">取消</n-button>
          <n-button type="primary" round strong @click="confirmModuleImport">开始导入</n-button>
        </div>
      </template>
    </n-modal>
  </section>
</template>

<style scoped>
.settings-panel {
  max-width: 960px;
  margin: 0 auto;
  min-width: 0;
}

.section-head {
  margin-bottom: 32px;
}

.section-head h2 {
  margin: 0 0 8px;
  font-size: clamp(30px, 3.4vw, 38px);
  font-weight: 650;
  letter-spacing: -0.04em;
}

.section-head p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 15px;
}

.settings-wrap {
  display: flex;
  width: min(100%, 720px);
  margin: 0 auto;
  flex-direction: column;
  gap: 20px;
}

.setting-card {
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-sm);
}

.style-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--arc-primary) 4%, var(--arc-bg-surface));
  padding: 16px 18px;
  margin-bottom: 16px;
}

.style-hero strong {
  display: block;
  color: var(--arc-text-primary);
  font-size: 16px;
  font-weight: 700;
}

.style-hero p {
  margin: 8px 0 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.style-hero-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 800;
  padding: 7px 10px;
  white-space: nowrap;
}

.style-preset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.style-preset-card {
  display: flex;
  min-height: 96px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  color: var(--arc-text-primary);
  cursor: pointer;
  padding: 14px;
  text-align: left;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.style-preset-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.05);
}

.style-preset-card.active {
  border-color: color-mix(in srgb, var(--arc-primary) 34%, var(--arc-bg-mix));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 10%, transparent);
}

.style-preset-card strong {
  font-size: 14px;
  font-weight: 700;
}

.style-preset-card span {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.style-footnote {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.style-save-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 14px;
  padding: 14px 16px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
}

.style-save-hint {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.style-save-hint strong {
  font-size: 13px;
  font-weight: 700;
}

.style-save-hint span {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.block-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.setting-name {
  font-size: 14px;
  font-weight: 500;
}

.setting-hint {
  margin-top: 4px;
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.compact-select {
  width: 136px;
}

.setting-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}

.module-export-block {
  margin-top: 22px;
  padding-top: 22px;
  border-top: 1px solid var(--arc-border);
}

.module-export-copy {
  margin-bottom: 14px;
}

.module-export-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.module-export-card {
  display: flex;
  min-height: 120px;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  cursor: pointer;
  padding: 16px;
  text-align: left;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.module-export-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--arc-primary) 18%, var(--arc-border));
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.05);
}

.module-export-card :deep(svg) {
  color: var(--arc-primary);
}

.module-export-card strong {
  font-size: 14px;
}

.module-export-card span {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.storage-status {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 14px 16px;
  margin-bottom: 18px;
}

.storage-status strong {
  font-size: 13px;
}

.storage-status span {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.storage-status.error {
  border-color: rgba(254, 202, 202, 0.95);
  background: rgba(254, 242, 242, 0.96);
}

.storage-status.error span,
.storage-status.error strong {
  color: #991b1b;
}

.import-modal-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.import-meta-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 76px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 20%, var(--arc-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 700;
  padding: 8px 12px;
}

@media (max-width: 1240px) {
  .setting-actions :deep(.n-button) {
    justify-content: center;
  }
}

@media (max-width: 760px) {
  .style-preset-grid {
    grid-template-columns: 1fr;
  }

  .setting-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .compact-select {
    width: 100%;
  }

  .setting-actions {
    flex-direction: column;
  }

  .setting-actions :deep(.n-button) {
    width: 100%;
    justify-content: center;
  }

  .module-export-grid {
    grid-template-columns: 1fr;
  }

  .style-save-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
