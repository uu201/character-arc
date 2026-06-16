import type { AiTaskPayload } from '../shared-types'
import type { SkillDefinition, SkillSelection } from './types'
import { getEnabledSkills } from './registry'
import { loadSkillReferences } from './loader'
import { getTaskHandler } from '../tasks'
import { matchNarrativeFunction } from './narrative-function-map'

/** 默认最大匹配 skill 数量 */
const DEFAULT_MAX_SKILLS = 4

/**
 * 为指定 AI 任务匹配最合适的 skill 列表
 * @param task - AI 任务负载
 * @param enabledOverrides - 可选的 skill 启用/禁用覆盖表
 * @returns 按匹配分数降序排列的 skill 选中结果
 */
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
    .sort((a, b) => b.score - a.score)
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

/** 计算单个 skill 对指定任务的匹配分数 */
function computeScore(
  skill: SkillDefinition,
  task: AiTaskPayload,
  context: Record<string, unknown>
): number {
  // external-only skill 永远不参与匹配
  if (skill.compatibility === 'external-only') return 0

  let score = 0
  const manifest = skill.manifest

  // 精确任务匹配：最强信号
  if (manifest.tasks.length > 0 && manifest.tasks.includes(task.task)) {
    score += 10
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

  // required skill 兜底，保证不被 score=0 过滤掉
  if (manifest.required) {
    score = Math.max(score, 1)
  }

  // 叙事功能匹配：根据章节摘要/大纲冲突推断叙事类型，匹配相关 skill
  const narrativeText = [
    String(context.chapterSummary ?? ''),
    String(context.currentOutlineConflict ?? ''),
    String(context.currentOutlineSummary ?? '')
  ].join(' ')
  if (narrativeText.trim()) {
    const narrativePatterns = matchNarrativeFunction(narrativeText)
    const skillIdLower = skill.id.toLowerCase()
    const skillDescLower = (skill.description ?? '').toLowerCase()
    for (const pattern of narrativePatterns) {
      if (skillIdLower.includes(pattern) || skillDescLower.includes(pattern)) {
        score += 3
        break
      }
    }
  }

  // 篇幅亲和：长篇项目优先 long skill，短篇项目优先 short skill
  const novelLength = String(context.projectNovelLength ?? '').trim()
  if (score > 0 && novelLength) {
    const id = skill.id.toLowerCase()
    if (novelLength === 'long' && id.includes('short')) score -= 4
    if (novelLength === 'short' && id.includes('long')) score -= 4
  }

  // priority (0-10) 折算为 0-2 的微调分量：影响排序，但不压过 task/stage 信号
  if (score > 0) {
    score += Math.max(0, Math.min(manifest.priority, 10)) * 0.2
  }

  return score
}
