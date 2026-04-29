<script setup lang="ts">
import { computed, ref } from 'vue'
import { Cpu, Download, FileJson, FileStack, FileText, FolderOutput, Lightbulb, Network, Palette, PenTool, PlugZap, Save, Users } from 'lucide-vue-next'
import { NButton, NCard, NFormItem, NInput, NSelect, useMessage } from 'naive-ui'
import { getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { autoSaveOptions } from '@/features/settings/autoSave'
import { buildProjectWritingStyleContext, writingStylePresets } from '@/features/writingStyles/presets'
import { themePresets } from '@/theme/presets'
import { useAppStore } from '@/stores/app'
import type { ThemeName } from '@/types/app'

const appStore = useAppStore()
const message = useMessage()
const isTestingAiConnection = ref(false)

type ProviderPreset = {
  label: string
  value: string
  model: string
  baseUrl: string
  hint: string
}

const themeOptions = themePresets.map((preset) => ({
  label: preset.label,
  value: preset.name
}))
const providerPresets: ProviderPreset[] = [
  {
    label: 'DeepSeek',
    value: 'deepseek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    hint: '官方直连，适合通用写作和对话。模型示例：deepseek-chat / deepseek-reasoner。'
  },
  {
    label: '阿里云百炼 / 通义千问',
    value: 'qwen',
    model: 'qwen-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    hint: 'OpenAI 兼容模式。模型示例：qwen-plus / qwen-max / qwen3-coder-plus。'
  },
  {
    label: '智谱 GLM',
    value: 'zhipu',
    model: 'glm-4.7',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    hint: '官方通用端点。模型示例：glm-4.7 / glm-4.5-air。'
  },
  {
    label: 'Moonshot / Kimi',
    value: 'moonshot',
    model: 'kimi-k2.5',
    baseUrl: 'https://api.moonshot.cn/v1',
    hint: '官方 OpenAI 兼容接口。模型示例：kimi-k2.5 / moonshot-v1-128k。'
  },
  {
    label: 'SiliconFlow',
    value: 'siliconflow',
    model: 'Qwen/Qwen2.5-72B-Instruct',
    baseUrl: 'https://api.siliconflow.cn/v1',
    hint: '聚合大量开源模型，模型名通常使用完整 ID。示例：Qwen/Qwen2.5-72B-Instruct。'
  },
  {
    label: 'OpenAI',
    value: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    hint: '官方 OpenAI 接口。'
  },
  {
    label: 'Anthropic',
    value: 'anthropic',
    model: 'claude-3-5-sonnet-latest',
    baseUrl: 'https://api.anthropic.com',
    hint: 'Claude 原生协议，不走 OpenAI 兼容格式。'
  },
  {
    label: '本地模型 / Ollama',
    value: 'ollama',
    model: 'llama3.2',
    baseUrl: 'http://127.0.0.1:11434/v1',
    hint: '本地运行，无需外网。模型示例：llama3.2 / qwen2.5 / deepseek-r1。'
  },
  {
    label: 'New API 网关',
    value: 'new-api',
    model: 'qwen-plus',
    baseUrl: 'http://127.0.0.1:3000/v1',
    hint: '开源聚合网关预设。把官方渠道接进 New API 后，这里填网关 token 即可。'
  },
  {
    label: 'One API 网关',
    value: 'one-api',
    model: 'qwen-plus',
    baseUrl: 'http://127.0.0.1:3000/v1',
    hint: '开源统一分发网关预设。适合把多家国产模型统一到一个地址下。'
  }
]
const providerOptions = providerPresets.map(({ label, value }) => ({ label, value }))
const autoSaveSelectOptions = [...autoSaveOptions]
const uiScaleOptions = [
  { label: '75%', value: 0.75 },
  { label: '85%', value: 0.85 },
  { label: '100%', value: 1 },
  { label: '110%', value: 1.1 },
  { label: '125%', value: 1.25 },
  { label: '140%', value: 1.4 }
]

const activeProviderPreset = computed(
  () => providerPresets.find((item) => item.value === appStore.appSettings.provider) ?? providerPresets[0]
)
const activeWritingStyle = computed(() => buildProjectWritingStyleContext(appStore.currentProject))

function updateWritingStylePreset(presetId: string): void {
  if (!appStore.currentProject?.id) {
    return
  }

  appStore.updateProject(appStore.currentProject.id, {
    writingStylePresetId: presetId
  })
}

function updateWritingStylePrompt(prompt: string): void {
  if (!appStore.currentProject?.id) {
    return
  }

  appStore.updateProject(appStore.currentProject.id, {
    writingStylePrompt: prompt
  })
}

function resolveProviderDefaults(provider: string): { model: string; baseUrl: string } {
  const preset = providerPresets.find((item) => item.value === provider)
  return preset
    ? {
        model: preset.model,
        baseUrl: preset.baseUrl
      }
    : {
        model: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com/v1'
      }
}

function handleProviderChange(provider: string): void {
  const defaults = resolveProviderDefaults(provider)
  appStore.updateAppSetting('provider', provider)
  appStore.updateAppSetting('model', defaults.model)
  appStore.updateAppSetting('baseUrl', defaults.baseUrl)
}

async function handleTestAiConnection(): Promise<void> {
  if (isTestingAiConnection.value) {
    return
  }

  isTestingAiConnection.value = true

  try {
    const result = await window.characterArc.testAiConnection(appStore.appSettings)
    if (!result.success) {
      throw new Error(result.error ?? '模型连接测试失败')
    }

    const payload = result.result as { provider?: string; model?: string } | undefined
    message.success(`模型连接成功：${payload?.provider ?? appStore.appSettings.provider} / ${payload?.model ?? appStore.appSettings.model}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '模型连接测试失败')
  } finally {
    isTestingAiConnection.value = false
  }
}

function buildExportStem(suffix: string): string {
  const projectTitle = appStore.currentProject?.title?.trim() || 'characterarc'
  const safeTitle = projectTitle.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-')
  return `${safeTitle}-${suffix}`
}

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
    chapterVersions: appStore.chapterVersions,
    exportedAt: new Date().toISOString()
  }

  const result = await window.characterArc.exportJson({
    data: {
      version: '1.0',
      type: 'project',
      ...payload
    },
    title: '导出完整项目 JSON',
    defaultPath: `${buildExportStem('project')}.json`
  })
  if (result.success) {
    message.success('项目数据已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出 JSON 失败，请稍后重试')
  }
}

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

  const result = await window.characterArc.exportText({
    data: payload,
    title: '导出章节正文 TXT',
    defaultPath: `${buildExportStem('chapters')}.txt`
  })
  if (result.success) {
    message.success('章节内容已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出 TXT 失败，请稍后重试')
  }
}

async function handleExportCharacters(): Promise<void> {
  const result = await window.characterArc.exportJson({
    data: {
      version: '1.0',
      type: 'characters',
      project: appStore.currentProject,
      characters: appStore.characters,
      exportedAt: new Date().toISOString()
    },
    title: '导出角色资料 JSON',
    defaultPath: `${buildExportStem('characters')}.json`
  })

  if (result.success) {
    message.success('角色资料已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出角色资料失败，请稍后重试')
  }
}

async function handleExportOutline(): Promise<void> {
  const result = await window.characterArc.exportJson({
    data: {
      version: '1.0',
      type: 'outline',
      project: appStore.currentProject,
      outlineVolumes: appStore.outlineVolumes,
      outlineItems: appStore.outlineItems,
      exportedAt: new Date().toISOString()
    },
    title: '导出大纲节点 JSON',
    defaultPath: `${buildExportStem('outline')}.json`
  })

  if (result.success) {
    message.success('大纲节点已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出大纲节点失败，请稍后重试')
  }
}

async function handleExportInspiration(): Promise<void> {
  const result = await window.characterArc.exportJson({
    data: {
      version: '1.0',
      type: 'inspiration',
      project: appStore.currentProject,
      inspirationEntries: appStore.inspirationEntries,
      exportedAt: new Date().toISOString()
    },
    title: '导出灵感卡片 JSON',
    defaultPath: `${buildExportStem('inspiration')}.json`
  })

  if (result.success) {
    message.success('灵感卡片已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出灵感卡片失败，请稍后重试')
  }
}

async function handleExportRelations(): Promise<void> {
  const result = await window.characterArc.exportJson({
    data: {
      version: '1.0',
      type: 'relations',
      project: appStore.currentProject,
      organizations: appStore.organizations,
      characterRelationships: appStore.characterRelationships,
      organizationMemberships: appStore.organizationMemberships,
      exportedAt: new Date().toISOString()
    },
    title: '导出关系组织 JSON',
    defaultPath: `${buildExportStem('relations')}.json`
  })

  if (result.success) {
    message.success('关系组织数据已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出关系组织数据失败，请稍后重试')
  }
}

async function handleExportChaptersJson(): Promise<void> {
  const result = await window.characterArc.exportJson({
    data: {
      version: '1.0',
      type: 'chapters',
      project: appStore.currentProject,
      outlineVolumes: appStore.outlineVolumes,
      chapters: appStore.chapters,
      exportedAt: new Date().toISOString()
    },
    title: '导出章节数据 JSON',
    defaultPath: `${buildExportStem('chapters')}.json`
  })

  if (result.success) {
    message.success('章节数据已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出章节数据失败，请稍后重试')
  }
}

async function handleImportJson(): Promise<void> {
  const result = await window.characterArc.importJson()
  if (result.canceled) {
    return
  }

  if (!result.success || !result.payload) {
    message.error(result.error ?? '导入失败，请检查项目文件格式')
    return
  }

  appStore.importProjectData(result.payload as {
    project?: import('@/types/app').ProjectSummary
    worldviewEntries?: import('@/types/app').WorldviewEntry[]
    characters?: import('@/types/app').CharacterCard[]
    organizations?: import('@/types/app').OrganizationEntry[]
    characterRelationships?: import('@/types/app').CharacterRelationship[]
    organizationMemberships?: import('@/types/app').OrganizationMembership[]
    inspirationEntries?: import('@/types/app').InspirationEntry[]
    outlineVolumes?: import('@/types/app').OutlineVolume[]
    outlineItems?: import('@/types/app').OutlineItem[]
    chapters?: import('@/types/app').ChapterDraft[]
    chapterVersions?: import('@/types/app').ChapterVersion[]
  })
  message.success('项目数据已导入')
}
</script>

<template>
  <section class="settings-panel">
    <div class="section-head">
      <div>
        <h2>项目设置</h2>
        <p>管理模型连接、主题色和本地备份策略。</p>
      </div>
    </div>

    <div class="settings-wrap">
      <n-card class="setting-card" :bordered="false">
        <template #header>
          <div class="block-title">
            <Cpu :size="18" />
            <span>AI 模型配置</span>
          </div>
        </template>
        <n-form-item label="模型供应商">
          <n-select
            :options="providerOptions"
            :value="appStore.appSettings.provider"
            @update:value="(value) => handleProviderChange(value ?? 'deepseek')"
          />
        </n-form-item>
        <div class="provider-hint-block">
          <strong>{{ activeProviderPreset.label }}</strong>
          <p>{{ activeProviderPreset.hint }}</p>
          <code>{{ activeProviderPreset.baseUrl }}</code>
        </div>
        <n-form-item label="模型名称">
          <n-input
            :value="appStore.appSettings.model"
            @update:value="(value) => appStore.updateAppSetting('model', value)"
            :placeholder="`例如：${activeProviderPreset.model}`"
          />
        </n-form-item>
        <n-form-item label="API Key">
          <n-input
            type="password"
            :value="appStore.appSettings.apiKey"
            @update:value="(value) => appStore.updateAppSetting('apiKey', value)"
            :placeholder="appStore.appSettings.provider === 'ollama' ? '本地 Ollama 通常不需要 API Key' : '填写对应平台或网关的 Token'"
          />
        </n-form-item>
        <n-form-item label="Base URL (自定义代理)">
          <n-input
            :value="appStore.appSettings.baseUrl"
            @update:value="(value) => appStore.updateAppSetting('baseUrl', value)"
            placeholder="支持官方接口地址，也支持 OpenAI 兼容网关地址"
          />
        </n-form-item>
        <div class="setting-actions ai-actions">
          <n-button round strong secondary :disabled="isTestingAiConnection" @click="handleTestAiConnection">
            <template #icon>
              <PlugZap :size="16" />
            </template>
            {{ isTestingAiConnection ? '测试中...' : '测试模型连接' }}
          </n-button>
        </div>
      </n-card>

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
        <div class="setting-actions">
          <n-button round strong @click="handleImportJson">
            <template #icon>
              <Download :size="16" />
            </template>
            导入项目 JSON
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
            :class="{ active: appStore.currentProject?.writingStylePresetId === preset.id }"
            :style="{ background: preset.accent }"
            @click="updateWritingStylePreset(preset.id)"
          >
            <strong>{{ preset.label }}</strong>
            <span>{{ preset.description }}</span>
          </button>
        </div>
        <n-form-item label="补充风格要求">
          <n-input
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 7 }"
            :value="appStore.currentProject?.writingStylePrompt ?? ''"
            @update:value="(value) => updateWritingStylePrompt(value)"
            placeholder="例如：对话更克制，避免现代网络口头禅；环境描写多用霓虹、雨幕、金属反光等意象。"
          />
        </n-form-item>
        <div class="style-footnote">
          当前章节助理、灵感生成、大纲扩写和角色/设定生成都会优先参考这里的项目风格。
        </div>
      </n-card>

      <n-card class="setting-card" :bordered="false">
        <template #header>
          <div class="block-title">
            <Palette :size="18" />
            <span>主题色</span>
          </div>
        </template>
        <n-form-item label="应用主题色">
          <n-select
            :options="themeOptions"
            :value="appStore.theme"
            @update:value="(value) => appStore.setTheme((value ?? 'ocean') as ThemeName)"
          />
        </n-form-item>
        <div class="theme-swatches">
          <button
            v-for="preset in themePresets"
            :key="preset.name"
            class="theme-dot"
            :class="{ active: appStore.theme === preset.name }"
            :style="{ background: preset.primary }"
            @click="appStore.setTheme(preset.name)"
          >
            <span>{{ preset.label }}</span>
          </button>
        </div>
      </n-card>
    </div>
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
  color: #86868b;
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
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 22px;
  background:
    radial-gradient(circle at top right, rgba(191, 219, 254, 0.28), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 250, 255, 0.96));
  padding: 16px 18px;
  margin-bottom: 16px;
}

.style-hero strong {
  display: block;
  color: #0f172a;
  font-size: 16px;
  font-weight: 700;
}

.style-hero p {
  margin: 8px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.7;
}

.style-hero-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: rgba(239, 246, 255, 0.95);
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
  border: 1px solid rgba(226, 232, 240, 0.94);
  border-radius: 20px;
  color: #0f172a;
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
  border-color: color-mix(in srgb, var(--arc-primary) 34%, white);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 10%, transparent);
}

.style-preset-card strong {
  font-size: 14px;
  font-weight: 700;
}

.style-preset-card span {
  color: #475569;
  font-size: 12px;
  line-height: 1.6;
}

.style-footnote {
  color: #64748b;
  font-size: 12px;
  line-height: 1.7;
}

.provider-hint-block {
  margin: -2px 0 14px;
  border: 1px solid rgba(229, 231, 235, 0.9);
  border-radius: 12px;
  background: #f8fafc;
  padding: 12px 14px;
}

.provider-hint-block strong {
  display: block;
  margin-bottom: 4px;
  color: #1f2937;
  font-size: 13px;
}

.provider-hint-block p {
  margin: 0 0 8px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.7;
}

.provider-hint-block code {
  color: #334155;
  font-size: 12px;
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
  border-top: 1px solid rgba(229, 231, 235, 0.88);
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
  border: 1px solid rgba(229, 231, 235, 0.92);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.96));
  color: #374151;
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
  border-color: color-mix(in srgb, var(--arc-primary) 18%, white);
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.05);
}

.module-export-card :deep(svg) {
  color: var(--arc-primary);
}

.module-export-card strong {
  font-size: 14px;
}

.module-export-card span {
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}

.storage-status {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid rgba(229, 231, 235, 0.9);
  border-radius: 18px;
  background: rgba(248, 250, 252, 0.82);
  padding: 14px 16px;
  margin-bottom: 18px;
}

.storage-status strong {
  font-size: 13px;
}

.storage-status span {
  color: #6b7280;
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

.theme-swatches {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.theme-dot {
  display: flex;
  width: 58px;
  height: 58px;
  align-items: end;
  justify-content: center;
  border: 3px solid transparent;
  border-radius: 18px;
  color: white;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  padding-bottom: 8px;
}

.theme-dot.active {
  border-color: #1d1d1f;
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
}
</style>
