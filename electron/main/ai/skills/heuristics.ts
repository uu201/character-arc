import type { SkillCategory, SkillCompatibility, SkillManifest, SkillStageId } from './types'
import type { AiTaskName } from '../shared-types'

/** 启发式推断结果：当 skill 缺少 frontmatter manifest 时自动推断的元数据 */
export type HeuristicResult = {
  category: SkillCategory
  compatibility: SkillCompatibility
  compatibilityNote: string
  enabled: boolean
  stages: SkillStageId[]
  tasks: AiTaskName[]
  triggers: string[]
  priority: number
}

/**
 * 纯关键词启发式：为没有 frontmatter manifest 的 skill 推断元数据。
 * 所有已知 skill 的元数据应写在各自 SKILL.md 的 frontmatter 里，这里只兜底。
 */
export function inferSkillMeta(skillId: string, description: string): HeuristicResult {
  const lowerDesc = description.toLowerCase()
  const lowerSkillId = skillId.toLowerCase()

  if (lowerSkillId.includes('scan') || lowerDesc.includes('市场') || lowerDesc.includes('排行'))
    return buildHeuristic('market', ['reference'], [], ['排行', '市场', '趋势'], true)

  if (lowerSkillId.includes('analyze') || lowerDesc.includes('拆书') || lowerDesc.includes('拆文'))
    return buildHeuristic('analysis', ['reference'], ['reference-style-chunk', 'reference-style-analysis'], ['拆书', '分析', '对标'], true)

  if (lowerSkillId.includes('write') || lowerDesc.includes('写作') || lowerDesc.includes('创作'))
    return buildHeuristic('writing', ['premise', 'setting', 'outline', 'draft'], WRITING_TASKS, ['写正文', '写章节', '大纲', '开书'], true)

  if (lowerSkillId.includes('deslop') || lowerSkillId.includes('polish') || lowerDesc.includes('润色') || lowerDesc.includes('ai味'))
    return buildHeuristic('polish', ['draft'], ['chapter-assistant', 'chapter-first-draft'], ['润色', '去AI味', '降低AI感'], true)

  if (lowerSkillId.includes('cover'))
    return buildHeuristic('cover', [], [], [], false, 'external-only', '当前项目还没有封面生成工作台，此 skill 会作为资料保留。')

  if (lowerSkillId.includes('cdp') || lowerSkillId.includes('browser'))
    return buildHeuristic('tool', [], [], [], false, 'external-only', '当前项目没有浏览器 CDP 执行能力，此 skill 会作为外部工具说明保留。')

  return buildHeuristic('writing', [], [], [], false, 'partial', '已识别为通用 skill，可手动决定是否启用并绑定到对应阶段。')
}

/**
 * 将用户提供的 partial manifest 与启发式推断结果合并为完整的 SkillManifest
 * @param partial - 用户在 frontmatter 中声明的 manifest（可能为 null）
 * @param heuristic - 启发式推断的兜底值
 * @returns 合并后的完整 SkillManifest
 */
export function buildFullManifest(
  partial: Partial<SkillManifest> | null,
  heuristic: HeuristicResult
): SkillManifest {
  return {
    category: partial?.category ?? heuristic.category,
    tasks: partial?.tasks ?? heuristic.tasks,
    stages: partial?.stages ?? heuristic.stages,
    triggers: partial?.triggers ?? heuristic.triggers,
    priority: partial?.priority ?? heuristic.priority,
    references: partial?.references ?? [],
    required: partial?.required ?? false
  }
}

/** 写作类 skill 默认关联的 AI 任务列表 */
const WRITING_TASKS: AiTaskName[] = [
  'chapter-assistant', 'chapter-first-draft', 'outline-batch', 'outline-chain',
  'chapter-analysis', 'inspiration-pack', 'project-bootstrap',
  'worldview-entry', 'character-card', 'outline-item',
  'spiral-seed', 'spiral-expand', 'spiral-characters', 'spiral-organizations',
  'spiral-relationships', 'spiral-worldview-expand', 'spiral-outline', 'spiral-validate'
]

/** 构造 HeuristicResult 的便捷工厂函数 */
function buildHeuristic(
  category: SkillCategory,
  stages: SkillStageId[],
  tasks: AiTaskName[],
  triggers: string[],
  enabled: boolean,
  compatibility: SkillCompatibility = 'native',
  compatibilityNote: string = '',
  priority: number = 5
): HeuristicResult {
  return { category, compatibility, compatibilityNote, enabled, stages, tasks, triggers, priority }
}
