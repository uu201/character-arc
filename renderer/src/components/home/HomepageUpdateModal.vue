<script setup lang="ts">
import { computed, ref } from 'vue'
import { marked } from 'marked'
import { ArrowUpCircle, Download, ExternalLink } from 'lucide-vue-next'
import { NButton, NModal, NResult, NSpin, NTag } from 'naive-ui'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
}>()

const loading = ref(false)
const error = ref('')
const updateInfo = ref<{
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseTitle: string
  releaseNotes: string
  releaseUrl: string
  publishedAt: string
  assets: Array<{ name: string; downloadUrl: string; size: number }>
} | null>(null)

async function check(): Promise<void> {
  loading.value = true
  error.value = ''
  updateInfo.value = null
  try {
    const result = await window.characterArc.checkUpdate()
    if (!result.success || !result.result) {
      error.value = result.error ?? '检查更新失败，请稍后重试'
      return
    }
    updateInfo.value = result.result
  } catch (err) {
    error.value = err instanceof Error ? err.message : '网络异常，无法连接更新服务器'
  } finally {
    loading.value = false
  }
}

function openUrl(url: string): void {
  window.characterArc.openExternalUrl(url)
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

const renderedNotes = computed(() => {
  const notes = updateInfo.value?.releaseNotes
  if (!notes) return ''
  return marked.parse(notes, { async: false }) as string
})

function handleAfterEnter(): void {
  if (!updateInfo.value && !loading.value && !error.value) {
    check()
  }
}
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    class="arc-editor-modal"
    title="检查更新"
    :bordered="false"
    @close="emit('update:show', false)"
    @after-enter="handleAfterEnter"
  >
    <!-- Loading -->
    <div v-if="loading" class="update-state-body">
      <n-spin size="medium" />
      <p>正在检查最新版本...</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="update-state-body">
      <n-result status="error" :description="error" size="small">
        <template #footer>
          <n-button @click="check">重试</n-button>
        </template>
      </n-result>
    </div>

    <!-- Up to date -->
    <div v-else-if="updateInfo && !updateInfo.hasUpdate" class="update-state-body">
      <n-result status="success" title="已是最新版本" :description="`当前版本 v${updateInfo.currentVersion}`" size="small" />
    </div>

    <!-- Has Update -->
    <template v-else-if="updateInfo?.hasUpdate">
      <div class="update-top">
        <ArrowUpCircle :size="28" class="update-icon" />
        <div class="update-top-copy">
          <h3>发现新版本</h3>
          <div class="update-version-row">
            <n-tag size="small" type="info">v{{ updateInfo.currentVersion }}</n-tag>
            <span class="update-arrow">→</span>
            <n-tag size="small" type="success">v{{ updateInfo.latestVersion }}</n-tag>
            <span v-if="updateInfo.publishedAt" class="update-date">{{ formatDate(updateInfo.publishedAt) }}</span>
          </div>
        </div>
      </div>

      <div class="update-scroll">
        <div v-if="updateInfo.releaseNotes" class="update-notes">
          <h4>更新说明</h4>
          <div class="update-notes-content" v-html="renderedNotes" />
        </div>

        <div v-if="updateInfo.assets.length" class="update-assets">
          <h4>下载安装包</h4>
          <div v-for="asset in updateInfo.assets" :key="asset.name" class="asset-item">
            <span class="asset-name">{{ asset.name }}</span>
            <span class="asset-size">{{ formatSize(asset.size) }}</span>
            <n-button size="small" type="primary" @click="openUrl(asset.downloadUrl)">
              <template #icon><Download :size="14" /></template>
              下载
            </n-button>
          </div>
        </div>
      </div>

      <div v-if="updateInfo.releaseUrl" class="update-bottom">
        <n-button block secondary @click="openUrl(updateInfo.releaseUrl)">
          <template #icon><ExternalLink :size="14" /></template>
          在浏览器中查看完整发布说明
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
/* loading / error / up-to-date 三种轻量状态共用，居中展示 */
.update-state-body {
  min-height: 140px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 16px 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
}

/* 有更新时：顶部版本信息固定 */
.update-top {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--arc-border);
  margin-bottom: 16px;
}

.update-icon {
  color: var(--arc-primary);
  flex-shrink: 0;
  margin-top: 2px;
}

.update-top-copy h3 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--arc-text-primary);
}

.update-version-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.update-arrow {
  color: var(--arc-text-hint);
  font-size: 13px;
}

.update-date {
  margin-left: 4px;
  color: var(--arc-text-hint);
  font-size: 12px;
}

/* 中间滚动区：更新说明 + 下载列表，最多 280px 防止撑高 */
.update-scroll {
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.update-notes h4,
.update-assets h4 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-secondary);
}

.update-notes-content {
  padding: 12px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-weak);
  font-size: 13px;
  line-height: 1.65;
  color: var(--arc-text-secondary);
}

.update-notes-content :deep(h1),
.update-notes-content :deep(h2),
.update-notes-content :deep(h3) {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.update-notes-content :deep(ul),
.update-notes-content :deep(ol) {
  margin: 4px 0;
  padding-left: 18px;
}

.update-notes-content :deep(li) {
  margin-bottom: 2px;
}

.update-notes-content :deep(p) {
  margin: 4px 0;
}

.update-notes-content :deep(code) {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--arc-bg-surface);
  font-size: 12px;
}

.asset-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  margin-bottom: 8px;
}

.asset-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-size {
  color: var(--arc-text-hint);
  font-size: 12px;
  flex-shrink: 0;
}

/* 底部操作按钮固定在滚动区下方 */
.update-bottom {
  padding-top: 14px;
  border-top: 1px solid var(--arc-border);
  margin-top: 16px;
}
</style>
