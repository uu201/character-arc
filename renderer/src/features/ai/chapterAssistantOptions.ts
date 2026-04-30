import { Bot, Globe2, Lightbulb, PenTool, Rows3, ScrollText, Sparkles } from 'lucide-vue-next'

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

// 快捷动作列表：每个动作定义了预设提示词、所属分组、响应模式和长度
// icon 用于 UI 显示，task 决定后端处理方式（普通聊天或大纲草稿生成）
// requiresSelection 标记该动作是否需要先选中文本才能触发
export const chapterAssistantQuickActions = [
  {
    label: '润色选中',
    prompt: '请只针对当前选中的正文片段做一版润色，保留原意和剧情信息，提升节奏、画面感与表达准确度。直接输出润色后的最终文本。',
    icon: PenTool,
    group: 'rewrite' as const,
    mode: 'polish' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: true
  },
  {
    label: '下一章大纲',
    prompt: '请基于当前章节、分卷目标和已有剧情，生成一条适合作为下一章的大纲草稿。',
    icon: Rows3,
    group: 'planning' as const,
    mode: 'suggest' as const,
    length: 'medium' as const,
    task: 'outline-draft' as const,  // 特殊任务类型，后端会以此生成结构化大纲
    requiresSelection: false
  },
  {
    label: '章节标题',
    prompt: '请基于当前章节内容、分卷定位和剧情推进，拟定一个更贴切的章节标题。只保留一个最终标题，要求有小说感，简洁，不要解释。',
    icon: PenTool,
    group: 'planning' as const,
    mode: 'freeform' as const,
    length: 'short' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '章节摘要',
    prompt: '请基于当前章节内容，生成一段适合作为章节摘要或本章定位的简洁文案，突出主要冲突与推进，控制在 60 到 100 字。',
    icon: ScrollText,
    group: 'planning' as const,
    mode: 'freeform' as const,
    length: 'short' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '描写环境',
    prompt: '请基于当前章节氛围，补写一段可以直接插入正文的环境描写，让画面感更强。',
    icon: ScrollText,
    group: 'write' as const,
    mode: 'continue' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '润色段落',
    prompt: '请基于当前章节内容给出一版更有节奏感和画面感的润色稿，优先输出可直接插入正文的内容。',
    icon: PenTool,
    group: 'rewrite' as const,
    mode: 'polish' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '续写片段',
    prompt: '请紧接当前章节正文往后续写一小段，保持人物语气、世界观和剧情方向一致。',
    icon: Sparkles,
    group: 'write' as const,
    mode: 'continue' as const,
    length: 'long' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '本章初稿',
    prompt: '请基于当前章节标题、章节摘要、分卷定位、已有角色关系和组织上下文，直接生成一版可继续写作的本章初稿，优先输出正文，不要解释。',
    icon: Sparkles,
    group: 'write' as const,
    mode: 'continue' as const,
    length: 'long' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '重写选中',
    prompt: '请只针对当前选中的正文片段做一版重写，保留剧情事实，但强化表达、动作层次和情绪推进。直接输出最终文本。',
    icon: PenTool,
    group: 'rewrite' as const,
    mode: 'polish' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: true
  },
  {
    label: '强化冲突',
    prompt: '请基于当前章节内容，输出一版更有冲突推进力的正文或改写建议，优先强化人物立场碰撞、关系张力和场景对抗。',
    icon: Lightbulb,
    group: 'rewrite' as const,
    mode: 'suggest' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '调整节奏',
    prompt: '请基于当前章节内容，给出一版更顺畅的节奏调整结果。若适合直接改写，就优先输出可插入正文的最终文本；若不适合整体改写，再给出具体修改方案。',
    icon: Bot,
    group: 'rewrite' as const,
    mode: 'polish' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '下一章建议',
    prompt: '请结合当前章节、分卷目标和已有大纲，给出 3 条下一章剧情推进建议。每条都要包含推进方向、核心冲突和一个能勾住读者的钩子。',
    icon: Lightbulb,
    group: 'planning' as const,
    mode: 'suggest' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '设定查阅',
    prompt: '请结合当前章节、已有世界观和角色设定，列出 3 到 5 条与本章最相关的设定提醒，并说明如何自然融入正文。',
    icon: Globe2,
    group: 'reference' as const,
    mode: 'reference' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '章节分析',
    prompt: '请分析当前章节的节奏、张力、连续性和改稿优先级，并给出可以立刻执行的修改建议。',
    icon: Bot,
    group: 'planning' as const,
    mode: 'suggest' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '改稿计划',
    prompt: '请先诊断当前章节最影响阅读体验的问题，再按优先级给出一份具体改稿计划。每一步都要说明修改目标、落点位置和可执行动作。',
    icon: Rows3,
    group: 'planning' as const,
    mode: 'suggest' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '诊断改写',
    prompt: '请先快速判断当前章节的节奏、张力和连续性问题，然后直接输出一版可替换或插入正文的改写结果，优先处理最影响阅读体验的段落。',
    icon: PenTool,
    group: 'planning' as const,
    mode: 'polish' as const,
    length: 'long' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '关系冲突',
    prompt: '请结合当前章节、已有人物关系、组织阵营与成员归属，给出 3 条更能推动剧情的关系驱动冲突建议。每条都要说明冲突双方、阵营立场和可落地到本章或下一章的触发点。',
    icon: Lightbulb,
    group: 'reference' as const,
    mode: 'suggest' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '阵营视角',
    prompt: '请基于当前章节内容，改写或补写一段更鲜明体现某个组织或阵营立场的正文，让人物态度、用词和冲突重心更贴合其归属。',
    icon: Sparkles,
    group: 'reference' as const,
    mode: 'polish' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: false
  }
] as const

// 快捷动作类型：从数组字面量中推导出的联合类型
export type ChapterAssistantQuickAction = (typeof chapterAssistantQuickActions)[number]
