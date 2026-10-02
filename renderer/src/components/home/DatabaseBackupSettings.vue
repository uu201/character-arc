<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { DatabaseBackup, RefreshCw, RotateCcw, Save } from 'lucide-vue-next'
import { NButton, NSelect, useDialog, useMessage } from 'naive-ui'
import type { DatabaseBackupSummary } from '@shared/ipc-types'
import { DATABASE_ROLLBACK_RELOAD_FLAG } from '@/features/settings/databaseRollback'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const backups = ref<DatabaseBackupSummary[]>([])
const selectedBackupId = ref<string | null>(null)
const isLoading = ref(false)
const isBackingUp = ref(false)
const isRollingBack = ref(false)
const backupMenuProps = {
  class: 'database-backup-menu',
  style: {
    '--n-height': 'min(320px, calc(100vh - 180px))'
  }
}

const backupOptions = computed(() => backups.value.map((backup) => ({
  label: `${formatDate(backup.createdAt)} · ${formatType(backup.type)} · v${backup.appVersion || '未知'} / Schema ${backup.schemaVersion} · ${formatSize(backup.size)}`,
  value: backup.id
})))

const selectedBackup = computed(() =>
  backups.value.find((backup) => backup.id === selectedBackupId.value) ?? null
)

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date)
}

function formatType(type: DatabaseBackupSummary['type']): string {
  if (type === 'manual') return '手动备份'
  return type === 'pre-upgrade' ? '升级前备份' : '回滚前备份'
}

function formatSize(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

async function persistCurrentWorkspace(action: string): Promise<void> {
  await appStore.persistWorkspace()
  if (appStore.persistenceError) {
    throw new Error(`当前数据保存失败，已取消${action}：${appStore.persistenceError}`)
  }
}

async function loadBackups(): Promise<void> {
  isLoading.value = true
  try {
    const result = await window.characterArc.listDatabaseBackups()
    if (!result.success) throw new Error(result.error ?? '读取数据库备份失败')
    backups.value = result.backups ?? []
    if (!backups.value.some((backup) => backup.id === selectedBackupId.value)) {
      selectedBackupId.value = backups.value[0]?.id ?? null
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取数据库备份失败')
  } finally {
    isLoading.value = false
  }
}

async function backupCurrentDatabase(): Promise<void> {
  if (isBackingUp.value || isRollingBack.value) return
  isBackingUp.value = true
  try {
    await persistCurrentWorkspace('备份')
    const result = await window.characterArc.backupCurrentDatabase()
    if (!result.success) throw new Error(result.error ?? '备份当前数据库失败')
    message.success('当前数据库已备份')
    await loadBackups()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '备份当前数据库失败')
  } finally {
    isBackingUp.value = false
  }
}

function rollbackDatabase(): void {
  const backup = selectedBackup.value
  if (!backup || isBackingUp.value || isRollingBack.value) return

  dialog.warning({
    title: '确认回滚数据库',
    content: `将把全部项目与设置回滚到 ${formatDate(backup.createdAt)} 的${formatType(backup.type)}。回滚前会再次备份当前数据库，完成后页面将自动重新载入。`,
    positiveText: '备份当前数据并回滚',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: async () => {
      isRollingBack.value = true
      try {
        await persistCurrentWorkspace('回滚')
        window.sessionStorage.setItem(DATABASE_ROLLBACK_RELOAD_FLAG, '1')
        const result = await window.characterArc.rollbackDatabase({ backupId: backup.id })
        if (!result.success) throw new Error(result.error ?? '数据库回滚失败')
        message.loading('数据库回滚完成，正在重新载入…', { duration: 0 })
        window.location.reload()
      } catch (error) {
        window.sessionStorage.removeItem(DATABASE_ROLLBACK_RELOAD_FLAG)
        isRollingBack.value = false
        message.error(error instanceof Error ? error.message : '数据库回滚失败')
        return false
      }
    }
  })
}

onMounted(() => {
  void loadBackups()
})
</script>

<template>
  <section id="sec-database" class="settings-section database-settings-section">
    <div class="section-title">
      <DatabaseBackup :size="18" />
      <div>
        <strong>数据库备份与回滚</strong>
        <p>备份或恢复整套应用数据，包括全部项目、章节正文、历史版本和设置。</p>
      </div>
    </div>

    <div class="database-actions-card">
      <div class="database-action-copy">
        <strong>备份当前数据库</strong>
        <span>创建一份经过完整性检查的手动备份，并自动加入下方回滚列表。</span>
      </div>
      <n-button
        strong
        secondary
        :loading="isBackingUp"
        :disabled="isRollingBack"
        @click="backupCurrentDatabase"
      >
        <template #icon><Save :size="16" /></template>
        立即备份
      </n-button>
    </div>

    <div class="database-rollback-card">
      <div class="database-rollback-head">
        <div class="database-action-copy">
          <strong>回滚数据库</strong>
          <span>选择已有备份恢复；执行前仍会自动备份一次当前数据库。</span>
        </div>
        <n-button quaternary circle :loading="isLoading" title="刷新备份列表" @click="loadBackups">
          <template #icon><RefreshCw :size="16" /></template>
        </n-button>
      </div>
      <div class="database-warning">
        回滚会替换当前全部数据并重新载入页面，请确认备份时间无误。
      </div>
      <div class="database-rollback-actions">
        <n-select
          v-model:value="selectedBackupId"
          class="database-backup-select"
          :options="backupOptions"
          :loading="isLoading"
          :disabled="isRollingBack || isBackingUp"
          to="body"
          placement="top-start"
          :virtual-scroll="false"
          :menu-props="backupMenuProps"
          :placeholder="backups.length ? '选择数据库备份' : '暂无可用数据库备份'"
        />
        <n-button
          type="error"
          strong
          :disabled="!selectedBackupId || isLoading || isBackingUp"
          :loading="isRollingBack"
          @click="rollbackDatabase"
        >
          <template #icon><RotateCcw :size="16" /></template>
          回滚数据库
        </n-button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-section {
  padding-bottom: 28px;
  margin-bottom: 28px;
  border-bottom: 1px solid var(--arc-bg-surface-hover);
}

.database-settings-section {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 8px;
}

.section-title {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 18px;
}

.section-title :deep(svg) {
  margin-top: 2px;
  color: var(--arc-primary);
}

.section-title strong,
.database-action-copy strong {
  display: block;
  color: var(--arc-text-primary);
  font-size: 15px;
  font-weight: 700;
}

.section-title p {
  margin: 4px 0 0;
  color: var(--arc-text-hint);
  font-size: 12.5px;
}

.database-actions-card,
.database-rollback-card {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 16px;
}

.database-actions-card,
.database-rollback-head,
.database-rollback-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.database-rollback-card {
  margin-top: 14px;
}

.database-action-copy {
  min-width: 0;
}

.database-action-copy strong {
  font-size: 13.5px;
}

.database-action-copy span {
  display: block;
  margin-top: 4px;
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.6;
}

.database-warning {
  margin-top: 14px;
  border: 1px solid color-mix(in srgb, var(--arc-danger) 28%, var(--arc-border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-danger) 7%, var(--arc-bg-surface));
  color: var(--arc-danger);
  font-size: 12px;
  line-height: 1.6;
  padding: 11px 13px;
}

.database-rollback-actions {
  margin-top: 14px;
}

.database-backup-select {
  min-width: 0;
  flex: 1;
}

:global(.database-backup-menu) {
  max-height: min(320px, calc(100vh - 180px));
}

@media (max-width: 720px) {
  .database-actions-card,
  .database-rollback-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
