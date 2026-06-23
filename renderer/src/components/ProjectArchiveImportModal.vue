<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NFormItem, NModal, NRadioButton, NRadioGroup, NSelect, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const message = useMessage()

const archiveImportModalVisible = ref(false)
const archiveImportPreview = ref<CharacterArcProjectArchivePreview | null>(null)
const archiveImportFilePath = ref('')
const archiveImportMode = ref<CharacterArcProjectArchiveImportMode>('new-project')
const archiveTargetProjectId = ref('')
const archiveSelectedModules = ref<CharacterArcProjectArchiveModule[]>([])
const isInspectingArchive = ref(false)
const isImportingArchive = ref(false)

const archiveModuleOptions: Array<{ label: string; value: CharacterArcProjectArchiveModule }> = [
  { label: '项目信息', value: 'project' },
  { label: '世界观', value: 'worldview' },
  { label: '角色与势力', value: 'characters' },
  { label: '关系组织', value: 'relations' },
  { label: '灵感卡片', value: 'inspiration' },
  { label: '大纲', value: 'outline' },
  { label: '伏笔线', value: 'plotThreads' },
  { label: '章节正文', value: 'chapters' },
  { label: '章节版本', value: 'chapterVersions' },
  { label: '流程文档', value: 'workflowDocuments' },
  { label: '知识文档', value: 'knowledgeDocuments' },
  { label: '参考作品', value: 'referenceWorks' },
  { label: 'AI 运行记录', value: 'aiRuns' },
  { label: '助手会话', value: 'assistantSessions' },
  { label: '参考原文资产', value: 'referenceNovelAssets' }
]

const archiveModeOptions: Array<{ label: string; value: CharacterArcProjectArchiveImportMode }> = [
  { label: '新建项目', value: 'new-project' },
  { label: '覆盖项目', value: 'overwrite-project' }
]

const projectSelectOptions = computed(() =>
  appStore.projects.map((project) => ({
    label: project.title,
    value: project.id
  }))
)

function resetArchiveModules(): void {
  archiveSelectedModules.value = archiveModuleOptions.map((option) => option.value)
}

async function pickArchive(): Promise<void> {
  isInspectingArchive.value = true
  try {
    const result = await window.characterArc.inspectProjectArchive()
    if (result.canceled) {
      return
    }
    if (!result.success || !result.preview || !result.filePath) {
      message.error(result.error ?? '无法读取项目归档包')
      return
    }
    archiveImportPreview.value = result.preview
    archiveImportFilePath.value = result.filePath
    archiveImportMode.value = 'new-project'
    archiveTargetProjectId.value = appStore.currentProject?.id ?? appStore.projects[0]?.id ?? ''
    resetArchiveModules()
    archiveImportModalVisible.value = true
  } finally {
    isInspectingArchive.value = false
  }
}

async function confirmArchiveImport(): Promise<void> {
  if (!archiveImportFilePath.value) {
    return
  }
  if (archiveSelectedModules.value.length === 0) {
    message.warning('请至少选择一个要导入的模块')
    return
  }
  if (archiveImportMode.value === 'overwrite-project' && !archiveTargetProjectId.value) {
    message.warning('请选择要覆盖的目标项目')
    return
  }

  isImportingArchive.value = true
  try {
    const result = await window.characterArc.importProjectArchive({
      filePath: archiveImportFilePath.value,
      mode: archiveImportMode.value,
      targetProjectId: archiveImportMode.value === 'overwrite-project' ? archiveTargetProjectId.value : undefined,
      modules: [...archiveSelectedModules.value]
    })
    if (!result.success) {
      message.error(result.error ?? '导入项目归档失败')
      return
    }

    await appStore.initialize()
    if (result.selectedProjectId) {
      appStore.openProject(result.selectedProjectId)
    }
    archiveImportModalVisible.value = false
    message.success('项目归档包已导入')
  } finally {
    isImportingArchive.value = false
  }
}

function closeArchiveImportModal(): void {
  archiveImportModalVisible.value = false
  archiveImportPreview.value = null
  archiveImportFilePath.value = ''
}

defineExpose({
  pickArchive,
  isInspectingArchive
})
</script>

<template>
  <n-modal
    :show="archiveImportModalVisible"
    preset="card"
    class="arc-editor-modal archive-import-modal"
    style="width: min(920px, calc(100vw - 32px));"
    title="导入项目归档"
    :bordered="false"
    @close="closeArchiveImportModal"
  >
    <div class="import-modal-body">
      <div class="archive-import-top">
        <div class="storage-status">
          <strong>{{ archiveImportPreview?.projectTitle || '等待读取归档包' }}</strong>
          <span>
            归档版本 {{ archiveImportPreview?.archiveVersion || '--' }} · 导出于
            {{ archiveImportPreview?.exportedAt ? new Date(archiveImportPreview.exportedAt).toLocaleString() : '--' }}
          </span>
        </div>

        <div class="archive-import-controls">
          <n-form-item label="导入方式">
            <n-radio-group v-model:value="archiveImportMode" class="archive-mode-group">
              <n-radio-button
                v-for="option in archiveModeOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </n-radio-button>
            </n-radio-group>
          </n-form-item>

          <n-form-item v-if="archiveImportMode === 'overwrite-project'" label="覆盖目标项目">
            <n-select
              v-model:value="archiveTargetProjectId"
              :options="projectSelectOptions"
              placeholder="请选择要覆盖的项目"
            />
          </n-form-item>
        </div>
      </div>

      <div class="archive-module-panel">
        <div class="setting-name">导入模块</div>
        <div class="setting-hint">
          {{
            archiveImportMode === 'new-project'
              ? '新建项目也可以只导入部分模块；关系、章节版本等会自动带入必要依赖。'
              : '只覆盖所选模块；关系、章节版本等会自动带入必要依赖，未选择的模块保持不变。'
          }}
        </div>
        <div class="archive-module-grid">
          <label
            v-for="option in archiveModuleOptions"
            :key="option.value"
            class="archive-module-item"
          >
            <input
              type="checkbox"
              :value="option.value"
              :checked="archiveSelectedModules.includes(option.value)"
              @change="
                archiveSelectedModules = archiveSelectedModules.includes(option.value)
                  ? archiveSelectedModules.filter((item) => item !== option.value)
                  : [...archiveSelectedModules, option.value]
              "
            />
            <span>{{ option.label }}</span>
            <em>{{ archiveImportPreview?.modules?.[option.value]?.count ?? 0 }}</em>
          </label>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="setting-actions">
        <n-button round strong @click="closeArchiveImportModal">取消</n-button>
        <n-button type="primary" round strong :loading="isImportingArchive" @click="confirmArchiveImport">
          开始导入
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.import-modal-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: min(70vh, 620px);
  overflow-y: auto;
  padding-right: 2px;
}

.archive-import-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  gap: 14px;
  align-items: stretch;
}

.archive-import-controls {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 12px 14px 4px;
}

.archive-import-controls :deep(.n-form-item) {
  margin-bottom: 8px;
}

.storage-status {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 100%;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 14px 16px;
  margin-bottom: 0;
}

.storage-status strong {
  font-size: 13px;
}

.storage-status span {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
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

.setting-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}

.archive-import-modal {
  width: min(920px, calc(100vw - 32px));
  max-width: min(920px, calc(100vw - 32px));
}

.archive-mode-group {
  width: 100%;
}

.archive-mode-group :deep(.n-radio-button) {
  flex: 1;
  text-align: center;
}

.archive-module-panel {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-bg-surface) 74%, transparent);
  padding: 14px;
}

.archive-module-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.archive-module-item {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-panel);
  color: var(--arc-text-primary);
  cursor: pointer;
  font-size: 12px;
  padding: 8px 10px;
}

.archive-module-item input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--arc-primary);
}

.archive-module-item span {
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.35;
}

.archive-module-item em {
  color: var(--arc-text-secondary);
  font-style: normal;
  font-weight: 700;
}

@media (max-width: 760px) {
  .archive-import-top {
    grid-template-columns: 1fr;
  }

  .setting-actions {
    flex-direction: column;
  }

  .setting-actions :deep(.n-button) {
    width: 100%;
    justify-content: center;
  }

  .archive-module-grid {
    grid-template-columns: 1fr;
  }
}

@media (min-width: 761px) and (max-width: 980px) {
  .archive-module-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
