import type { ContextProviderId, SurfaceDefinition, TurnSendRequest } from '@shared/assistant-runtime'

export type AssistantPlanIntent = 'chat' | 'audit' | 'correct' | 'ingest' | 'edit' | 'entity-edit'
export type AssistantContextMode = 'minimal' | 'targeted' | 'chapter'

export interface AssistantRuntimePlan {
  intent: AssistantPlanIntent
  contextMode: AssistantContextMode
  contextProviders: ContextProviderId[]
  maxReadToolCalls: number
  maxSearchToolCalls: number
  maxStageChanges: number
  defaultReadLimit: number
  allowFullChapterRead: boolean
  allowFullProjectModuleRead: boolean
  requiresBatching: boolean
  continuationLabel: string
  continuationPrompt: string
  guidance: string
}

const BASE_CONTEXT: ContextProviderId[] = ['project-brief', 'recent-messages', 'skill-index']

/** 具体的章节修改方向词——命中说明用户已给出明确改法，无需追问。对齐 v1。 */
const CONCRETE_EDIT_DIRECTIONS = [
  '润色', '改写', '重写', '扩写', '续写', '精简', '压缩', '删除', '删掉', '删减',
  '拆长句', '拆句', '断句', '分段', '段落控', '段落控制', '调整段落', '调整节奏', '节奏',
  '开头', '开篇', '结尾', '对白', '对话', '描写', '心理', '动作', '氛围', '冲突',
  '悬念', '爽点', '疲软', '拖沓', '水分', '冗余', '机械', '模板感',
  '降低ai感', '去ai味', '按建议改', '按你说的改', '应用修改', '写回正文'
]

function hasConcreteChapterEditDirection(normalized: string): boolean {
  const lower = normalized.toLowerCase()
  return CONCRETE_EDIT_DIRECTIONS.some((kw) => lower.includes(kw))
}

/** 指向了章节但没给具体改法——需要提示助手先读取/追问，别直接动手改正文。对齐 v1。 */
function hasVagueChapterEditIntent(userMessage: string): boolean {
  const normalized = userMessage.replace(/\s+/g, '')
  const mentionsChapterTarget =
    /第[零一二两三四五六七八九十百\d]+章/.test(normalized) ||
    ['当前章节', '章节正文', '章节内容', '小说正文', '正文内容'].some((kw) => normalized.includes(kw))
  const asksToEdit = ['修改', '改一下', '调整', '优化', '处理'].some((kw) => normalized.includes(kw))
  return mentionsChapterTarget && asksToEdit && !hasConcreteChapterEditDirection(normalized)
}

/**
 * 模糊章节编辑意图提示（对齐 v1 buildGlobalChapterIntentHint）：
 * 用户指定了章节却没说怎么改时，提示助手先读取定位 + 追问方向，禁止直接暂存整章改写。
 * 仅在 global（非 chapter/selection surface）场景注入——章节场景本就以改写为主。
 */
function buildVagueEditNote(): string {
  return [
    '',
    '意图判读提示（仅供你结合用户原话复核，不替代你的判断）：',
    '- 初步意图：指定章节的修改意向，但缺少具体修改方向。',
    '- 期望动作：先用 list_chapters / read_chapter 定位并读取目标章节，然后给出简短诊断、可选修改方向或追问用户想改什么。',
    '- 禁止动作：不要调用 stage_chapter_edit 暂存整章改写，也不要直接输出整章改写稿。'
  ].join('\n')
}

export function createRuntimePlan(params: {
  surface: SurfaceDefinition
  request: TurnSendRequest
}): AssistantRuntimePlan {
  const intent = resolveIntent(params.request, params.surface)
  const requiresBatching = shouldBatch(params.request.userMessage, intent)
  const isChapterSurface = params.surface.scope === 'chapter' || params.surface.scope === 'selection'
  const isEdit = intent === 'edit'

  // 全局场景下检测"指向章节但方向模糊"的编辑意图，追加提示阻止直接改正文。
  // 章节 surface 本就以改写为主，不注入此提示。
  const vagueEditNote = !isChapterSurface && hasVagueChapterEditIntent(params.request.userMessage)
    ? buildVagueEditNote()
    : ''

  return {
    intent,
    contextMode: isChapterSurface ? 'chapter' : intent === 'chat' || intent === 'ingest' ? 'minimal' : 'targeted',
    contextProviders: resolveContextProviders(intent, params.surface),
    maxReadToolCalls: requiresBatching ? 5 : 4,
    maxSearchToolCalls: 2,
    maxStageChanges: intent === 'ingest' || intent === 'correct' || isEdit ? 5 : 2,
    defaultReadLimit: requiresBatching ? 5 : 3,
    allowFullChapterRead: isEdit || params.surface.scope === 'selection',
    allowFullProjectModuleRead: false,
    requiresBatching,
    continuationLabel: requiresBatching ? '继续分析下一批' : '继续补充证据',
    continuationPrompt: buildContinuationPrompt(intent),
    guidance: buildGuidance(intent, requiresBatching) + vagueEditNote
  }
}

function resolveIntent(request: TurnSendRequest, surface: SurfaceDefinition): AssistantPlanIntent {
  if (surface.scope === 'chapter' || surface.scope === 'selection') return 'edit'

  const text = request.userMessage.replace(/\s+/g, '')
  if (/(审计|检查|矛盾|风险|OOC|ooc|连续性|伏笔)/.test(text)) return 'audit'
  if (hasEntityEditIntent(text) || hasFrameworkAdviceRequest(text)) return 'entity-edit'
  if (/(修正|纠正|统一|跑偏|冲突|不一致)/.test(text)) return 'correct'
  if (/(录入|沉淀|整理成设定|保存|记忆)/.test(text)) return 'ingest'
  if (/(改写|润色|续写|扩写|重写|修改正文|章节)/.test(text)) return 'edit'
  const hint = request.intentHint ?? ''
  if (hint.endsWith(':audit')) return 'audit'
  if (hint.endsWith(':correct')) return 'correct'
  if (hint.endsWith(':ingest')) return 'ingest'
  return 'chat'
}

function hasEntityEditIntent(text: string): boolean {
  const mentionsEntity = /(设定|人设|人物|角色|组织|势力|世界观|大纲|线索)/.test(text)
  const asksToChange = /(修改|改一下|调整|优化|处理|重写|改写|重做|替换|补充|新增|删除|完全重写)/.test(text)
  return mentionsEntity && asksToChange
}

function hasFrameworkAdviceRequest(text: string): boolean {
  return /(已有|现有)?(故事)?框架.*(建议|方案|提案|怎么改)|根据.*(框架|故事框架).*(建议|方案|提案|怎么改)/.test(text)
}

function shouldBatch(text: string, intent: AssistantPlanIntent): boolean {
  const compact = text.replace(/\s+/g, '')
  if (intent === 'audit') return true
  if (/(全项目|整个项目|所有|全部|全书|完整审计|系统性)/.test(compact)) return true
  return compact.length > 180 && (intent === 'correct' || intent === 'ingest')
}

function resolveContextProviders(
  intent: AssistantPlanIntent,
  surface: SurfaceDefinition
): ContextProviderId[] {
  if (surface.scope === 'chapter' || surface.scope === 'selection') {
    return [...BASE_CONTEXT, 'current-chapter', 'constraints']
  }
  if (intent === 'audit') {
    return [...BASE_CONTEXT, 'constraints', 'plot-threads', 'workflow-documents']
  }
  if (intent === 'correct') {
    return [...BASE_CONTEXT, 'constraints', 'worldview', 'characters', 'outline']
  }
  if (intent === 'entity-edit') {
    return [...BASE_CONTEXT, 'constraints', 'worldview', 'characters', 'organizations', 'outline', 'plot-threads', 'workflow-documents']
  }
  if (intent === 'ingest') {
    return [...BASE_CONTEXT, 'constraints']
  }
  return BASE_CONTEXT
}

function buildContinuationPrompt(intent: AssistantPlanIntent): string {
  switch (intent) {
    case 'audit':
      return '继续上一轮审计，基于已确认的证据先处理下一批最高风险项。请先说明本批读取目标，再少量读取证据，最后给出阶段结论。'
    case 'correct':
      return '继续上一轮修正分析，基于已有证据补读下一批相关资料，只产出最小必要的暂存变更。'
    case 'ingest':
      return '继续上一轮录入整理，基于已有资料处理下一批内容，避免重复读取已经确认的证据。'
    case 'edit':
      return '继续上一轮章节处理，先复述已确认的修改方向，再读取必要片段并产出下一批可审阅修改。'
    case 'entity-edit':
      return '继续上一轮实体设定修改，先复述已确认的目标实体和改动方向，再基于项目框架补足方案并产出可审阅的暂存变更。'
    default:
      return '继续上一轮分析，先复述已确认事实，再按需补读少量证据并给出阶段结论。'
  }
}

function buildGuidance(intent: AssistantPlanIntent, requiresBatching: boolean): string {
  const batch = requiresBatching
    ? '本次按分批任务处理：先完成第一批证据读取与阶段结论，必要时提示用户继续下一批。'
    : '本次按轻量任务处理：证据足够后立即停止读取。'
  return [
    batch,
    `识别意图：${intent}。`,
    '默认先读索引/摘要；只有目标明确且必须核对原文时才读全文。',
    '每批读取预算有限，读完后必须总结已确认事实、证据来源和下一步缺口。',
    intent === 'entity-edit'
      ? '实体设定修改任务：若目标实体和改动方向已在当前或最近对话中明确，不要继续列问题拖延；基于项目框架补足合理细节，给出2-3个可选方案，或在用户已选方向时直接调用对应 stage_* 产出暂存变更。用户说"根据已有框架给建议"时，只围绕上一轮目标实体给建议，不要转成全项目审计。'
      : ''
  ].join('\n')
}
