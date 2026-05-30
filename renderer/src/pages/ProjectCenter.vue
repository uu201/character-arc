<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { useDialog, useMessage } from 'naive-ui'

import HomepageHero from '@/components/home/HomepageHero.vue'
import HomepageAnnouncementModal from '@/components/home/HomepageAnnouncementModal.vue'
import HomepageUpdateModal from '@/components/home/HomepageUpdateModal.vue'
import HomepageProjectCollection from '@/components/home/HomepageProjectCollection.vue'
import HomepageSettingsModal from '@/components/home/HomepageSettingsModal.vue'
import ProjectEditorModal from '@/components/home/ProjectEditorModal.vue'
import { useAppStore } from '@/stores/app'
import { useStartupCheck } from '@/composables/useStartupCheck'
import type { ProjectSummary } from '@/types/app'

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const { announcementStatus, updateStatus, markAnnouncementRead, markUpdateRead } = useStartupCheck()

const settingsVisible = ref(false)
const editorVisible = ref(false)
const announcementVisible = ref(false)
const updateVisible = ref(false)
const editingProject = ref<ProjectSummary | null>(null)

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
    label: () => h('span', { class: 'project-menu-danger-label' }, '删除项目')
  }
])

function openProject(projectId: string): void {
  appStore.openProject(projectId)
}

function openDeconstructionLibrary(): void {
  appStore.openDeconstructionLibrary()
}

function openSkillsPage(): void {
  const targetProject = appStore.projects.find((project) => project.id === appStore.selectedProjectId)
    ?? appStore.projects[0]

  appStore.openSkillsPage(targetProject?.id)
}

function openCoverWorkbenchPage(): void {
  const targetProject = appStore.projects.find((project) => project.id === appStore.selectedProjectId)
    ?? appStore.projects[0]

  appStore.openCoverWorkbenchPage(targetProject?.id)
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
        :announcement-status="announcementStatus"
        :update-status="updateStatus"
        @create="appStore.openWizard()"
        @open-deconstruction="openDeconstructionLibrary"
        @open-cover-workbench="openCoverWorkbenchPage"
        @open-skills="openSkillsPage"
        @open-settings="settingsVisible = true"
        @open-announcement="markAnnouncementRead(); announcementVisible = true"
        @check-update="markUpdateRead(); updateVisible = true"
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
      @submit="submitProject"
    />

    <HomepageSettingsModal v-model:show="settingsVisible" />
    <HomepageAnnouncementModal v-model:show="announcementVisible" />
    <HomepageUpdateModal v-model:show="updateVisible" />
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
