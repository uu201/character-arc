import type { AiTaskPayload } from '../shared-types'
import type { SkillDefinition, SkillSelection } from './types'
import { getAllSkills, getEnabledSkills } from './registry'
import { loadSkillReferences } from './loader'
import { getTaskHandler } from '../tasks'
import { matchNarrativeFunction } from './narrative-function-map'
import { isSkillExplicitlyExcluded, isSkillExplicitlyMentioned, selectSkillCandidates } from './selection-priority'

/** 默认最大匹配 skill 数量 */
const DEFAULT_MAX_SKILLS = 4

export type SkillMatchOptions = {
  enabledOverrides?: Map<string, boolean>
  stageOverrides?: Map<string, SkillDefinition['manifest']['stages']>
  /** 存在时进入严格手动模式：只选择这些 id，忽略自动评分与 required。 */
  onlySkillIds?: string[]
}

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
  options: SkillMatchOptions = {}
): Promise<SkillSelection[]> {
  let handler: ReturnType<typeof getTaskHandler> | undefined
  try {
    handler = getTaskHandler(task.task)
  } catch {
    // task handler not found — use default matching behavior
  }
  if (handler?.useSkills === false) {
    return []
  }

  const projectId = String(task.context.projectId ?? '').trim()
  const context = task.context ?? {}
  const userPrompt = String(context.userPrompt ?? '')
  const enabledSkills = options.enabledOverrides
    ? getAllSkills(projectId).filter((skill) => options.enabledOverrides?.get(skill.id) === true)
    : getEnabledSkills(projectId)
  const skills = enabledSkills.filter((skill) => skill.compatibility !== 'external-only' && !isSkillExplicitlyExcluded(skill, userPrompt))

  if (options.onlySkillIds) {
    const byId = new Map(skills.map((skill) => [skill.id, skill]))
    const selected = options.onlySkillIds
      .map((id) => byId.get(id))
      .filter((skill): skill is SkillDefinition => Boolean(skill && skill.compatibility !== 'external-only'))
    return loadSelections(selected.map((skill) => ({
      skill,
      breakdown: {
        total: 100,
        task: 0,
        stage: 0,
        trigger: 0,
        narrative: 0,
        length: 0,
        priority: 0
      }
    })), task)
  }

  // 从 TaskHandler 读取 maxSkills，允许复杂任务使用更多 skill
  let maxSkills = DEFAULT_MAX_SKILLS
  if (handler?.maxSkills && handler.maxSkills > 0) {
    maxSkills = handler.maxSkills
  }

  const promptLower = userPrompt.toLowerCase()
  const promptHasMatches = skills.some((skill) => skill.manifest.triggers.some((trigger) => (
    trigger.trim().length >= 2 && promptLower.includes(trigger.trim().toLowerCase())
  )))
  const candidates = skills
    .map((skill) => ({ skill, breakdown: computeScore(skill, task, context, options.stageOverrides?.get(skill.id), promptHasMatches) }))
    .filter(({ skill, breakdown }) => breakdown.total > 0 || isSkillExplicitlyMentioned(skill, userPrompt))
  const selected = selectSkillCandidates(candidates, userPrompt, maxSkills, compareCandidates)

  return loadSelections(selected, task)
}

async function loadSelections(
  selected: Array<{ skill: SkillDefinition; breakdown: ScoreBreakdown }>,
  task: AiTaskPayload
): Promise<SkillSelection[]> {
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
  context: Record<string, unknown>,
  stageOverrides?: SkillDefinition['manifest']['stages'],
  promptHasMatches = false
): ScoreBreakdown {
  const empty: ScoreBreakdown = { total: 0, task: 0, stage: 0, trigger: 0, narrative: 0, length: 0, priority: 0 }

  // external-only skill 永远不参与匹配
  if (skill.compatibility === 'external-only') return empty

  const manifest = skill.manifest
  const breakdown: ScoreBreakdown = { ...empty }
  const isAssistant = task.task === 'chapter-assistant' || task.task === 'global-assistant' || task.task === 'global-assistant-proposal'
  const taskMatches = manifest.tasks.includes(task.task)
  const userPrompt = String(context.userPrompt ?? '')
  const explicitlyMentioned = isSkillExplicitlyMentioned(skill, userPrompt)

  // 助手是通用入口，任务名只能作辅助信号；专用生成任务保留较强任务映射。
  if (taskMatches) {
    breakdown.task = isAssistant ? 2 : 10
  }

  // 阶段匹配
  const stageId = String(context.stageId ?? '').trim()
  const stages = stageOverrides ?? manifest.stages
  const stageMatches = stages.includes(stageId as typeof stages[number])
  if (stageMatches) {
    breakdown.stage = isAssistant ? 2 : 5
  }

  // 本轮请求中的明确需求优先；章节背景、题材等只能提供弱相关信号。
  const triggers = [...new Set(manifest.triggers.map((value) => value.trim().toLowerCase()).filter((value) => value.length >= 2))]
  const promptLower = userPrompt.toLowerCase()
  const directHits = triggers.filter((trigger) => promptLower.includes(trigger)).length
  if (directHits > 0) {
    breakdown.trigger = 8 + Math.min(directHits - 1, 3) * 2
  } else {
    const background = [
      String(context.chapterTitle ?? ''),
      String(context.chapterSummary ?? ''),
      String(context.projectGenre ?? ''),
      String(context.focusType ?? '')
    ].join(' ').toLowerCase()
    breakdown.trigger = Math.min(triggers.filter((trigger) => background.includes(trigger)).length, 2)
  }

  // 阶段绑定仍限制无明确需求的自动推荐；用户本轮明确提出跨阶段需求时可补选。
  if (stageId && stageOverrides && !stageMatches && directHits === 0 && !explicitlyMentioned) return empty

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

  const requiredApplies = manifest.required && (taskMatches || stageMatches || (!manifest.tasks.length && !stages.length))
  // 通用助手不为阶段、入口名称或背景关键词单独凑满候选名额。
  if (isAssistant && directHits === 0 && (promptHasMatches || breakdown.narrative === 0) && !requiredApplies && !explicitlyMentioned) return empty

  // required 只在技能适用的任务/阶段生效，避免润色规则污染无关闲聊。
  let core = breakdown.task + breakdown.stage + breakdown.trigger + breakdown.narrative
  if (requiredApplies) {
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
