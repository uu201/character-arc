<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { DatabaseBackup, FolderOpen, RefreshCw, RotateCcw, Save, Trash2 } from 'lucide-vue-next'
import { NButton, useDialog, useMessage } from 'naive-ui'
import type { DatabaseBackupSummary } from '@shared/ipc-types'
import { DATABASE_ROLLBACK_RELOAD_FLAG } from '@/features/settings/databaseRollback'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const backups = ref<DatabaseBackupSummary[]>([])
const backupDirectory = ref('')
const isLoading = ref(false)
const isBackingUp = ref(false)
const isRollingBack = ref(false)
const rollingBackBackupId = ref('')
const deletingBackupId = ref('')

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
    backupDirectory.value = result.backupDirectory ?? ''
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取数据库备份失败')
  } finally {
    isLoading.value = false
  }
}

async function backupCurrentDatabase(): Promise<void> {
  if (isBackingUp.value || isRollingBack.value || deletingBackupId.value) return
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

function rollbackDatabase(backup: DatabaseBackupSummary): void {
  if (isBackingUp.value || isRollingBack.value || deletingBackupId.value) return

  dialog.warning({
    title: '确认回滚数据库',
    content: `将把全部项目与设置回滚到 ${formatDate(backup.createdAt)} 的${formatType(backup.type)}。回滚前会再次备份当前数据库，完成后页面将自动重新载入。`,
    positiveText: '备份当前数据并回滚',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: async () => {
      isRollingBack.value = true
      rollingBackBackupId.value = backup.id
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
        rollingBackBackupId.value = ''
        message.error(error instanceof Error ? error.message : '数据库回滚失败')
        return false
      }
    }
  })
}

function deleteDatabaseBackup(backup: DatabaseBackupSummary): void {
  if (isBackingUp.value || isRollingBack.value || deletingBackupId.value) return

  dialog.warning({
    title: '删除数据库备份',
    content: `确定删除 ${formatDate(backup.createdAt)} 的${formatType(backup.type)}吗？删除后无法再从这份备份回滚。`,
    positiveText: '删除备份',
    negativeText: '取消',
    type: 'error',
    autoFocus: false,
    closable: false,
    onPositiveClick: async () => {
      deletingBackupId.value = backup.id
      try {
        const result = await window.characterArc.deleteDatabaseBackup({ backupId: backup.id })
        if (!result.success) throw new Error(result.error ?? '删除数据库备份失败')
        message.success('数据库备份已删除')
        await loadBackups()
      } catch (error) {
        message.error(error instanceof Error ? error.message : '删除数据库备份失败')
      } finally {
        deletingBackupId.value = ''
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
        <div class="database-location">
          <FolderOpen :size="14" />
          <span>备份保存位置</span>
          <code>{{ backupDirectory || '读取中…' }}</code>
        </div>
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
        :disabled="isRollingBack || Boolean(deletingBackupId)"
        @click="backupCurrentDatabase"
      >
        <template #icon><Save :size="16" /></template>
        立即备份
      </n-button>
    </div>

    <div class="database-list-card">
      <div class="database-list-head">
        <div class="database-action-copy">
          <strong>备份列表</strong>
          <span>每份备份都可以单独回滚或删除。</span>
        </div>
        <n-button quaternary circle :loading="isLoading" title="刷新备份列表" @click="loadBackups">
          <template #icon><RefreshCw :size="16" /></template>
        </n-button>
      </div>
      <div class="database-warning">
        回滚会替换当前全部数据并重新载入页面；删除备份后无法再从该备份恢复。
      </div>
      <div v-if="backups.length" class="backup-list" :aria-busy="isLoading">
        <article v-for="backup in backups" :key="backup.id" class="backup-list-row">
          <div class="backup-list-details">
            <div class="backup-list-title">
              <strong>{{ formatType(backup.type) }}</strong>
              <span>v{{ backup.appVersion || '未知' }} · Schema {{ backup.schemaVersion }}</span>
            </div>
            <div class="backup-list-meta">
              <time :datetime="backup.createdAt">{{ formatDate(backup.createdAt) }}</time>
              <span>{{ formatSize(backup.size) }}</span>
            </div>
          </div>
          <div class="backup-list-actions">
            <n-button
              size="small"
              secondary
              :disabled="isBackingUp || isRollingBack || Boolean(deletingBackupId) || isLoading"
              :loading="rollingBackBackupId === backup.id"
              @click="rollbackDatabase(backup)"
            >
              <template #icon><RotateCcw :size="14" /></template>
              回滚
            </n-button>
            <n-button
              size="small"
              quaternary
              circle
              type="error"
              :title="`删除${formatType(backup.type)}`"
              :aria-label="`删除${formatType(backup.type)} ${formatDate(backup.createdAt)}`"
              :disabled="isBackingUp || isRollingBack || Boolean(deletingBackupId) || isLoading"
              :loading="deletingBackupId === backup.id"
              @click="deleteDatabaseBackup(backup)"
            >
              <template #icon><Trash2 :size="15" /></template>
            </n-button>
          </div>
        </article>
      </div>
      <div v-else class="backup-empty-state">
        {{ isLoading ? '正在读取备份…' : '暂无可用数据库备份' }}
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

.database-location {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.6;
}

.database-location :deep(svg) {
  flex: none;
  margin-top: 2px;
}

.database-location code {
  min-width: 0;
  color: var(--arc-text-secondary);
  overflow-wrap: anywhere;
  user-select: text;
}

.database-actions-card,
.database-list-card {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 16px;
}

.database-actions-card,
.database-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.database-list-card {
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

.backup-list {
  margin-top: 12px;
}

.backup-list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--arc-border);
}

.backup-list-details {
  min-width: 0;
}

.backup-list-title,
.backup-list-meta,
.backup-list-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.backup-list-title {
  flex-wrap: wrap;
  color: var(--arc-text-primary);
  font-size: 12.5px;
}

.backup-list-title span,
.backup-list-meta {
  color: var(--arc-text-hint);
  font-size: 11.5px;
}

.backup-list-meta {
  flex-wrap: wrap;
  gap: 5px 12px;
  margin-top: 5px;
}

.backup-list-actions {
  flex: none;
}

.backup-empty-state {
  border-top: 1px solid var(--arc-border);
  margin-top: 12px;
  padding: 20px 8px 6px;
  color: var(--arc-text-hint);
  font-size: 12px;
  text-align: center;
}

@media (max-width: 720px) {
  .database-actions-card,
  .backup-list-row {
    align-items: stretch;
    flex-direction: column;
  }

  .backup-list-actions {
    justify-content: flex-end;
  }
}
</style>
