import type { AiTaskName, PromptPair } from '../shared-types'

/** AI 任务可用的功能模块标识 */
export type PromptCapabilityId =
  | 'workflow' | 'worldview' | 'characters' | 'relations'
  | 'inspiration' | 'outline' | 'chapters' | 'analysis'
  | 'writing-style' | 'project-skills' | 'versioning'
  | 'import-export' | 'settings'

/** 单个功能模块的定义，包含标签、系统提示和用户规则 */
type PromptCapabilityDefinition = { label: string; systemNote: string; userRule: string }

/** 所有功能模块的完整定义映射 */
const PROMPT_CAPABILITY_DEFINITIONS: Record<PromptCapabilityId, PromptCapabilityDefinition> = {
  workflow: { label: '小说流程与项目文件', systemNote: '可以读写 task_plan、findings、progress、current_status、novel_setting、character_relationships、pending_hooks、resource_ledger 这些流程文件。', userRule: '流程文件是当前项目的工作记忆，应该延续已有内容，不要凭空另起一套口径。' },
  worldview: { label: '世界观设定', systemNote: '可以引用世界背景、规则、势力、历史等设定条目。设定吃书禁止：前文已写明的设定，后文不能矛盾覆盖；若必须修改，要明确说明覆盖了哪些旧设定。不要整段讲百科——设定必须在场景里落地。', userRule: '世界观内容必须服务当前项目，不能把未锁定设定写成正式事实。设定融入剧情，不要大段复制粘贴背景介绍。' },
  characters: { label: '角色图鉴', systemNote: '可以使用角色姓名、定位、描述、标签等角色信息。角色行为必须由过往经历+当前利益+性格底色共同驱动，严禁反派降智或主角圣母。配角不能是工具人，必须有算盘、恐惧、筹码、误判与反扑。人设防崩：任何反常行为必须用前文铺垫解释，不能靠"突然顿悟"或"心软"搪塞。', userRule: '角色行为和新增角色必须尽量嵌入现有角色网络，避免孤立路人。反派和配角必须基于其已知信息和利益行动，不能为了推剧情而降智。' },
  relations: { label: '关系与组织', systemNote: '可以使用组织、角色关系、成员归属、阵营立场等结构化关系信息。配角不能是工具人，必须有算盘、恐惧、筹码、误判与反扑。冲突必须由利益驱动。严禁无理由的爱/恨——所有关系的改变必须有事件驱动和铺垫。', userRule: '如果关系、组织或归属会影响冲突、措辞或行动，优先把这些因素纳入输出。冲突必须由利益驱动，配角必须有反扑。' },
  inspiration: { label: '灵感模块', systemNote: '可以读取灵感卡片，把标题灵感、开篇钩子、场景火花、剧情转折等转成可执行内容。', userRule: '灵感必须落到当前项目的桥段、设定或冲突上，不要输出空泛点子。' },
  outline: { label: '大纲规划', systemNote: '可以使用分卷、大纲节点、冲突、摘要和章节绑定状态。不同章节类型应使用不同推进方式。', userRule: '大纲内容必须连续推进，不能生成与现有分卷方向脱节的散点。每段推进应带来至少一项新信息、态度变化或利益变化。' },
  chapters: { label: '章节编辑器', systemNote: '可以使用当前章节标题、摘要、状态、正文、相邻章节和选中文本。续写或改写前必须确认最近章节中的人物状态、已公开情报、已动用资源和未回收伏笔，确保因果连续。禁止流水账——每一行字都要推动剧情或塑造人物。', userRule: '涉及正文时优先输出可直接插入、替换或回写章节的结果，而不是泛泛解释。续写必须紧接现有正文自然推进。' },
  analysis: { label: '章节分析', systemNote: '可以围绕节奏、张力、连续性、风险和修正动作输出分析。优先修根因，不做表面润色。', userRule: '分析时要指出具体问题和可执行修法，不要只给空泛评价。按"问题→证据→最小修法"输出。' },
  'writing-style': { label: '写作风格', systemNote: '可以读取项目默认风格名称和风格提示词。', userRule: '风格要作为约束参与生成，但不能盖过当前任务本身。' },
  'project-skills': { label: '项目级 skills', systemNote: '可以吸收当前项目启用的 skills 内容和阶段规则。', userRule: '只有在当前任务相关时才引用 skills，且优先延续其约束而不是照抄措辞。' },
  versioning: { label: '版本与回写', systemNote: '可以结合章节版本、恢复、正文插入、替换选区、设为标题或摘要这些能力思考输出形式。', userRule: '输出应尽量适配软件现有回写方式。' },
  'import-export': { label: '导入导出', systemNote: '项目支持结构化导入导出和模块级数据迁移。', userRule: '涉及迁移、补档或流程文件生成时，要保持字段结构稳定。' },
  settings: { label: '设置与模型配置', systemNote: '项目具有模型设置、主题和自动保存等配置能力。', userRule: '不要假设存在未实现的远程协作、社区、云同步或插件市场能力。' }
}

/** 每种 AI 任务默认启用的功能模块列表 */
const TASK_DEFAULT_CAPABILITIES: Record<AiTaskName, PromptCapabilityId[]> = {
  'worldview-entry': ['settings', 'worldview', 'writing-style'],
  'character-card': ['settings', 'characters', 'relations', 'worldview', 'writing-style'],
  'outline-item': ['settings', 'outline', 'worldview', 'characters', 'writing-style'],
  'outline-batch': ['settings', 'outline', 'worldview', 'characters', 'relations', 'writing-style', 'project-skills'],
  'outline-chain': ['settings', 'outline', 'chapters', 'worldview', 'characters', 'relations', 'writing-style', 'project-skills'],
  'reference-style-chunk': ['settings', 'analysis', 'writing-style', 'outline', 'import-export', 'project-skills'],
  'reference-style-analysis': ['settings', 'analysis', 'writing-style', 'outline', 'import-export', 'project-skills'],
  'reference-deep-analyze': ['settings', 'analysis', 'writing-style', 'project-skills', 'import-export'],
  'style-fingerprint-extract': ['settings', 'analysis', 'writing-style', 'project-skills'],
  'workflow-documents': ['settings', 'workflow', 'import-export'],
  'assistant-intent': ['settings', 'chapters', 'analysis', 'versioning'],
  'assistant-action-proposal': ['settings', 'chapters', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'writing-style', 'project-skills', 'versioning'],
  'global-assistant': ['settings', 'workflow', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'analysis', 'writing-style', 'project-skills', 'versioning'],
  'global-assistant-proposal': ['settings', 'workflow', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'analysis', 'writing-style', 'project-skills', 'versioning'],
  'chapter-assistant': ['settings', 'chapters', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'writing-style', 'project-skills', 'versioning'],
  'chapter-first-draft': ['settings', 'chapters', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'writing-style', 'project-skills', 'versioning'],
  'project-bootstrap': ['settings', 'worldview', 'outline', 'characters', 'writing-style'],
  'chapter-analysis': ['settings', 'chapters', 'analysis', 'worldview', 'characters', 'relations', 'outline', 'versioning'],
  'inspiration-pack': ['settings', 'inspiration', 'chapters', 'worldview', 'characters', 'relations', 'outline', 'writing-style'],
  'chapter-summarize': ['settings', 'chapters', 'analysis'],
  'chapter-scene-plan': ['settings', 'chapters', 'outline'],
  'chapter-memo': ['settings', 'chapters', 'outline', 'characters', 'relations', 'worldview'],
  'chapter-audit': ['settings', 'chapters', 'analysis'],
  'plot-thread-detect': ['settings', 'chapters', 'analysis'],
  'chapter-repair': ['settings', 'chapters', 'worldview', 'characters', 'relations', 'outline', 'writing-style', 'project-skills'],
  'chapter-session-note': [],
  'story-deep-audit': ['settings', 'chapters', 'analysis', 'worldview', 'characters', 'relations', 'outline', 'project-skills'],
  'spiral-seed': ['settings', 'worldview', 'writing-style'],
  'spiral-expand': ['settings', 'worldview', 'characters', 'outline', 'writing-style'],
  'spiral-validate': ['settings', 'worldview', 'characters', 'outline'],
  'character-enhance': ['settings', 'characters', 'relations', 'worldview', 'writing-style'],
  'worldview-enhance': ['settings', 'worldview', 'characters', 'writing-style'],
  'outline-enhance': ['settings', 'outline', 'worldview', 'characters', 'writing-style'],
  'relation-enhance': ['settings', 'characters', 'relations', 'worldview', 'writing-style'],
  // 封面生成走独立图片通道，不经过 prompt capability 流程；此项仅为满足类型完整性。
  'cover-generate': ['settings']
}

/**
 * 获取指定任务类型的默认功能模块列表。
 *
 * @param task AI 任务名称
 * @returns 该任务默认启用的功能模块 ID 数组
 */
export function getDefaultCapabilities(task: AiTaskName): PromptCapabilityId[] {
  return TASK_DEFAULT_CAPABILITIES[task] ?? ['settings']
}

/**
 * 根据任务类型和功能模块列表，生成系统提示和用户规则的 PromptPair。
 *
 * @param task AI 任务名称
 * @param capabilities 本次启用的功能模块 ID 数组
 * @returns 包含 system 和 user 字段的 PromptPair
 */
export function buildCapabilityContext(task: AiTaskName, capabilities: PromptCapabilityId[]): PromptPair {
  const capabilityLines = capabilities.map((id) => {
    const definition = PROMPT_CAPABILITY_DEFINITIONS[id]
    return `- ${definition.label}：${definition.systemNote}`
  })
  const ruleLines = capabilities.map((id) => {
    const definition = PROMPT_CAPABILITY_DEFINITIONS[id]
    return `- ${definition.label}：${definition.userRule}`
  })
  return {
    system: [
      '你正在 CharacterArc 当前已实现的功能范围内工作。',
      `本次任务类型：${task}。`,
      '本次任务相关的已实现功能模块：',
      ...capabilityLines
    ].join('\n'),
    user: ['当前任务必须遵守以下功能适配规则：', ...ruleLines].join('\n')
  }
}
