import type { AiTaskPayload } from '../shared-types'
import type { SkillDefinition, SkillSelection } from './types'
import { getEnabledSkills } from './registry'
import { loadSkillReferences } from './loader'
import { getTaskHandler } from '../tasks'

const DEFAULT_MAX_SKILLS = 4

export async function pickSkillsFor(
  task: AiTaskPayload,
  enabledOverrides?: Map<string, boolean>
): Promise<SkillSelection[]> {
  const projectId = String(task.context.projectId ?? '').trim()
  const skills = getEnabledSkills(projectId)
  const context = task.context ?? {}

  // 从 TaskHandler 读取 maxSkills，允许复杂任务使用更多 skill
  let maxSkills = DEFAULT_MAX_SKILLS
  try {
    const handler = getTaskHandler(task.task)
    if (handler.maxSkills && handler.maxSkills > 0) {
      maxSkills = handler.maxSkills
    }
  } catch {
    // task handler not found — use default
  }

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
    .slice(0, maxSkills)

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

  // 精确任务匹配：最强信号
  if (manifest.tasks.length > 0) {
    if (manifest.tasks.includes(task.task)) {
      score += 10
    }
  }

  // 阶段匹配
  const stageId = String(context.stageId ?? '').trim()
  if (stageId && manifest.stages.includes(stageId as typeof manifest.stages[number])) {
    score += 5
  }

  // Trigger 关键词匹配：扩大 haystack，命中多个时累加（每个 +1，上限 +5）
  if (manifest.triggers.length > 0) {
    const haystack = [
      String(context.userPrompt ?? ''),
      String(context.chapterTitle ?? ''),
      String(context.chapterSummary ?? ''),
      String(context.quickAction ?? ''),
      String(context.projectGenre ?? ''),
      String(context.focusType ?? '')
    ].join(' ').toLowerCase()

    if (haystack) {
      let triggerHits = 0
      for (const trigger of manifest.triggers) {
        // 要求 trigger 至少 2 字，避免单字误命中
        if (trigger.length < 2) continue
        if (haystack.includes(trigger.toLowerCase())) {
          triggerHits += 1
        }
      }
      score += Math.min(triggerHits, 5)
    }
  }

  // required skill 无条件得分（保证不被过滤掉）
  if (manifest.required) {
    score = Math.max(score, 1)
  }

  if (skill.compatibility === 'external-only') return 0

  return score
}
