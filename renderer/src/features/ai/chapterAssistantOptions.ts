import { Bot, Globe2, Lightbulb, PenTool, Rows3, ScrollText, Sparkles } from 'lucide-vue-next'
import type {
  ChapterAssistantPromptTemplate,
  ChapterAssistantResponseLength,
  ChapterAssistantResponseMode,
  ChapterAssistantTemplateGroup,
  ProjectSummary
} from '@/types/app'

type TemplateIconKey = 'bot' | 'globe' | 'lightbulb' | 'pen' | 'rows' | 'scroll' | 'sparkles'

type BuiltInTemplateDefinition = ChapterAssistantPromptTemplate & {
  iconKey: TemplateIconKey
}

export type ChapterAssistantQuickAction = ChapterAssistantPromptTemplate & {
  icon: typeof Bot
  isBuiltIn: boolean
}

// 章节助理响应模式选项：控制 AI 以何种风格生成内容
export const chapterAssistantModeOptions = [
  { label: '自由', value: 'freeform' as const },
  { label: '润色', value: 'polish' as const },
  { label: '续写', value: 'continue' as const },
  { label: '建议', value: 'suggest' as const },
  { label: '设定', value: 'reference' as const }
] as const

// 章节助理响应长度选项：控制 AI 输出内容的篇幅
export const chapterAssistantLengthOptions = [
  { label: '短', value: 'short' as const },
  { label: '中', value: 'medium' as const },
  { label: '长', value: 'long' as const }
] as const

// 快捷动作分组：将功能相近的快捷动作归类，用于 UI 分组展示
export const chapterAssistantQuickActionGroups = [
  { key: 'write', label: '创作推进', description: '直接生成正文、续写场景和章节草稿。' },
  { key: 'rewrite', label: '改写优化', description: '围绕现有正文做润色、重写和节奏强化。' },
  { key: 'planning', label: '结构规划', description: '处理标题、摘要、分析和后续剧情方向。' },
  { key: 'reference', label: '设定支持', description: '补充世界观、关系和阵营视角。' }
] as const

const builtInTemplates: BuiltInTemplateDefinition[] = [
  {
    id: 'polish-selection',
    label: '润色选中',
    prompt: '请只针对当前选中的正文片段做一版润色，保留原意和剧情信息，提升节奏、画面感与表达准确度。直接输出润色后的最终文本。去AI味：避免重复句式、过度高级词汇、机械逻辑结构，保持句式长短交替，用动作和感官落地而非空泛判断。',
    iconKey: 'pen',
    group: 'rewrite',
    mode: 'polish',
    length: 'medium',
    task: 'chat',
    requiresSelection: true
  },
  {
    id: 'next-outline-draft',
    label: '下一章大纲',
    prompt: '请基于当前章节、分卷目标和已有剧情，生成一条适合作为下一章的大纲草稿。',
    iconKey: 'rows',
    group: 'planning',
    mode: 'suggest',
    length: 'medium',
    task: 'outline-draft',
    requiresSelection: false
  },
  {
    id: 'chapter-title',
    label: '章节标题',
    prompt: '请基于当前章节内容、分卷定位和剧情推进，拟定一个更贴切的章节标题。只保留一个最终标题，要求有小说感，简洁，不要解释。',
    iconKey: 'pen',
    group: 'planning',
    mode: 'freeform',
    length: 'short',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'chapter-summary',
    label: '章节摘要',
    prompt: '请基于当前章节内容，生成一段适合作为章节摘要或本章定位的简洁文案，突出主要冲突与推进，控制在 60 到 100 字。',
    iconKey: 'scroll',
    group: 'planning',
    mode: 'freeform',
    length: 'short',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'scene-description',
    label: '描写环境',
    prompt: '请基于当前章节氛围，补写一段可以直接插入正文的环境描写，让画面感更强。',
    iconKey: 'scroll',
    group: 'write',
    mode: 'continue',
    length: 'medium',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'polish-paragraph',
    label: '润色段落',
    prompt: '请基于当前章节内容给出一版更有节奏感和画面感的润色稿，优先输出可直接插入正文的内容。去AI味：避免重复句式、过度高级词汇、机械逻辑结构，保持句式长短交替，用动作和感官落地而非空泛判断。',
    iconKey: 'pen',
    group: 'rewrite',
    mode: 'polish',
    length: 'medium',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'continue-scene',
    label: '续写片段',
    prompt: '请紧接当前章节正文往后续写一小段，保持人物语气、世界观和剧情方向一致。续写前确认最近章节中的人物状态、已公开情报和未回收伏笔，确保因果连续，不凭空引入未铺垫的设定或资源。禁止流水账——每一行字都要推动剧情或塑造人物；禁止连续空话和同义反复，每段应带来新信息、态度变化或利益变化。',
    iconKey: 'sparkles',
    group: 'write',
    mode: 'continue',
    length: 'long',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'chapter-first-draft',
    label: '本章初稿',
    prompt: '请基于当前章节标题、章节摘要、分卷定位、已有角色关系和组织上下文，直接生成一版可继续写作的本章初稿，优先输出正文，不要解释。成稿字数尽量贴近当前章节预估字数，可上下浮动 10% 左右。先识别本章更接近哪种类型（布局章重试探与利益交换，事件章重行动与资源兑现，过渡章重状态变化与后续钩子，回收章优先回应旧伏笔再打开新问题），再选择对应写法。禁止流水账和文青病，不要用大段背景介绍开场，用场面、动作、感官切入。',
    iconKey: 'sparkles',
    group: 'write',
    mode: 'continue',
    length: 'long',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'rewrite-selection',
    label: '重写选中',
    prompt: '请只针对当前选中的正文片段做一版重写，保留剧情事实，但强化表达、动作层次和情绪推进。直接输出最终文本。',
    iconKey: 'pen',
    group: 'rewrite',
    mode: 'polish',
    length: 'medium',
    task: 'chat',
    requiresSelection: true
  },
  {
    id: 'strengthen-conflict',
    label: '强化冲突',
    prompt: '请基于当前章节内容，输出一版更有冲突推进力的正文或改写建议，优先强化人物立场碰撞、关系张力和场景对抗。冲突必须由利益驱动，配角和反派必须有反扑、误判和自己的算盘，不能站着等死或为了推剧情而降智。主角成功最好伴随代价，表层爽点里层成本。',
    iconKey: 'lightbulb',
    group: 'rewrite',
    mode: 'suggest',
    length: 'medium',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'adjust-pacing',
    label: '调整节奏',
    prompt: '请基于当前章节内容，给出一版更顺畅的节奏调整结果。若适合直接改写，就优先输出可插入正文的最终文本；若不适合整体改写，再给出具体修改方案。',
    iconKey: 'bot',
    group: 'rewrite',
    mode: 'polish',
    length: 'medium',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'next-chapter-suggestions',
    label: '下一章建议',
    prompt: '请结合当前章节、分卷目标和已有大纲，给出 3 条下一章剧情推进建议。每条都要包含推进方向、核心冲突和一个能勾住读者的钩子。',
    iconKey: 'lightbulb',
    group: 'planning',
    mode: 'suggest',
    length: 'medium',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'reference-reminders',
    label: '设定查阅',
    prompt: '请结合当前章节、已有世界观和角色设定，列出 3 到 5 条与本章最相关的设定提醒，并说明如何自然融入正文。',
    iconKey: 'globe',
    group: 'reference',
    mode: 'reference',
    length: 'medium',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'chapter-analysis',
    label: '章节分析',
    prompt: '请分析当前章节的节奏、张力、连续性和改稿优先级，并给出可以立刻执行的修改建议。审查维度包括：人物OOC、时间线断裂、利益链不成立、配角工具人化、爽点虚化、台词失真、语言重复、设定冲突、信息越界、伏笔失管、词汇疲劳、设定吃书、数据通胀、战力崩坏、流水账、文青病、关系发展突兀、人设前后矛盾。按"问题→证据→最小修法"输出，优先修根因。',
    iconKey: 'bot',
    group: 'planning',
    mode: 'suggest',
    length: 'medium',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'revision-plan',
    label: '改稿计划',
    prompt: '请先诊断当前章节最影响阅读体验的问题，再按优先级给出一份具体改稿计划。每一步都要说明修改目标、落点位置和可执行动作。',
    iconKey: 'rows',
    group: 'planning',
    mode: 'suggest',
    length: 'medium',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'diagnose-rewrite',
    label: '诊断改写',
    prompt: '请先快速判断当前章节的节奏、张力和连续性问题，然后直接输出一版可替换或插入正文的改写结果，优先处理最影响阅读体验的段落。优先修根因，不做表面润色；若问题源于动机链断裂、设定吃书或信息越界，先补逻辑链再改表达。禁止流水账和文青病。',
    iconKey: 'pen',
    group: 'planning',
    mode: 'polish',
    length: 'long',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'relationship-conflict',
    label: '关系冲突',
    prompt: '请结合当前章节、已有人物关系、组织阵营与成员归属，给出 3 条更能推动剧情的关系驱动冲突建议。每条都要说明冲突双方、阵营立场和可落地到本章或下一章的触发点。冲突必须由利益驱动，不能是心软或圣母；配角必须有反扑，不能站着等死。严禁无理由的爱/恨——关系变化必须有事件驱动和铺垫，不能跨越式发展。',
    iconKey: 'lightbulb',
    group: 'reference',
    mode: 'suggest',
    length: 'medium',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'camp-perspective',
    label: '阵营视角',
    prompt: '请基于当前章节内容，改写或补写一段更鲜明体现某个组织或阵营立场的正文，让人物态度、用词和冲突重心更贴合其归属。',
    iconKey: 'sparkles',
    group: 'reference',
    mode: 'polish',
    length: 'medium',
    task: 'chat',
    requiresSelection: false
  },
  {
    id: 'humanize-ai',
    label: '降低AI感',
    prompt: '请对选中的正文片段进行深度人化润色，目标是让文字读起来更像人类写的、更自然、更口语化。规则：①高频使用"把"字句和"给"字结构（"他拉下电闸"→"他去把电闸给拉了下来"）；②适当堆叠虚词语气词（了、的、罢了、呢、嘛、倒、可），让句子从精炼变自然啰嗦；③关键情绪词做叠词强化（"她笑了笑""点点头""沉默了沉默"）；④口语化过程描写（"寻找"→"四处寻摸""确认"→"反复确认了好几遍"）；⑤删除所有AI套话（综上所述/值得注意的是/不难发现/总而言之/毫无疑问/显而易见/不言而喻）；⑥避免三段式结构（首先…其次…最后）；⑦内容锁定：情节走向、人物关系、因果逻辑、所有专有名词必须与原文完全一致；⑧字数控制在原文±5%，只做替换不做叠加；只输出修改后的完整正文，不附加任何解释。',
    iconKey: 'sparkles',
    group: 'rewrite',
    mode: 'polish',
    length: 'long',
    task: 'chat',
    requiresSelection: true
  }
] as const

const iconMap: Record<TemplateIconKey, typeof Bot> = {
  bot: Bot,
  globe: Globe2,
  lightbulb: Lightbulb,
  pen: PenTool,
  rows: Rows3,
  scroll: ScrollText,
  sparkles: Sparkles
}

export function getBuiltInChapterAssistantTemplates(): ChapterAssistantPromptTemplate[] {
  return builtInTemplates.map(({ iconKey: _iconKey, ...template }) => ({ ...template }))
}

export function getResolvedChapterAssistantTemplates(project?: ProjectSummary | null): ChapterAssistantQuickAction[] {
  const projectTemplates = project?.chapterAssistantTemplates ?? []
  const builtInIdSet = new Set(builtInTemplates.map((template) => template.id))
  const overrideMap = new Map(projectTemplates.filter((template) => builtInIdSet.has(template.id)).map((template) => [template.id, template]))
  const customTemplates = projectTemplates.filter((template) => !builtInIdSet.has(template.id))

  const resolvedBuiltIns = builtInTemplates.map((template) => {
    const override = overrideMap.get(template.id)
    return {
      ...template,
      ...(override ?? {}),
      icon: iconMap[resolveTemplateIconKey(override ?? template)],
      isBuiltIn: true
    }
  })

  const resolvedCustoms = customTemplates.map((template) => ({
    ...template,
    icon: iconMap[resolveTemplateIconKey(template)],
    isBuiltIn: false
  }))

  return [...resolvedBuiltIns, ...resolvedCustoms]
}

export function upsertProjectChapterAssistantTemplate(
  currentTemplates: ChapterAssistantPromptTemplate[],
  template: ChapterAssistantPromptTemplate
): ChapterAssistantPromptTemplate[] {
  const nextTemplates = [...currentTemplates]
  const existingIndex = nextTemplates.findIndex((item) => item.id === template.id)
  if (existingIndex >= 0) {
    nextTemplates.splice(existingIndex, 1, template)
    return nextTemplates
  }

  nextTemplates.push(template)
  return nextTemplates
}

export function removeProjectChapterAssistantTemplate(
  currentTemplates: ChapterAssistantPromptTemplate[],
  templateId: string
): ChapterAssistantPromptTemplate[] {
  return currentTemplates.filter((template) => template.id !== templateId)
}

export function duplicateChapterAssistantTemplate(
  project: ProjectSummary | null | undefined,
  templateId: string
): ChapterAssistantPromptTemplate | null {
  const source = buildPromptTemplateDraft(project, templateId)
  if (!source) {
    return null
  }

  return {
    ...source,
    id: `custom-template-${Date.now()}`,
    label: `${source.label} 副本`
  }
}

export function buildPromptTemplateDraft(
  project: ProjectSummary | null | undefined,
  templateId: string
): ChapterAssistantPromptTemplate | null {
  const resolved = getResolvedChapterAssistantTemplates(project).find((template) => template.id === templateId)
  if (!resolved) {
    return null
  }

  return {
    id: resolved.id,
    label: resolved.label,
    group: resolved.group,
    prompt: resolved.prompt,
    mode: resolved.mode,
    length: resolved.length,
    task: resolved.task,
    requiresSelection: resolved.requiresSelection
  }
}

function resolveTemplateIconKey(
  template: Pick<ChapterAssistantPromptTemplate, 'group' | 'task' | 'requiresSelection'>
): TemplateIconKey {
  if (template.task === 'outline-draft') {
    return 'rows'
  }

  if (template.requiresSelection) {
    return 'pen'
  }

  switch (template.group) {
    case 'write':
      return 'sparkles'
    case 'rewrite':
      return 'pen'
    case 'planning':
      return 'rows'
    case 'reference':
      return 'globe'
    default:
      return 'bot'
  }
}

export function resolveTemplateGroupLabel(group: ChapterAssistantTemplateGroup): string {
  return chapterAssistantQuickActionGroups.find((item) => item.key === group)?.label ?? group
}

export function resolveTemplateModeLabel(mode: ChapterAssistantResponseMode): string {
  return chapterAssistantModeOptions.find((item) => item.value === mode)?.label ?? mode
}

export function resolveTemplateLengthLabel(length: ChapterAssistantResponseLength): string {
  return chapterAssistantLengthOptions.find((item) => item.value === length)?.label ?? length
}
