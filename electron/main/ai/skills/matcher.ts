import type { AiTaskPayload } from '../shared-types'
import type { SkillDefinition, SkillSelection } from './types'
import { getAllSkills, getEnabledSkills } from './registry'
import { loadSkillReferences } from './loader'
import { getTaskHandler } from '../tasks'
import { matchNarrativeFunction } from './narrative-function-map'

/** 默认最大匹配 skill 数量 */
const DEFAULT_MAX_SKILLS = 4

/** 评分分项明细，用于日志排查与调参 */
export type ScoreBreakdown = {
  total: number
  task: number
  stage: number
  trigger: number
  narrative: number
  length: number
  priority: number
}

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
  const skills = enabledOverrides
    ? getAllSkills(projectId).filter((skill) => enabledOverrides.get(skill.id) === true)
    : getEnabledSkills(projectId)
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

  const candidates = skills
    .map((skill) => ({ skill, breakdown: computeScore(skill, task, context) }))
    .filter((entry) => entry.breakdown.total > 0 || entry.skill.manifest.required)

  // required skill 无条件保留（即使被高分 optional 挤出 slice），
  // 兑现 SkillManifest.required 的语义："用户明确要求必须生效"。
  // optional 仅填补 required 之外的剩余名额。
  const required = candidates.filter((entry) => entry.skill.manifest.required)
  const optional = candidates
    .filter((entry) => !entry.skill.manifest.required)
    .sort(compareCandidates)

  const remainingSlots = Math.max(0, maxSkills - required.length)
  const selected = [...required.sort(compareCandidates), ...optional.slice(0, remainingSlots)]

  const results: SkillSelection[] = []
  for (const { skill, breakdown } of selected) {
    const referenceContents = await loadSkillReferences(skill, task)
    results.push({
      id: skill.id,
      name: skill.name,
      content: skill.content,
      referenceContents,
      score: breakdown.total,
      scoreBreakdown: breakdown
    })
  }
  return results
}

/**
 * 候选排序比较器：分数降序 → priority 降序 → id 字典序。
 * 后两级 tie-break 保证同分时跨次运行顺序确定，便于调参与复现。
 */
function compareCandidates(
  a: { skill: SkillDefinition; breakdown: ScoreBreakdown },
  b: { skill: SkillDefinition; breakdown: ScoreBreakdown }
): number {
  if (b.breakdown.total !== a.breakdown.total) return b.breakdown.total - a.breakdown.total
  if (b.skill.manifest.priority !== a.skill.manifest.priority) {
    return b.skill.manifest.priority - a.skill.manifest.priority
  }
  return a.skill.id.localeCompare(b.skill.id)
}

/** 计算单个 skill 对指定任务的匹配分数，返回分项明细 */
function computeScore(
  skill: SkillDefinition,
  task: AiTaskPayload,
  context: Record<string, unknown>
): ScoreBreakdown {
  const empty: ScoreBreakdown = { total: 0, task: 0, stage: 0, trigger: 0, narrative: 0, length: 0, priority: 0 }

  // external-only skill 永远不参与匹配
  if (skill.compatibility === 'external-only') return empty

  const manifest = skill.manifest
  const breakdown: ScoreBreakdown = { ...empty }

  // 精确任务匹配：最强信号
  if (manifest.tasks.length > 0 && manifest.tasks.includes(task.task)) {
    breakdown.task = 10
  }

  // 阶段匹配
  const stageId = String(context.stageId ?? '').trim()
  if (stageId && manifest.stages.includes(stageId as typeof manifest.stages[number])) {
    breakdown.stage = 5
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
      breakdown.trigger = Math.min(triggerHits, 5)
    }
  }

  // 叙事功能匹配：根据章节摘要/大纲冲突推断叙事类型，匹配相关 skill。
  // 既比对英文 id/description 子串（兼容 oh-story 系列），
  // 也比对该 skill 的中文 triggers（命中主工具箱的中文 skill）。
  const narrativeText = [
    String(context.chapterSummary ?? ''),
    String(context.currentOutlineConflict ?? ''),
    String(context.currentOutlineSummary ?? '')
  ].join(' ')
  if (narrativeText.trim()) {
    const { patterns, triggers } = matchNarrativeFunction(narrativeText)
    const skillIdLower = skill.id.toLowerCase()
    const skillDescLower = (skill.description ?? '').toLowerCase()
    const matchedByPattern = patterns.some((p) => skillIdLower.includes(p) || skillDescLower.includes(p))
    const skillTriggersLower = manifest.triggers.map((t) => t.toLowerCase())
    const matchedByTrigger = triggers.some((t) => skillTriggersLower.includes(t.toLowerCase()))
    if (matchedByPattern || matchedByTrigger) {
      breakdown.narrative = 3
    }
  }

  // 先按以上信号汇总，得到基础分；required 兜底保证不被 total=0 过滤
  let core = breakdown.task + breakdown.stage + breakdown.trigger + breakdown.narrative
  if (manifest.required) {
    core = Math.max(core, 1)
  }

  // 篇幅亲和：长篇项目优先 long skill，短篇项目优先 short skill
  const novelLength = String(context.projectNovelLength ?? '').trim()
  if (core > 0 && novelLength) {
    const id = skill.id.toLowerCase()
    if (novelLength === 'long' && id.includes('short')) breakdown.length = -4
    if (novelLength === 'short' && id.includes('long')) breakdown.length = -4
  }

  // priority (0-10) 折算为 0-2 的微调分量：影响排序，但不压过 task/stage 信号
  if (core > 0) {
    breakdown.priority = Math.max(0, Math.min(manifest.priority, 10)) * 0.2
  }

  breakdown.total = core + breakdown.length + breakdown.priority
  return breakdown
}
