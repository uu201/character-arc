<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import HomepageHero from '@/components/home/HomepageHero.vue'
import HomepageProjectCollection from '@/components/home/HomepageProjectCollection.vue'
import HomepageSettingsModal from '@/components/home/HomepageSettingsModal.vue'
import ProjectEditorModal from '@/components/home/ProjectEditorModal.vue'
import { buildCoverPromptKnowledgeDocument, type CoverPromptWorkbenchInput } from '@/features/cover/promptWorkbench'
import { useAppStore } from '@/stores/app'
import type { ProjectSummary } from '@/types/app'

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()

const settingsVisible = ref(false)
const editorVisible = ref(false)
const editingProject = ref<ProjectSummary | null>(null)

const canDeleteProject = computed(() => appStore.projects.length > 1)

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
    disabled: !canDeleteProject.value
  }
])

function openProject(projectId: string): void {
  appStore.openProject(projectId)
}

function openProjectEditor(project?: ProjectSummary): void {
  editingProject.value = project ?? null
  editorVisible.value = true
}

function handleMenuSelect(action: string | number, projectId: string): void {
  if (action === 'open') {
    openProject(projectId)
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

async function handlePickCover(): Promise<void> {
  if (!editingProject.value) {
    return
  }

  const result = await window.characterArc.pickCoverImage()
  if (!result.success || result.canceled || !result.dataUrl) {
    return
  }

  editingProject.value = {
    ...editingProject.value,
    cover: result.dataUrl
  }
  message.success('项目封面已更新')
}

function submitProject(payload: {
  id: string
  title: string
  genre: string
  novelLength: ProjectSummary['novelLength']
  cover: string
  targetPlatform: string
}): void {
  appStore.updateProject(payload.id, {
    title: payload.title,
    genre: payload.genre,
    novelLength: payload.novelLength,
    cover: payload.cover,
    targetPlatform: payload.targetPlatform
  })
  editorVisible.value = false
  message.success('项目信息已更新')
}

function handleSaveCoverPrompt(payload: CoverPromptWorkbenchInput): void {
  const document = buildCoverPromptKnowledgeDocument(payload.project.id, payload)
  appStore.mergeKnowledgeDocuments(payload.project.id, [document])
  message.success('封面提示词已保存到知识库')
}

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
      <HomepageHero
        @create="appStore.openWizard()"
        @open-settings="settingsVisible = true"
      />

      <HomepageProjectCollection
        :projects="appStore.projects"
        :menu-options="projectMenuOptions"
        @open="openProject"
        @menu-select="handleMenuSelect"
      />
    </div>

    <ProjectEditorModal
      v-model:show="editorVisible"
      :project="editingProject"
      @pick-cover="handlePickCover"
      @save-cover-prompt="handleSaveCoverPrompt"
      @submit="submitProject"
    />

    <HomepageSettingsModal v-model:show="settingsVisible" />
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
  width: min(100%, 1100px);
  margin: 0 auto;
  padding:
    calc(var(--arc-titlebar-height) + clamp(20px, 3vw, 28px))
    clamp(16px, 2.6vw, 28px)
    clamp(28px, 4vw, 44px);
}

@supports (padding-right: max(1px, 2px)) {
  .project-shell {
    padding-right: max(clamp(16px, 2.6vw, 28px), calc(env(titlebar-area-x, 0px) + env(titlebar-area-width, 100vw) - 100% + 18px));
  }
}

:deep(.project-menu-danger-label) {
  color: var(--arc-danger);
}
</style>
