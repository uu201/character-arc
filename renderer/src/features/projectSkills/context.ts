import type { NovelWorkflowStageId, ProjectSummary } from '@/types/app'

export async function loadEnabledProjectSkillsContext(
  project?: ProjectSummary | null,
  stageId?: NovelWorkflowStageId
): Promise<
  Array<{
    id: string
    name: string
    description: string
    content: string
  }>
> {
  if (!project) {
    return []
  }

  const enabledIds = new Set(
    (project.projectSkills ?? [])
      .filter((skill) => skill.enabled && (!stageId || skill.stageIds.includes(stageId)))
      .map((skill) => skill.id)
  )
  if (!enabledIds.size) {
    return []
  }

  const result = await window.characterArc.getProjectSkillsContext()
  if (!result.success || !Array.isArray(result.skills)) {
    return []
  }

  return result.skills
    .filter((skill) => enabledIds.has(skill.id))
    .map((skill) => ({
      ...skill,
      content: skill.content.trim().slice(0, 4000)
    }))
}
