import type { SkillCategory, SkillCompatibility, SkillManifest, SkillStageId } from './types'
import type { AiTaskName } from '../shared-types'

type HeuristicResult = {
  category: SkillCategory
  compatibility: SkillCompatibility
  compatibilityNote: string
  enabled: boolean
  stages: SkillStageId[]
  tasks: AiTaskName[]
  triggers: string[]
  priority: number
}

export function inferSkillMeta(skillId: string, description: string): HeuristicResult {
  const knownMeta = KNOWN_SKILL_META[skillId]
  if (knownMeta) return knownMeta

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

export function buildFullManifest(
  partial: Partial<SkillManifest> | null,
  heuristic: HeuristicResult
): SkillManifest {
  return {
    category: partial?.category ?? heuristic.category,
    tasks: partial?.tasks?.length ? partial.tasks : heuristic.tasks,
    stages: partial?.stages?.length ? partial.stages : heuristic.stages,
    triggers: partial?.triggers?.length ? partial.triggers : heuristic.triggers,
    priority: partial?.priority ?? heuristic.priority,
    references: partial?.references ?? [],
    required: partial?.required ?? false
  }
}

const WRITING_TASKS: AiTaskName[] = [
  'chapter-assistant', 'chapter-first-draft', 'outline-batch', 'outline-chain',
  'chapter-analysis', 'inspiration-pack', 'project-bootstrap',
  'worldview-entry', 'character-card', 'outline-item'
]

const KNOWN_SKILL_META: Record<string, HeuristicResult> = {
  'story-long-scan': buildHeuristic('market', ['reference'], [], ['排行', '市场', '趋势'], true),
  'story-short-scan': buildHeuristic('market', ['reference'], [], ['排行', '市场'], true),
  'story-long-analyze': buildHeuristic('analysis', ['reference'], ['reference-style-chunk', 'reference-style-analysis'], ['拆书', '分析'], true),
  'story-short-analyze': buildHeuristic('analysis', ['reference'], ['reference-style-chunk', 'reference-style-analysis'], ['拆书', '分析'], true),
  'story-long-write': buildHeuristic('writing', ['premise', 'setting', 'outline', 'draft'], WRITING_TASKS, ['写正文', '写章节', '大纲', '开书', '写长篇', '网文'], true, 'native', '适合立项、设定、大纲和正文阶段，作为当前项目的核心写作规则来源。', 6),
  'story-short-write': buildHeuristic('writing', ['premise', 'setting', 'outline', 'draft'], WRITING_TASKS, ['写短篇', '短篇', '创作'], true, 'native', '适合短篇小说的立项和写作阶段。', 6),
  'story-deslop': buildHeuristic('polish', ['draft'], ['chapter-assistant', 'chapter-first-draft'], ['润色', '去AI味', '降低AI感'], true, 'native', '适合正文润色与去 AI 味，仅建议在写作阶段启用。', 4),
  'story-cover': buildHeuristic('cover', [], [], [], false, 'external-only', '当前项目还没有封面生成工作台，此 skill 会作为资料保留，但不会接入正文链路。'),
  'browser-cdp': buildHeuristic('tool', [], [], [], false, 'external-only', '当前项目没有浏览器 CDP 执行能力，此 skill 会作为外部工具说明保留。')
}

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
