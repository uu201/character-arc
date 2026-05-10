import type { AiTaskPayload } from '../shared-types'
import type { SkillDefinition, SkillSelection } from './types'
import { getEnabledSkills } from './registry'
import { loadSkillReferences } from './loader'

export async function pickSkillsFor(
  task: AiTaskPayload,
  enabledOverrides?: Map<string, boolean>
): Promise<SkillSelection[]> {
  const projectId = String(task.context.projectId ?? '').trim()
  const skills = getEnabledSkills(projectId)
  const context = task.context ?? {}

  const scored = skills
    .filter((skill) => {
      if (enabledOverrides?.has(skill.id)) return enabledOverrides.get(skill.id)!
      return true
    })
    .map((skill) => ({
      skill,
      score: computeScore(skill, task, context)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      const priorityDiff = b.skill.manifest.priority - a.skill.manifest.priority
      if (priorityDiff !== 0) return priorityDiff
      return b.score - a.score
    })
    .slice(0, 4)

  const results: SkillSelection[] = []
  for (const { skill, score } of scored) {
    const referenceContents = await loadSkillReferences(skill, task)
    results.push({
      id: skill.id,
      name: skill.name,
      content: skill.content,
      referenceContents,
      score
    })
  }
  return results
}

function computeScore(
  skill: SkillDefinition,
  task: AiTaskPayload,
  context: Record<string, unknown>
): number {
  let score = 0
  const manifest = skill.manifest

  if (manifest.tasks.length > 0) {
    if (manifest.tasks.includes(task.task)) {
      score += 10
    }
  }

  const stageId = String(context.stageId ?? '').trim()
  if (stageId && manifest.stages.includes(stageId as typeof manifest.stages[number])) {
    score += 5
  }

  if (manifest.triggers.length > 0) {
    const haystack = [
      String(context.userPrompt ?? ''),
      String(context.chapterTitle ?? ''),
      String(context.quickAction ?? '')
    ].join(' ').toLowerCase()

    if (haystack) {
      for (const trigger of manifest.triggers) {
        if (haystack.includes(trigger.toLowerCase())) {
          score += 3
          break
        }
      }
    }
  }

  if (skill.compatibility === 'external-only') return 0

  return score
}
