<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Cpu, Download, MonitorCog, Moon, Palette, PlugZap, RefreshCw, Save } from 'lucide-vue-next'
import { NButton, NFormItem, NInput, NModal, NSelect, NSwitch, useMessage } from 'naive-ui'
import { autoSaveOptions, formatAutoSaveIntervalLabel, isLiveAutoSaveInterval } from '@/features/settings/autoSave'
import { getProviderPreset, providerOptions, resolveProviderDefaults } from '@/features/settings/providerPresets'
import { useAppStore } from '@/stores/app'
import { themePresets } from '@/theme/presets'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { AppSettings, ThemeName } from '@/types/app'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
}>()

const appStore = useAppStore()
const message = useMessage()
const isTestingAiConnection = ref(false)
const isFetchingModels = ref(false)
const fetchedModels = ref<Array<{ id: string; ownedBy: string | null }>>([])

const autoSaveSelectOptions = [...autoSaveOptions]
const themeOptions = themePresets.map((preset) => ({ label: preset.label, value: preset.name }))
const uiScaleOptions = [
  { label: '75%', value: 0.75 },
  { label: '85%', value: 0.85 },
  { label: '100%', value: 1 },
  { label: '110%', value: 1.1 },
  { label: '125%', value: 1.25 },
  { label: '140%', value: 1.4 }
]

const draftSettings = reactive<AppSettings>({
  provider: '',
  model: '',
  apiKey: '',
  baseUrl: '',
  autoSaveInterval: '5m',
  uiScale: 1,
  darkMode: false
})
const draftTheme = ref<ThemeName>('ocean')

const activeProviderPreset = computed(() => getProviderPreset(draftSettings.provider))
const activeThemePreset = computed(() => themePresets.find((preset) => preset.name === draftTheme.value) ?? themePresets[0])
const draftAutoSaveLabel = computed(() => formatAutoSaveIntervalLabel(draftSettings.autoSaveInterval))
const isDraftLiveAutoSave = computed(() => isLiveAutoSaveInterval(draftSettings.autoSaveInterval))
const modelSelectOptions = computed(() =>
  fetchedModels.value.map((m) => ({ label: m.id, value: m.id }))
)
const hasPendingChanges = computed(() =>
  draftTheme.value !== appStore.theme
  || draftSettings.provider !== appStore.appSettings.provider
  || draftSettings.model !== appStore.appSettings.model
  || draftSettings.apiKey !== appStore.appSettings.apiKey
  || draftSettings.baseUrl !== appStore.appSettings.baseUrl
  || draftSettings.autoSaveInterval !== appStore.appSettings.autoSaveInterval
  || draftSettings.uiScale !== appStore.appSettings.uiScale
  || draftSettings.darkMode !== appStore.appSettings.darkMode
)

function syncDraftFromStore(): void {
  draftSettings.provider = appStore.appSettings.provider
  draftSettings.model = appStore.appSettings.model
  draftSettings.apiKey = appStore.appSettings.apiKey
  draftSettings.baseUrl = appStore.appSettings.baseUrl
  draftSettings.autoSaveInterval = appStore.appSettings.autoSaveInterval
  draftSettings.uiScale = appStore.appSettings.uiScale
  draftSettings.darkMode = appStore.appSettings.darkMode
  draftTheme.value = appStore.theme
}

watch(
  () => props.show,
  (show) => {
    if (show) {
      syncDraftFromStore()
    }
  },
  { immediate: true }
)

function closeModal(): void {
  syncDraftFromStore()
  emit('update:show', false)
}

function handleProviderChange(provider: string): void {
  const defaults = resolveProviderDefaults(provider)
  draftSettings.provider = provider
  draftSettings.model = defaults.model
  draftSettings.baseUrl = defaults.baseUrl
  fetchedModels.value = []
}

async function handleFetchModels(): Promise<void> {
  if (isFetchingModels.value) return
  isFetchingModels.value = true
  try {
    const result = await window.characterArc.fetchModels(toIpcPayload({ ...draftSettings }))
    if (!result.success) throw new Error(result.error ?? '获取模型列表失败')
    fetchedModels.value = result.result ?? []
    if (fetchedModels.value.length === 0) {
      message.warning('该供应商未返回任何可用模型，请手动输入模型名称。')
    } else {
      message.success(`获取到 ${fetchedModels.value.length} 个可用模型`)
    }
  } catch (error) {
    fetchedModels.value = []
    message.error(error instanceof Error ? error.message : '获取模型列表失败')
  } finally {
    isFetchingModels.value = false
  }
}

async function handleTestAiConnection(): Promise<void> {
  if (isTestingAiConnection.value) return
  isTestingAiConnection.value = true
  try {
    const result = await window.characterArc.testAiConnection(toIpcPayload({ ...draftSettings }))
    if (!result.success) throw new Error(result.error ?? '模型连接测试失败')
    const payload = result.result as { provider?: string; model?: string } | undefined
    message.success(`模型连接成功：${payload?.provider ?? draftSettings.provider} / ${payload?.model ?? draftSettings.model}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '模型连接测试失败')
  } finally {
    isTestingAiConnection.value = false
  }
}

function saveSettings(): void {
  appStore.updateAppSetting('provider', draftSettings.provider)
  appStore.updateAppSetting('model', draftSettings.model)
  appStore.updateAppSetting('apiKey', draftSettings.apiKey)
  appStore.updateAppSetting('baseUrl', draftSettings.baseUrl)
  appStore.updateAppSetting('autoSaveInterval', draftSettings.autoSaveInterval)
  appStore.updateAppSetting('uiScale', draftSettings.uiScale)
  appStore.updateAppSetting('darkMode', draftSettings.darkMode)

  if (draftTheme.value !== appStore.theme) {
    appStore.setTheme(draftTheme.value)
  }

  message.success('设置已保存')
  emit('update:show', false)
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    class="arc-settings-modal"
    title="设置"
    :bordered="false"
    @close="closeModal"
  >
    <div class="settings-layout">
      <aside class="settings-rail">


        <div class="rail-stack">
          <div class="rail-card">
            <span class="rail-card-label">当前模型</span>
            <strong>{{ activeProviderPreset.label }}</strong>
            <p>{{ draftSettings.model }}</p>
          </div>
          <div class="rail-card theme-card">
            <span class="rail-card-label">当前主题</span>
            <strong>{{ activeThemePreset.label }}</strong>
            <div class="rail-theme-preview" :style="{ background: activeThemePreset.primary }"></div>
          </div>
          <div class="rail-card">
            <span class="rail-card-label">自动保存</span>
            <strong>{{ draftAutoSaveLabel }}</strong>
            <p>{{ isDraftLiveAutoSave ? '正文与工作区修改会尽快落盘。' : '按设定节奏进入自动保存队列。' }}</p>
          </div>
          <div class="rail-card draft-state-card" :class="{ pending: hasPendingChanges }">
            <span class="rail-card-label">保存状态</span>
            <strong>{{ hasPendingChanges ? '有未保存修改' : '已与当前设置同步' }}</strong>
            <p>{{ hasPendingChanges ? '点击右下角保存设置后才会正式生效。' : '当前草稿和已保存设置一致。' }}</p>
          </div>
        </div>
      </aside>

      <div class="settings-main arc-scrollbar">
        <section class="settings-section">
          <div class="section-title">
            <Cpu :size="18" />
            <div>
              <strong>AI 接口配置</strong>
              <p>选择供应商并维护模型连接参数。</p>
            </div>
          </div>
          <div class="settings-grid">
            <n-form-item label="模型供应商">
              <n-select
                :options="providerOptions"
                :value="draftSettings.provider"
                @update:value="(value) => handleProviderChange(value ?? 'deepseek')"
              />
            </n-form-item>
            <n-form-item label="模型名称">
              <div class="model-input-row">
                <n-select
                  v-if="fetchedModels.length > 0"
                  :options="modelSelectOptions"
                  :value="draftSettings.model"
                  filterable
                  tag
                  placeholder="选择或输入模型名称"
                  @update:value="(value: string) => { draftSettings.model = value }"
                />
                <n-input
                  v-else
                  :value="draftSettings.model"
                  :placeholder="`例如：${activeProviderPreset.model}`"
                  @update:value="(value) => { draftSettings.model = value }"
                />
                <n-button
                  quaternary
                  class="model-fetch-btn"
                  :disabled="isFetchingModels"
                  @click="handleFetchModels"
                >
                  <template #icon>
                    <RefreshCw v-if="fetchedModels.length > 0" :size="16" :class="{ 'spin-icon': isFetchingModels }" />
                    <Download v-else :size="16" :class="{ 'spin-icon': isFetchingModels }" />
                  </template>
                </n-button>
              </div>
            </n-form-item>
          </div>
          <div class="provider-hint-block">
            <strong>{{ activeProviderPreset.label }}</strong>
            <p>{{ activeProviderPreset.hint }}</p>
            <code>{{ activeProviderPreset.baseUrl }}</code>
          </div>
          <div class="settings-grid">
            <n-form-item label="API Key">
              <n-input
                type="password"
                show-password-on="click"
                :value="draftSettings.apiKey"
                :placeholder="draftSettings.provider === 'ollama' ? '本地 Ollama 通常不需要 API Key' : '填写对应平台或网关的 Token'"
                @update:value="(value) => { draftSettings.apiKey = value }"
              />
            </n-form-item>
            <n-form-item label="Base URL">
              <n-input
                :value="draftSettings.baseUrl"
                placeholder="支持官方接口地址，也支持 OpenAI 兼容网关地址"
                @update:value="(value) => { draftSettings.baseUrl = value }"
              />
            </n-form-item>
          </div>
          <div class="section-actions">
            <n-button round strong secondary :disabled="isTestingAiConnection" @click="handleTestAiConnection">
              <template #icon>
                <PlugZap :size="16" />
              </template>
              {{ isTestingAiConnection ? '测试中...' : '测试模型连接' }}
            </n-button>
          </div>
        </section>

        <section class="settings-section">
          <div class="section-title">
            <Palette :size="18" />
            <div>
              <strong>界面主题</strong>
              <p>统一首页与工作台的主色体验。</p>
            </div>
          </div>
          <n-form-item label="应用主题色">
            <n-select
              :options="themeOptions"
              :value="draftTheme"
              @update:value="(value) => { draftTheme = (value ?? 'ocean') as ThemeName }"
            />
          </n-form-item>
          <div class="theme-swatches">
            <button
              v-for="preset in themePresets"
              :key="preset.name"
              class="theme-dot"
              :class="{ active: draftTheme === preset.name }"
              :style="{ background: preset.primary }"
              @click="draftTheme = preset.name"
            >
              <span>{{ preset.label }}</span>
            </button>
          </div>
        </section>

        <section class="settings-section">
          <div class="section-title">
            <MonitorCog :size="18" />
            <div>
              <strong>应用偏好</strong>
              <p>影响整个应用的保存节奏与显示比例。</p>
            </div>
          </div>
          <div class="settings-grid">
            <n-form-item label="自动保存时间间隔">
              <n-select
                :options="autoSaveSelectOptions"
                :value="draftSettings.autoSaveInterval"
                @update:value="(value) => { draftSettings.autoSaveInterval = value ?? '5m' }"
              />
            </n-form-item>
            <n-form-item label="界面缩放比例">
              <n-select
                :options="uiScaleOptions"
                :value="draftSettings.uiScale"
                @update:value="(value) => { draftSettings.uiScale = value ?? 1 }"
              />
            </n-form-item>
          </div>
          <div class="dark-mode-row">
            <div class="dark-mode-label">
              <Moon :size="15" />
              <span>深色模式</span>
              <span class="dark-mode-hint">将界面切换为深色背景，适合夜间长时间写作。</span>
            </div>
            <n-switch
              :value="draftSettings.darkMode"
              @update:value="(value) => { draftSettings.darkMode = value }"
            />
          </div>
          <div class="storage-note">
            <Save :size="16" />
            <span>{{ appStore.persistenceError || '当前工作区内容已接入本地 SQLite 持久化。' }}</span>
          </div>
        </section>
      </div>
    </div>

    <template #footer>
      <div class="settings-footer-actions">
        <n-button round strong @click="closeModal">取消</n-button>
        <n-button type="primary" round strong :disabled="!hasPendingChanges" @click="saveSettings">保存设置</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
  gap: 22px;
}

.settings-rail {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.settings-rail-head {
  padding: 4px 2px;
}

.rail-kicker {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-mix));
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 700;
  padding: 0 12px;
}

.settings-rail-head h3 {
  margin: 14px 0 10px;
  color: var(--arc-text-primary);
  font-size: 24px;
  font-weight: 730;
  letter-spacing: -0.03em;
}

.settings-rail-head p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.rail-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rail-card {
  border: 1px solid color-mix(in srgb, var(--arc-primary) 12%, var(--arc-border));
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 16px;
}

.draft-state-card.pending {
  border-color: color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-mix));
}

.rail-card-label {
  display: block;
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.rail-card strong {
  display: block;
  margin-top: 8px;
  color: var(--arc-text-primary);
  font-size: 16px;
  font-weight: 700;
}

.rail-card p {
  margin: 6px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.rail-theme-preview {
  width: 100%;
  height: 44px;
  margin-top: 12px;
  border-radius: 14px;
}

.settings-main {
  max-height: min(76vh, 760px);
  overflow: auto;
  padding-right: 4px;
}

.settings-section {
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  padding: 20px;
}

.settings-section + .settings-section {
  margin-top: 16px;
}

.section-title {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
}

.section-title :deep(svg) {
  margin-top: 2px;
  color: var(--arc-primary);
}

.section-title strong {
  display: block;
  color: var(--arc-text-primary);
  font-size: 15px;
  font-weight: 700;
}

.section-title p {
  margin: 6px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.provider-hint-block {
  margin: -2px 0 16px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 12%, var(--arc-border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-primary) 4%, var(--arc-bg-mix));
  padding: 14px 16px;
}

.provider-hint-block strong {
  display: block;
  margin-bottom: 6px;
  color: var(--arc-text-primary);
  font-size: 13px;
  font-weight: 700;
}

.provider-hint-block p {
  margin: 0 0 8px;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.provider-hint-block code {
  display: inline-block;
  border-radius: 8px;
  background: var(--arc-glass-08);
  color: var(--arc-text-hint);
  font-size: 12px;
  padding: 3px 8px;
}

.section-actions {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.model-input-row {
  display: flex;
  gap: 6px;
  width: 100%;
}

.model-input-row .n-select {
  flex: 1;
}

.model-input-row .n-input {
  flex: 1;
}

.model-fetch-btn {
  flex-shrink: 0;
}

.spin-icon {
  animation: arc-spin 1s linear infinite;
}

@keyframes arc-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.theme-swatches {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.theme-dot {
  display: flex;
  min-height: 82px;
  align-items: flex-end;
  justify-content: center;
  border: 2px solid transparent;
  border-radius: 8px;
  color: white;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  padding: 12px;
  transition:
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.theme-dot:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.12);
}

.theme-dot:active {
  transform: scale(0.98);
}

.theme-dot.active {
  border-color: white;
  box-shadow: 0 0 0 2px var(--arc-bg-surface), 0 0 0 4px color-mix(in srgb, var(--arc-primary) 34%, transparent);
}

.storage-note {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  margin-top: 4px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-mix));
  color: var(--arc-text-secondary);
  font-size: 12px;
  padding: 0 12px;
}

.storage-note :deep(svg) {
  color: var(--arc-primary);
}

.dark-mode-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 14px;
  border: 1px solid var(--arc-border);
  border-radius: 14px;
  padding: 12px 16px;
}

.dark-mode-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 600;
}

.dark-mode-label :deep(svg) {
  color: var(--arc-primary);
  flex-shrink: 0;
}

.dark-mode-hint {
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 400;
}

.settings-footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

@media (max-width: 960px) {
  .settings-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .settings-grid,
  .theme-swatches {
    grid-template-columns: 1fr;
  }

  .settings-section,
  .rail-card {
    border-radius: 8px;
  }

  .settings-footer-actions {
    width: 100%;
  }

  .settings-footer-actions :deep(.n-button) {
    flex: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .theme-dot {
    transition: none;
  }
}
</style>
