import type { ContextProviderId, SurfaceDefinition, TurnSendRequest } from '@shared/assistant-runtime'

export type AssistantPlanIntent = 'chat' | 'audit' | 'correct' | 'ingest' | 'edit'
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

export function createRuntimePlan(params: {
  surface: SurfaceDefinition
  request: TurnSendRequest
}): AssistantRuntimePlan {
  const intent = resolveIntent(params.request, params.surface)
  const requiresBatching = shouldBatch(params.request.userMessage, intent)
  const isChapterSurface = params.surface.scope === 'chapter' || params.surface.scope === 'selection'
  const isEdit = intent === 'edit'

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
    guidance: buildGuidance(intent, requiresBatching)
  }
}

function resolveIntent(request: TurnSendRequest, surface: SurfaceDefinition): AssistantPlanIntent {
  const hint = request.intentHint ?? ''
  if (hint.endsWith(':audit')) return 'audit'
  if (hint.endsWith(':correct')) return 'correct'
  if (hint.endsWith(':ingest')) return 'ingest'
  if (surface.scope === 'chapter' || surface.scope === 'selection') return 'edit'

  const text = request.userMessage.replace(/\s+/g, '')
  if (/(审计|检查|矛盾|风险|OOC|ooc|连续性|伏笔)/.test(text)) return 'audit'
  if (/(修正|纠正|统一|跑偏|冲突|不一致)/.test(text)) return 'correct'
  if (/(录入|沉淀|整理成设定|保存|记忆)/.test(text)) return 'ingest'
  if (/(改写|润色|续写|扩写|重写|修改正文|章节)/.test(text)) return 'edit'
  return 'chat'
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
    '每批读取预算有限，读完后必须总结已确认事实、证据来源和下一步缺口。'
  ].join('\n')
}
