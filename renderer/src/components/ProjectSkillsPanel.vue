<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { BookOpenText, ChevronDown } from 'lucide-vue-next'
import { NButton, NTag, useMessage } from 'naive-ui'
import { novelWorkflowStageDefinitions } from '@/features/novelWorkflow/stages'
import { useAppStore } from '@/stores/app'
import type { NovelWorkflowStageId, ProjectSkillItem } from '@/types/app'

const appStore = useAppStore()
const message = useMessage()

const isScanningProjectSkills = ref(false)
const isImportingProjectSkills = ref(false)
const projectSkillItems = ref<ProjectSkillItem[]>([])

const currentProject = computed(() => appStore.currentProject)
const workflowStages = computed(() => novelWorkflowStageDefinitions)
const resolvedProjectSkills = computed(() => {
  const stateMap = new Map((currentProject.value?.projectSkills ?? []).map((skill) => [skill.id, skill]))
  return projectSkillItems.value.map((skill) => ({
    ...skill,
    enabled: skill.compatibility === 'external-only'
      ? false
      : (stateMap.get(skill.id)?.enabled ?? skill.enabled),
    stageIds: stateMap.get(skill.id)?.stageIds ?? skill.stageIds
  }))
})
const nativeProjectSkillCount = computed(() =>
  resolvedProjectSkills.value.filter((skill) => skill.compatibility === 'native').length
)
const enabledProjectSkillCount = computed(() =>
  resolvedProjectSkills.value.filter((skill) => skill.enabled).length
)
const externalProjectSkillCount = computed(() =>
  resolvedProjectSkills.value.filter((skill) => skill.compatibility === 'external-only').length
)
const builtinProjectSkillCount = computed(() =>
  resolvedProjectSkills.value.filter((skill) => skill.scope === 'builtin').length
)
const importedProjectSkillCount = computed(() =>
  resolvedProjectSkills.value.filter((skill) => skill.scope !== 'builtin').length
)

const groupedSkills = computed(() => {
  const groups: Array<{ name: string; label: string; skills: typeof resolvedProjectSkills.value }> = []
  const groupMap = new Map<string, typeof resolvedProjectSkills.value>()

  for (const skill of resolvedProjectSkills.value) {
    const segments = skill.path.split('/')
    const groupName = segments.length > 2 ? segments[1] : '_root'
    if (!groupMap.has(groupName)) groupMap.set(groupName, [])
    groupMap.get(groupName)!.push(skill)
  }

  const groupLabels: Record<string, string> = {
    '_root': '内置 Skills'
  }

  for (const [name, skills] of groupMap) {
    groups.push({
      name,
      label: groupLabels[name] ?? name,
      skills
    })
  }

  return groups
})

const collapsedGroups = reactive<Record<string, boolean>>({})

function toggleGroup(groupName: string): void {
  collapsedGroups[groupName] = !collapsedGroups[groupName]
}

watch(
  () => currentProject.value?.id,
  () => {
    void scanProjectSkills()
  },
  { immediate: true }
)

function resolveSkillCategoryLabel(category?: ProjectSkillItem['category']): string {
  switch (category) {
    case 'market':
      return '扫榜'
    case 'analysis':
      return '拆文'
    case 'polish':
      return '润色'
    case 'cover':
      return '封面'
    case 'tool':
      return '工具'
    case 'writing':
    default:
      return '写作'
  }
}

function resolveSkillCompatibilityLabel(compatibility?: ProjectSkillItem['compatibility']): string {
  switch (compatibility) {
    case 'native':
      return '已适配'
    case 'external-only':
      return '外部能力'
    case 'partial':
    default:
      return '部分适配'
  }
}

async function scanProjectSkills(): Promise<void> {
  if (isScanningProjectSkills.value) {
    return
  }

  isScanningProjectSkills.value = true
  try {
    const result = await window.characterArc.scanProjectSkills(currentProject.value?.id ?? '')
    if (!result.success) {
      throw new Error(result.error ?? '项目技能扫描失败')
    }

    projectSkillItems.value = result.skills ?? []
    if (currentProject.value?.id) {
      appStore.updateProject(currentProject.value.id, {
        projectSkills: (result.skills ?? []).map((skill) => ({
          ...skill,
          enabled: skill.compatibility === 'external-only'
            ? false
            : (currentProject.value?.projectSkills.find((item) => item.id === skill.id)?.enabled ?? skill.enabled),
          stageIds:
            currentProject.value?.projectSkills.find((item) => item.id === skill.id)?.stageIds ??
            skill.stageIds
        }))
      })
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '项目技能扫描失败')
  } finally {
    isScanningProjectSkills.value = false
  }
}

async function importProjectSkillsPackage(): Promise<void> {
  if (isImportingProjectSkills.value) {
    return
  }

  isImportingProjectSkills.value = true
  try {
    const result = await window.characterArc.importProjectSkillsPackage(currentProject.value?.id ?? '')
    if (result.canceled) {
      return
    }

    if (!result.success) {
      throw new Error(result.error ?? '项目技能导入失败')
    }

    await scanProjectSkills()
    message.success(`已导入 ${result.importedSkillIds?.length ?? 0} 个 skills`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '项目技能导入失败')
  } finally {
    isImportingProjectSkills.value = false
  }
}

function toggleProjectSkill(skillId: string): void {
  if (!currentProject.value?.id) {
    return
  }

  const nextSkills = resolvedProjectSkills.value.map((skill) =>
    skill.id === skillId
      ? {
          ...skill,
          enabled: skill.compatibility === 'external-only' ? false : !skill.enabled
        }
      : skill
  )

  appStore.updateProject(currentProject.value.id, {
    projectSkills: nextSkills
  })
}

function toggleProjectSkillStage(skillId: string, stageId: NovelWorkflowStageId): void {
  if (!currentProject.value?.id) {
    return
  }

  const nextSkills = resolvedProjectSkills.value.map((skill) => {
    if (skill.id !== skillId) {
      return skill
    }

    if (skill.compatibility === 'external-only') {
      return skill
    }

    const nextStageIds = skill.stageIds.includes(stageId)
      ? skill.stageIds.filter((id) => id !== stageId)
      : [...skill.stageIds, stageId]

    return {
      ...skill,
      stageIds: nextStageIds
    }
  })

  appStore.updateProject(currentProject.value.id, {
    projectSkills: nextSkills
  })
}
</script>

<template>
  <section class="skills-shell">
    <section class="skills-panel">
      <div class="skills-panel-head">
        <div>
          <span class="skills-kicker">Skills</span>
          <h2>内置 Skills 与项目扩展</h2>
          <p>软件内置 skills 来自 `resources/skills`。项目导入的 skills 会按当前项目叠加在其上，打包版和开发版都走同一套结构。</p>
        </div>
        <div class="skills-panel-actions">
          <n-button round strong :disabled="isImportingProjectSkills" @click="importProjectSkillsPackage">
            {{ isImportingProjectSkills ? '导入中...' : '导入 Skill 包' }}
          </n-button>
          <n-button round strong secondary :disabled="isScanningProjectSkills" @click="scanProjectSkills">
            {{ isScanningProjectSkills ? '扫描中...' : '重新扫描' }}
          </n-button>
        </div>
      </div>

      <div v-if="resolvedProjectSkills.length > 0" class="project-skill-overview">
        <div class="project-skill-overview-card">
          <span>已识别 skills</span>
          <strong>{{ resolvedProjectSkills.length }}</strong>
        </div>
        <div class="project-skill-overview-card">
          <span>内置</span>
          <strong>{{ builtinProjectSkillCount }}</strong>
        </div>
        <div class="project-skill-overview-card">
          <span>导入</span>
          <strong>{{ importedProjectSkillCount }}</strong>
        </div>
        <div class="project-skill-overview-card">
          <span>已启用</span>
          <strong>{{ enabledProjectSkillCount }}</strong>
        </div>
        <div class="project-skill-overview-card">
          <span>原生适配</span>
          <strong>{{ nativeProjectSkillCount }}</strong>
        </div>
        <div class="project-skill-overview-card">
          <span>外部能力</span>
          <strong>{{ externalProjectSkillCount }}</strong>
        </div>
      </div>

      <div v-if="resolvedProjectSkills.length > 0" class="project-skill-groups">
        <div v-for="group in groupedSkills" :key="group.name" class="skill-group">
          <button class="skill-group-header" @click="toggleGroup(group.name)">
            <ChevronDown :size="16" class="skill-group-chevron" :class="{ collapsed: collapsedGroups[group.name] }" />
            <strong>{{ group.label }}</strong>
            <span class="skill-group-count">{{ group.skills.length }} 个</span>
            <span class="skill-group-enabled">{{ group.skills.filter(s => s.enabled).length }} 已启用</span>
          </button>
          <div v-if="!collapsedGroups[group.name]" class="project-skill-list">
            <article v-for="skill in group.skills" :key="skill.id" class="project-skill-card">
              <div class="project-skill-head">
                <div>
                  <div class="project-skill-title-row">
                    <strong>{{ skill.name }}</strong>
                    <n-tag size="small" round :bordered="false">{{ resolveSkillCategoryLabel(skill.category) }}</n-tag>
                    <n-tag
                      size="small"
                      round
                      :bordered="false"
                      :type="skill.compatibility === 'native' ? 'success' : (skill.compatibility === 'external-only' ? 'warning' : 'default')"
                    >
                      {{ resolveSkillCompatibilityLabel(skill.compatibility) }}
                    </n-tag>
                  </div>
                  <p class="project-skill-description">{{ skill.description || '当前 skill 未提供描述。' }}</p>
                </div>
                <n-button
                  size="small"
                  :type="skill.enabled ? 'primary' : 'default'"
                  :secondary="!skill.enabled"
                  :disabled="skill.compatibility === 'external-only'"
                  @click="toggleProjectSkill(skill.id)"
                >{{ skill.compatibility === 'external-only' ? '暂不接入' : (skill.enabled ? '已启用' : '已停用') }}</n-button>
              </div>
              <div class="project-skill-meta-row">
                <span v-if="skill.source">来源：{{ skill.source }}</span>
                <span v-if="skill.referencesCount">资料：{{ skill.referencesCount }} 份</span>
                <span v-if="skill.version">v{{ skill.version }}</span>
              </div>
              <div class="project-skill-stage-row">
                <span class="project-skill-stage-label">适用阶段</span>
                <div class="project-skill-stage-chips">
                  <n-button
                    v-for="stage in workflowStages"
                    :key="`${skill.id}-${stage.id}`"
                    size="tiny"
                    :type="skill.stageIds.includes(stage.id) ? 'primary' : 'default'"
                    :secondary="!skill.stageIds.includes(stage.id)"
                    :disabled="skill.compatibility === 'external-only'"
                    @click="toggleProjectSkillStage(skill.id, stage.id)"
                  >{{ stage.title }}</n-button>
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
      <div v-else class="skills-empty-state">
        <BookOpenText :size="18" />
        <strong>还没有识别到项目级 skills</strong>
        <p>你可以直接导入 `oh-story-claudecode` 仓库根目录、其中的 `skills/` 目录，或任意单个 skill 目录。</p>
      </div>
    </section>
  </section>
</template>

<style scoped>
.skills-shell {
  width: 100%;
}

.skills-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  background: var(--arc-bg-surface);
  padding: clamp(16px, 2vw, 22px);
}

.skills-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.skills-panel-head h2 {
  margin: 4px 0 8px;
  color: var(--arc-text-primary);
  font-size: clamp(22px, 2.2vw, 26px);
  letter-spacing: -0.04em;
}

.skills-panel-head p {
  max-width: 56rem;
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.75;
}

.skills-kicker {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.skills-panel-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.project-skill-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.skill-group {
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  overflow: hidden;
}

.skill-group-header {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 14px 18px;
  border: none;
  background: var(--arc-bg-body);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background 0.15s;
}

.skill-group-header:hover {
  background: var(--arc-bg-surface-hover);
}

.skill-group-header strong {
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 680;
}

.skill-group-count {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.skill-group-enabled {
  margin-left: auto;
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 600;
}

.skill-group-chevron {
  color: var(--arc-text-hint);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.skill-group-chevron.collapsed {
  transform: rotate(-90deg);
}

.project-skill-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0 18px 14px;
}

.project-skill-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.project-skill-overview-card {
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-body);
  padding: 14px 16px;
}

.project-skill-overview-card span {
  display: block;
  color: var(--arc-text-hint);
  font-size: 11px;
  margin-bottom: 6px;
}

.project-skill-overview-card strong {
  color: var(--arc-text-primary);
  font-size: 20px;
  letter-spacing: -0.03em;
}

.project-skill-card {
  border-bottom: 1px solid var(--arc-bg-surface-hover);
  background: var(--arc-bg-surface);
  padding: 14px 0;
}

.project-skill-card:last-child {
  border-bottom: none;
}

.project-skill-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.project-skill-head strong {
  color: var(--arc-text-primary);
  font-size: 15px;
}

.project-skill-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.project-skill-head p {
  margin: 4px 0 0;
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.6;
  word-break: break-all;
}

.project-skill-description {
  margin: 4px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.project-skill-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
  color: var(--arc-text-hint);
  font-size: 11px;
}

.project-skill-stage-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.project-skill-stage-label {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 700;
}

.project-skill-stage-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.skills-empty-state {
  display: flex;
  min-height: 140px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-body);
  color: var(--arc-text-secondary);
  text-align: center;
  padding: 20px;
}

.skills-empty-state strong {
  color: var(--arc-text-primary);
  font-size: 14px;
}

.skills-empty-state p {
  max-width: 32rem;
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
}

@media (max-width: 980px) {
  .skills-panel-head,
  .project-skill-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .skills-panel-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .project-skill-overview {
    grid-template-columns: 1fr;
  }
}
</style>
