import type { AiTaskName, AiTaskPayload, PromptPair } from './aiShared'

export type PromptCapabilityId =
  | 'workflow'
  | 'worldview'
  | 'characters'
  | 'relations'
  | 'inspiration'
  | 'outline'
  | 'chapters'
  | 'analysis'
  | 'writing-style'
  | 'project-skills'
  | 'versioning'
  | 'import-export'
  | 'settings'

type PromptCapabilityDefinition = {
  label: string
  systemNote: string
  userRule: string
}

type PromptTaskProfile = {
  label: string
  defaultCapabilities: PromptCapabilityId[]
}

const PROMPT_CAPABILITY_DEFINITIONS: Record<PromptCapabilityId, PromptCapabilityDefinition> = {
  workflow: {
    label: '小说流程与项目文件',
    systemNote: '可以读写 task_plan、findings、progress、current_status、novel_setting、character_relationships、pending_hooks、resource_ledger 这些流程文件。',
    userRule: '流程文件是当前项目的工作记忆，应该延续已有内容，不要凭空另起一套口径。'
  },
  worldview: {
    label: '世界观设定',
    systemNote: '可以引用世界背景、规则、势力、历史等设定条目。设定吃书禁止：前文已写明的设定，后文不能矛盾覆盖；若必须修改，要明确说明覆盖了哪些旧设定。不要整段讲百科——设定必须在场景里落地。',
    userRule: '世界观内容必须服务当前项目，不能把未锁定设定写成正式事实。设定融入剧情，不要大段复制粘贴背景介绍。'
  },
  characters: {
    label: '角色图鉴',
    systemNote: '可以使用角色姓名、定位、描述、标签等角色信息。角色行为必须由过往经历+当前利益+性格底色共同驱动，严禁反派降智或主角圣母。配角不能是工具人，必须有算盘、恐惧、筹码、误判与反扑。人设防崩：任何反常行为必须用前文铺垫解释，不能靠"突然顿悟"或"心软"搪塞。人设前后矛盾：角色不能突然做出与性格矛盾的选择，成长必须在逻辑合理范畴内。主角成功无代价：成功最好伴随不可逆的代价，表层爽点里层成本。',
    userRule: '角色行为和新增角色必须尽量嵌入现有角色网络，避免孤立路人。反派和配角必须基于其已知信息和利益行动，不能为了推剧情而降智。人设不能前后矛盾，不能前面是大女主后面是大圣母。'
  },
  relations: {
    label: '关系与组织',
    systemNote: '可以使用组织、角色关系、成员归属、阵营立场等结构化关系信息。配角不能是工具人，必须有算盘、恐惧、筹码、误判与反扑。冲突必须由利益驱动，不能是心软或圣母。角色关系的改变必须有事件驱动和铺垫，不能跨越式发展。严禁无理由的爱/恨——所有关系的改变必须有事件驱动和铺垫。关系发展突兀——情感和关系必须有递进过程，不能通过标签化互动强行推进。',
    userRule: '如果关系、组织或归属会影响冲突、措辞或行动，优先把这些因素纳入输出。冲突必须由利益驱动，配角必须有反扑，不能站着等死。关系变化必须有因果，不能凭空产生。'
  },
  inspiration: {
    label: '灵感模块',
    systemNote: '可以读取灵感卡片，把标题灵感、开篇钩子、场景火花、剧情转折等转成可执行内容。',
    userRule: '灵感必须落到当前项目的桥段、设定或冲突上，不要输出空泛点子。'
  },
  outline: {
    label: '大纲规划',
    systemNote: '可以使用分卷、大纲节点、冲突、摘要和章节绑定状态。不同章节类型应使用不同推进方式：布局章重试探与利益交换，事件章重行动与资源兑现，过渡章重状态变化与后续钩子，回收章优先回应旧伏笔再打开新问题。',
    userRule: '大纲内容必须连续推进，不能生成与现有分卷方向脱节的散点。每段推进应带来至少一项新信息、态度变化或利益变化，避免空转。'
  },
  chapters: {
    label: '章节编辑器',
    systemNote: '可以使用当前章节标题、摘要、状态、正文、相邻章节和选中文本。续写或改写前必须确认最近章节中的人物状态、已公开情报、已动用资源和未回收伏笔，确保因果连续。改写边界：润色只改表达不改事实，改写可改叙述但保留核心事实，重写可重构场景但不改主设定，续写只向前推进不反改前文。禁止流水账——每一行字都要推动剧情或塑造人物。禁止文青病——不要在紧张推进时突然感慨人生。禁止历史课件式开头——用场面、动作、感官切入。',
    userRule: '涉及正文时优先输出可直接插入、替换或回写章节的结果，而不是泛泛解释。续写必须紧接现有正文自然推进，保持语气、节奏和剧情方向一致。禁止连续空话和同义反复，每段应带来新信息、态度变化或利益变化。'
  },
  analysis: {
    label: '章节分析',
    systemNote: '可以围绕节奏、张力、连续性、风险和修正动作输出分析。审查维度包括：人物OOC、时间线断裂、利益链不成立、配角工具人化、爽点虚化、台词失真、语言重复、设定冲突、信息越界、伏笔失管、词汇疲劳、设定吃书、数据通胀、战力崩坏、流水账、文青病、关系发展突兀、人设前后矛盾。优先修根因，不做表面润色。',
    userRule: '分析时要指出具体问题和可执行修法，不要只给空泛评价。按"问题→证据→最小修法"输出，涉及数值跳变或信息越界时一并给出修订方案。'
  },
  'writing-style': {
    label: '写作风格',
    systemNote: '可以读取项目默认风格名称和风格提示词。',
    userRule: '风格要作为约束参与生成，但不能盖过当前任务本身。'
  },
  'project-skills': {
    label: '项目级 skills',
    systemNote: '可以吸收当前项目启用的 skills 内容和阶段规则。',
    userRule: '只有在当前任务相关时才引用 skills，且优先延续其约束而不是照抄措辞。'
  },
  versioning: {
    label: '版本与回写',
    systemNote: '可以结合章节版本、恢复、正文插入、替换选区、设为标题或摘要这些能力思考输出形式。',
    userRule: '输出应尽量适配软件现有回写方式，方便直接落到章节、标题或摘要。'
  },
  'import-export': {
    label: '导入导出',
    systemNote: '项目支持结构化导入导出和模块级数据迁移。',
    userRule: '涉及迁移、补档或流程文件生成时，要保持字段结构稳定、便于后续保存和导出。'
  },
  settings: {
    label: '设置与模型配置',
    systemNote: '项目具有模型设置、主题和自动保存等配置能力。',
    userRule: '不要假设存在未实现的远程协作、社区、云同步或插件市场能力。'
  }
}

const PROMPT_TASK_PROFILES: Record<AiTaskName, PromptTaskProfile> = {
  'worldview-entry': {
    label: '世界观生成',
    defaultCapabilities: ['settings', 'worldview', 'writing-style']
  },
  'character-card': {
    label: '角色生成',
    defaultCapabilities: ['settings', 'characters', 'relations', 'worldview', 'writing-style']
  },
  'outline-item': {
    label: '单节点大纲生成',
    defaultCapabilities: ['settings', 'outline', 'worldview', 'characters', 'writing-style']
  },
  'outline-batch': {
    label: '批量大纲生成',
    defaultCapabilities: ['settings', 'outline', 'worldview', 'characters', 'relations', 'writing-style', 'project-skills']
  },
  'outline-chain': {
    label: '后续剧情链规划',
    defaultCapabilities: ['settings', 'outline', 'chapters', 'worldview', 'characters', 'relations', 'writing-style', 'project-skills']
  },
  'reference-style-chunk': {
    label: '参考作品分块分析',
    defaultCapabilities: ['settings', 'analysis', 'writing-style', 'outline', 'import-export']
  },
  'reference-style-analysis': {
    label: '参考作品仿写分析',
    defaultCapabilities: ['settings', 'analysis', 'writing-style', 'outline', 'import-export']
  },
  'workflow-documents': {
    label: '流程文件生成',
    defaultCapabilities: ['settings', 'workflow', 'import-export']
  },
  'chapter-assistant': {
    label: '章节创作助理',
    defaultCapabilities: ['settings', 'chapters', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'writing-style', 'project-skills', 'versioning']
  },
  'chapter-first-draft': {
    label: '章节初稿生成',
    defaultCapabilities: ['settings', 'chapters', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'writing-style', 'project-skills', 'versioning']
  },
  'project-bootstrap': {
    label: '项目初始化',
    defaultCapabilities: ['settings', 'worldview', 'outline', 'characters', 'writing-style']
  },
  'chapter-analysis': {
    label: '章节分析',
    defaultCapabilities: ['settings', 'chapters', 'analysis', 'worldview', 'characters', 'relations', 'outline', 'versioning']
  },
  'inspiration-pack': {
    label: '灵感卡片生成',
    defaultCapabilities: ['settings', 'inspiration', 'chapters', 'worldview', 'characters', 'relations', 'outline', 'writing-style']
  },
  'chapter-summarize': {
    label: '章节摘要生成',
    defaultCapabilities: ['settings', 'chapters', 'analysis']
  },
  'chapter-scene-plan': {
    label: '章节场景规划',
    defaultCapabilities: ['settings', 'chapters', 'outline']
  },
  'plot-thread-detect': {
    label: '章节伏笔识别',
    defaultCapabilities: ['settings', 'chapters', 'analysis']
  }
}

export function buildCapabilityPromptContext(task: AiTaskPayload): PromptPair {
  const taskProfile = resolvePromptTaskProfile(task.task)
  const activeCapabilities = resolvePromptCapabilities(task)
  const capabilityLines = activeCapabilities.map((id) => {
    const definition = PROMPT_CAPABILITY_DEFINITIONS[id]
    return `- ${definition.label}：${definition.systemNote}`
  })
  const ruleLines = activeCapabilities.map((id) => {
    const definition = PROMPT_CAPABILITY_DEFINITIONS[id]
    return `- ${definition.label}：${definition.userRule}`
  })

  return {
    system: [
      '你正在 CharacterArc 当前已实现的功能范围内工作。',
      '不要把“/小说流程”或“/小说流程2”当成固定模板来源；它们只能作为参考样式，真正的输出必须按当前任务和当前可用模块适配。',
      `本次任务类型：${task.task}。`,
      `本次任务功能定位：${taskProfile.label}。`,
      '本次任务相关的已实现功能模块：',
      ...capabilityLines
    ].join('\n'),
    user: ['当前任务必须遵守以下功能适配规则：', ...ruleLines].join('\n')
  }
}

export function resolvePromptTaskProfile(taskName: AiTaskName): PromptTaskProfile {
  return PROMPT_TASK_PROFILES[taskName]
}

export function resolvePromptCapabilities(task: AiTaskPayload): PromptCapabilityId[] {
  const taskProfile = resolvePromptTaskProfile(task.task)
  const capabilityIds = new Set<PromptCapabilityId>(taskProfile.defaultCapabilities)
  const context = task.context ?? {}

  if (hasWorkflowContext(context)) {
    capabilityIds.add('workflow')
  }

  if (hasWorldviewContext(context)) {
    capabilityIds.add('worldview')
  }

  if (hasCharacterContext(context)) {
    capabilityIds.add('characters')
  }

  if (hasRelationsContext(context)) {
    capabilityIds.add('relations')
  }

  if (hasInspirationContext(context)) {
    capabilityIds.add('inspiration')
  }

  if (hasOutlineContext(context)) {
    capabilityIds.add('outline')
  }

  if (hasChapterContext(context)) {
    capabilityIds.add('chapters')
  }

  if (hasWritingStyleContext(context)) {
    capabilityIds.add('writing-style')
  }

  if (Array.isArray(context.projectSkills) && context.projectSkills.length > 0) {
    capabilityIds.add('project-skills')
  }

  if (task.task === 'workflow-documents') {
    addWorkflowStageCapabilities(capabilityIds, String(context.stageId ?? 'reference'))
  }

  return Array.from(capabilityIds)
}

export function resolveChapterAssistantModeInstruction(mode: string): string {
  switch (mode) {
    case 'polish':
      return '当前模式是"润色"。请尽量直接输出可替换原文的润色结果，减少分析。'
    case 'continue':
      return '当前模式是"续写"。请紧接现有正文自然续写，保持语气、节奏和剧情方向一致。'
    case 'suggest':
      return '当前模式是"剧情建议"。请给出 3 到 5 条具体建议，按可执行性优先排序。'
    case 'reference':
      return '当前模式是"设定查阅"。请优先提炼与当前章节最相关的设定、角色和风险点。'
    default:
      return '当前模式是"自由提问"。请根据用户请求选择最合适的回答形式。'
  }
}

export function resolveChapterAssistantLengthInstruction(length: string): string {
  switch (length) {
    case 'short':
      return '控制在 80 到 180 字，结论优先，避免铺垫过长。'
    case 'long':
      return '控制在 350 到 800 字，可以展开完整段落或多条具体建议。'
    case 'medium':
    default:
      return '控制在 160 到 360 字，兼顾可读性和可执行性。'
  }
}

export function resolveChapterAssistantQuickActionInstruction(quickAction: string): string {
  switch (quickAction) {
    case '章节标题':
      return '如果当前任务是生成章节标题，只输出一个最终标题，不要解释、不要分点、不要加书名号；若与通用长度要求冲突，以本条为准。'
    case '章节摘要':
      return '如果当前任务是生成章节摘要，请输出一段可直接作为本章定位的简洁摘要，不要分点，不要额外说明。'
    case '润色选中':
      return '如果当前任务是润色选中内容，请只输出润色后的最终文本，紧贴当前选中文本，不要解释，不要分点。'
    case '下一章建议':
      return '如果当前任务是下一章建议，请输出 3 条具体方案，每条都要体现推进方向、冲突和悬念。'
    case '关系冲突':
      return '如果当前任务是关系冲突，请输出 3 条关系驱动冲突方案，每条都明确人物关系、阵营立场和可触发场景。'
    case '阵营视角':
      return '如果当前任务是阵营视角，请优先输出可直接替换或插入正文的最终文本，突出组织立场、身份认同和冲突措辞。'
    case '降低AI感':
      return '如果当前任务是降低AI感润色，请严格遵循 prompt 中的人化规则重写选中文本。专有名词（人名/地名/势力名）一字不改，情节因果完整保留，字数偏差不超过 ±5%，只输出最终正文，不解释、不分点、不加标签。'
    default:
      return '如果快捷动作已经明确输出形态，请优先遵循该动作要求。'
  }
}

function addWorkflowStageCapabilities(
  capabilityIds: Set<PromptCapabilityId>,
  stageId: string
): void {
  switch (stageId) {
    case 'reference':
      capabilityIds.add('workflow')
      capabilityIds.add('inspiration')
      break
    case 'premise':
      capabilityIds.add('workflow')
      capabilityIds.add('worldview')
      capabilityIds.add('writing-style')
      break
    case 'setting':
      capabilityIds.add('workflow')
      capabilityIds.add('worldview')
      capabilityIds.add('characters')
      capabilityIds.add('relations')
      break
    case 'outline':
      capabilityIds.add('workflow')
      capabilityIds.add('outline')
      capabilityIds.add('chapters')
      break
    case 'draft':
      capabilityIds.add('workflow')
      capabilityIds.add('chapters')
      capabilityIds.add('analysis')
      capabilityIds.add('inspiration')
      capabilityIds.add('versioning')
      break
    default:
      capabilityIds.add('workflow')
      break
  }
}

function hasWorkflowContext(context: Record<string, unknown>): boolean {
  return (
    Array.isArray(context.workflowDocuments) ||
    Array.isArray(context.requestedDocuments) ||
    typeof context.stageId === 'string'
  )
}

function hasWorldviewContext(context: Record<string, unknown>): boolean {
  return Array.isArray(context.worldviewEntries) || Array.isArray(context.worldviewTitles)
}

function hasCharacterContext(context: Record<string, unknown>): boolean {
  return Array.isArray(context.characters) || Array.isArray(context.characterNames)
}

function hasRelationsContext(context: Record<string, unknown>): boolean {
  return (
    Array.isArray(context.organizations) ||
    Array.isArray(context.characterRelationships) ||
    Array.isArray(context.organizationMemberships)
  )
}

function hasInspirationContext(context: Record<string, unknown>): boolean {
  return Array.isArray(context.inspirationEntries) || Array.isArray(context.existingInspirationTitles)
}

function hasOutlineContext(context: Record<string, unknown>): boolean {
  return (
    Array.isArray(context.outlineItems) ||
    Array.isArray(context.currentVolumeOutlineItems) ||
    Array.isArray(context.outlineTitles) ||
    typeof context.currentOutlineItem === 'object'
  )
}

function hasChapterContext(context: Record<string, unknown>): boolean {
  return (
    typeof context.chapterContent === 'string' ||
    typeof context.chapterTitle === 'string' ||
    Array.isArray(context.relatedChapters)
  )
}

function hasWritingStyleContext(context: Record<string, unknown>): boolean {
  return Boolean(String(context.writingStyleLabel ?? '').trim() || String(context.writingStylePrompt ?? '').trim())
}
