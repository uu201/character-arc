<script setup lang="ts">
import { computed, h, reactive, ref } from 'vue'
import { BookOpen, Clock, FilePenLine, ImagePlus, MoreHorizontal, Plus, Trash2, X } from 'lucide-vue-next'
import { NButton, NDropdown, NForm, NFormItem, NInput, NModal, useDialog, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import type { ProjectSummary } from '@/types/app'

const appStore = useAppStore()
const dialog = useDialog() // Naive UI 对话框服务，用于删除确认弹窗
const message = useMessage() // Naive UI 消息提示服务，用于操作反馈

// 项目编辑弹窗的显示状态
const editorVisible = ref(false)
// 当前正在编辑的项目 ID，null 表示非编辑状态（理论上始终有值，由 openProjectEditor 设置）
const editingProjectId = ref<string | null>(null)

// 项目编辑表单的响应式数据
const form = reactive({
  title: '',
  genre: '',
  wordCount: '',
  cover: ''
})

// 是否允许删除项目：至少保留一个项目时才可删除
const canDeleteProject = computed(() => appStore.projects.length > 1)
// 当前是否处于编辑模式（区别于新增模式，但本页面仅使用编辑模式）
const isEditing = computed(() => Boolean(editingProjectId.value))

// 项目卡片右上角"更多"菜单的选项列表
const projectMenuOptions = computed(() => [
  {
    key: 'open',
    label: '打开项目'
  },
  {
    key: 'edit',
    label: '编辑项目信息'
  },
  {
    key: 'divider',
    type: 'divider'
  },
  {
    key: 'delete',
    label: () => h('span', { class: 'project-menu-danger-label' }, '删除项目'),
    disabled: !canDeleteProject.value // 仅剩一个项目时禁用删除
  }
])

/**
 * 根据菜单项 key 渲染对应的图标
 * @param option - 菜单项对象，包含 key 属性
 * @returns 对应的 VNode 图标或 null
 */
function renderMenuIcon(option: { key?: string | number }) {
  if (option.key === 'open') {
    return h(BookOpen, { size: 16 })
  }
  if (option.key === 'edit') {
    return h(FilePenLine, { size: 16 })
  }
  if (option.key === 'delete') {
    return h(Trash2, { size: 16, class: 'project-menu-danger-label' })
  }
  return null
}

/**
 * 处理项目卡片菜单的操作选择
 * @param action - 菜单项的 key（open / edit / delete）
 * @param projectId - 被操作的项目 ID
 */
function handleMenuSelect(action: string | number, projectId: string): void {
  if (action === 'open') {
    appStore.openProject(projectId)
    return
  }

  if (action === 'edit') {
    const project = appStore.projects.find((item) => item.id === projectId)
    if (project) {
      openProjectEditor(project)
    }
    return
  }

  if (action === 'delete') {
    requestDeleteProject(projectId)
  }
}

/**
 * 打开项目编辑弹窗，将已有项目数据填充到表单中
 * @param project - 要编辑的项目摘要对象（可选，不传时清空表单）
 */
function openProjectEditor(project?: ProjectSummary): void {
  editingProjectId.value = project?.id ?? null
  form.title = project?.title ?? ''
  form.genre = project?.genre ?? ''
  form.wordCount = project?.wordCount ?? ''
  form.cover = project?.cover ?? ''
  editorVisible.value = true
}

/** 提交项目编辑表单，校验必填项后更新项目信息 */
function submitProject(): void {
  if (!editingProjectId.value) {
    return
  }

  // 校验标题和题材为必填项
  if (!form.title.trim() || !form.genre.trim()) {
    message.warning('请完整填写项目标题和题材分类')
    return
  }

  appStore.updateProject(editingProjectId.value, form)
  editorVisible.value = false
  message.success('项目信息已更新')
}

/** 通过系统文件选择器选择本地图片作为项目封面 */
async function handlePickCover(): Promise<void> {
  const result = await window.characterArc.pickCoverImage()
  if (!result.success || result.canceled || !result.dataUrl) {
    return
  }

  // 将用户选择的图片以 data URL 形式存储，简化封面管理流程
  form.cover = result.dataUrl
  message.success('项目封面已更新')
}

/** 清除当前编辑的项目封面 */
function clearCover(): void {
  form.cover = ''
}

/**
 * 请求删除项目，弹出二次确认对话框
 * @param projectId - 要删除的项目 ID
 */
function requestDeleteProject(projectId: string): void {
  const project = appStore.projects.find((item) => item.id === projectId)
  if (!project) {
    return
  }

  dialog.warning({
    title: '确认删除项目',
    content: `确定要删除"${project.title}"吗？删除后当前本地项目数据将无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteProject(projectId)
    }
  })
}
</script>

<template>
  <section class="project-center">
    <div class="project-shell">
      <header class="hero arc-drag-region">
        <div>
          <h1>我的作品</h1>
          <p>开启一段新的创作旅程</p>
        </div>

        <button class="create-button arc-no-drag" @click="appStore.openWizard()">
          <Plus :size="18" />
          <span>新建作品</span>
        </button>
      </header>

      <div class="project-grid">
        <article
          v-for="(project, index) in appStore.projects"
          :key="project.id"
          class="project-card"
          :style="{ animationDelay: `${index * 60}ms` }"
          @click="appStore.openProject(project.id)"
        >
          <div class="project-card-top">
            <div class="project-icon" :style="{ background: project.cover }">
              <BookOpen :size="26" />
            </div>
            <n-dropdown
              trigger="click"
              :options="projectMenuOptions"
              :render-icon="renderMenuIcon"
              placement="bottom-end"
              size="large"
              @select="(key) => handleMenuSelect(key, project.id)"
            >
              <button class="more-button" @click.stop>
                <MoreHorizontal :size="18" />
              </button>
            </n-dropdown>
          </div>

          <div class="project-card-bottom">
            <span class="project-genre">{{ project.genre }}</span>
            <h3>{{ project.title }}</h3>

            <div class="meta-row">
              <div class="meta-item">
                <Clock :size="14" />
                <span>{{ project.lastEdited }}</span>
              </div>
              <div class="meta-item">
                <span class="dot"></span>
                <span>{{ project.wordCount }}</span>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>

    <n-modal
      :show="editorVisible"
      preset="card"
      class="arc-editor-modal"
      :title="isEditing ? '编辑项目信息' : '编辑项目'"
      :bordered="false"
      @close="editorVisible = false"
    >
      <n-form label-placement="top">
        <n-form-item label="项目封面">
          <div class="cover-editor">
            <div
              class="cover-preview"
              :style="{ background: form.cover || 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' }"
            >
              <BookOpen :size="28" />
            </div>
            <div class="cover-actions">
              <n-button round strong @click="handlePickCover">
                <template #icon>
                  <ImagePlus :size="16" />
                </template>
                选择本地图片
              </n-button>
              <n-button round strong secondary :disabled="!form.cover" @click="clearCover">
                <template #icon>
                  <X :size="16" />
                </template>
                清除封面
              </n-button>
            </div>
          </div>
        </n-form-item>
        <n-form-item label="项目标题">
          <n-input v-model:value="form.title" placeholder="例如：赛博飞升指南" />
        </n-form-item>
        <n-form-item label="题材分类">
          <n-input v-model:value="form.genre" placeholder="例如：科幻 / 赛博朋克" />
        </n-form-item>
        <n-form-item label="字数展示">
          <n-input v-model:value="form.wordCount" placeholder="例如：12.5万字" />
        </n-form-item>
      </n-form>

      <template #footer>
        <div class="arc-modal-actions">
          <n-button round strong @click="editorVisible = false">取消</n-button>
          <n-button type="primary" round strong @click="submitProject">保存修改</n-button>
        </div>
      </template>
    </n-modal>
  </section>
</template>

<style scoped>
.project-center {
  display: flex;
  flex: 1;
  width: 100%;
  min-height: 100%;
  overflow-y: auto;
  background: var(--arc-bg-body);
}

.project-shell {
  z-index: 1;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding:
    calc(var(--arc-titlebar-height) + clamp(20px, 2.4vw, 32px))
    max(clamp(20px, 3vw, 40px), calc(var(--arc-window-controls-width) + 24px))
    clamp(36px, 6vw, 64px)
    clamp(20px, 3vw, 40px);
}

.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 32px;
}

.hero h1 {
  margin: 0 0 6px;
  color: var(--arc-text-primary);
  font-size: clamp(20px, 2vw, 28px);
  font-weight: 650;
  letter-spacing: -0.02em;
}

.hero p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
}

.create-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  border-radius: var(--arc-radius-md);
  background: var(--arc-primary);
  color: white;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  padding: 10px 18px;
  transition:
    background 0.18s ease,
    box-shadow 0.18s ease;
}

.create-button:hover {
  background: var(--arc-primary-hover);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--arc-primary) 28%, transparent);
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: clamp(12px, 1.6vw, 20px);
}

.project-card {
  position: relative;
  display: flex;
  min-height: 200px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-surface);
  cursor: pointer;
  padding: clamp(16px, 2vw, 20px);
  animation: cardRise 0.24s ease both;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.project-card:hover {
  border-color: var(--arc-border-strong);
  box-shadow: var(--arc-shadow-sm);
}

.project-card-top,
.project-card-bottom {
  position: relative;
  z-index: 1;
}

.project-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: auto;
}

.project-icon {
  display: inline-flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border-radius: var(--arc-radius-md);
  color: white;
}

.more-button {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--arc-radius-md);
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.more-button:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--arc-text-primary);
}

:deep(.project-menu-danger-label) {
  color: var(--arc-danger);
}

.cover-editor {
  display: flex;
  align-items: center;
  gap: 16px;
}

.cover-preview {
  display: inline-flex;
  width: 96px;
  height: 96px;
  align-items: center;
  justify-content: center;
  border-radius: var(--arc-radius-lg);
  color: white;
  flex-shrink: 0;
  box-shadow: var(--arc-shadow-sm);
  background-size: cover !important;
  background-position: center !important;
}

.cover-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.project-genre {
  display: inline-flex;
  align-items: center;
  border-radius: var(--arc-radius-sm);
  background: var(--arc-bg-body);
  color: var(--arc-text-secondary);
  font-size: 11px;
  font-weight: 500;
  padding: 3px 8px;
  margin-bottom: 12px;
  letter-spacing: 0.01em;
}

.project-card h3 {
  margin: 0 0 14px;
  color: var(--arc-text-primary);
  font-size: clamp(16px, 1.6vw, 20px);
  font-weight: 600;
  letter-spacing: -0.01em;
  transition: color 0.16s ease;
}

.project-card:hover h3 {
  color: var(--arc-primary);
}

.meta-row {
  display: flex;
  gap: 16px;
  color: var(--arc-text-hint);
  font-size: 12px;
}

@media (max-width: 1240px) {
  .project-card h3 {
    margin-bottom: 10px;
  }
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.dot {
  width: 3px;
  height: 3px;
  border-radius: 999px;
  background: var(--arc-border-strong);
}

@keyframes cardRise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 900px) {
  .hero {
    align-items: flex-start;
  }

  .create-button {
    width: 100%;
    justify-content: center;
  }

  .meta-row {
    flex-wrap: wrap;
    gap: 8px 14px;
  }

  .cover-editor {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
