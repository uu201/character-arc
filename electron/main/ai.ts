import { buildRepairPrompt, buildTaskPrompt } from './aiPrompts'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  requestAiText,
  requestAiTextStream
} from './aiTransport'
import {
  normalizeSettings,
  validateSettings,
  type AiStreamHandlers,
  type ChapterAnalysisResult,
  type AiTaskPayload,
  type AiTaskResult,
  type AppSettings,
  type ChapterAssistantResult,
  type CharacterResult,
  type InspirationPackResult,
  type InspirationResult,
  type OutlineBatchResult,
  type OutlineResult,
  type PlotThreadDetectEntry,
  type PlotThreadDetectResult,
  type ProjectBootstrapResult,
  type ReferenceStyleChunkResult,
  type ReferenceStyleAnalysisResult,
  type WorkflowDocumentsResult,
  type WorldviewResult
} from './aiShared'

export type { AiTaskPayload } from './aiShared'

const AI_PROMPT_LOG_DIR = join(process.cwd(), '.logs')
const AI_PROMPT_LOG_FILE = join(AI_PROMPT_LOG_DIR, 'ai-prompts.log')

async function writePromptLogFile(content: string): Promise<void> {
  try {
    await mkdir(AI_PROMPT_LOG_DIR, { recursive: true })
    await appendFile(AI_PROMPT_LOG_FILE, `${content}\n`, 'utf8')
  } catch (error) {
    console.error('[ai] failed to write prompt log file:', error)
  }
}

function logPrompt(label: string, settings: AppSettings, prompt: { system: string; user: string }, task?: AiTaskPayload): void {
  const taskLabel = task?.task ?? 'unknown'
  const provider = settings.provider || 'unknown'
  const model = settings.model || 'unknown'
  const timestamp = new Date().toISOString()
  const content = [
    '',
    `===== AI 提示词 ${label} =====`,
    `时间: ${timestamp}`,
    `任务: ${taskLabel}`,
    `提供者: ${provider}`,
    `模型: ${model}`,
    '--- SYSTEM ---',
    prompt.system || '',
    '--- USER ---',
    prompt.user || '',
    `===== END AI 提示词 ${label} =====`
  ].join('\n')

  console.log(`[ai] prompt logged: ${label} | task=${taskLabel} | provider=${provider} | model=${model} | file=${AI_PROMPT_LOG_FILE}`)
  void writePromptLogFile(content)
}

/**
 * 从 AI 返回的文本中提取 JSON 对象。
 * 支持处理被 ```json 代码块包裹的情况，以及文本前后有多余内容的情况。
 */
function extractJsonObject(text: string): AiTaskResult {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  const raw = fenced?.[1] ?? text
  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  const jsonSlice = firstBrace >= 0 && lastBrace >= 0 ? raw.slice(firstBrace, lastBrace + 1) : raw
  return JSON.parse(jsonSlice) as AiTaskResult
}

/** 判断任务是否为结构化输出（需要返回 JSON），章节助理和摘要任务返回纯文本，不属于结构化任务 */
function isStructuredTask(task: AiTaskPayload): boolean {
  return task.task !== 'chapter-assistant' && task.task !== 'chapter-first-draft' && task.task !== 'chapter-summarize'
}

/**
 * 清理章节助理返回的纯文本。
 * 移除可能残留的 Markdown 代码块标记，返回干净的文本内容。
 */
function normalizeAssistantText(text: string): ChapterAssistantResult {
  const cleaned = text
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .trim()

  return {
    content: cleaned
  }
}

/** 标准化世界观设定结果，为缺失字段填入默认值 */
function normalizeWorldviewResult(result: AiTaskResult): WorldviewResult {
  const entry = result as Partial<WorldviewResult>
  return {
    type: entry.type?.trim() || '地理',
    title: entry.title?.trim() || '新世界观词条',
    content: entry.content?.trim() || 'AI 未返回有效内容'
  }
}

/** 标准化角色卡结果，限制标签最多 4 个，为缺失字段填入默认值 */
function normalizeCharacterResult(result: AiTaskResult): CharacterResult {
  const character = result as Partial<CharacterResult>
  const tags = Array.isArray(character.tags)
    ? character.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 4)
    : []

  return {
    name: character.name?.trim() || '新角色',
    role: character.role?.trim() || '待设定',
    description: character.description?.trim() || 'AI 未返回有效角色描述',
    tags: tags.length ? tags : ['待完善']
  }
}

/** 标准化大纲节点结果，为缺失字段填入默认的章节标题和字数格式 */
function normalizeOutlineResult(result: AiTaskResult): OutlineResult {
  const item = result as Partial<OutlineResult>
  return {
    title: item.title?.trim() || '第1章：新剧情节点',
    wordTarget: item.wordTarget?.trim() || '预估 3000字',
    conflict: item.conflict?.trim() || '新的冲突正在酝酿。',
    summary: item.summary?.trim() || 'AI 未返回有效剧情摘要'
  }
}

/** 标准化批量大纲节点结果，限制最多 5 条 */
function normalizeOutlineBatchResult(result: AiTaskResult): OutlineBatchResult {
  const payload = result as Partial<OutlineBatchResult>
  const entries = Array.isArray(payload.entries)
    ? payload.entries.slice(0, 5).map((entry) => normalizeOutlineResult(entry as AiTaskResult))
    : []

  return {
    entries
  }
}

/** 标准化项目初始化结果，限制世界观和大纲各最多 3 条，并逐条标准化 */
function normalizeProjectBootstrapResult(result: AiTaskResult): ProjectBootstrapResult {
  const payload = result as Partial<ProjectBootstrapResult>
  const worldviewEntries = Array.isArray(payload.worldviewEntries)
    ? payload.worldviewEntries.slice(0, 3).map((entry) => normalizeWorldviewResult(entry as AiTaskResult))
    : []
  const outlineItems = Array.isArray(payload.outlineItems)
    ? payload.outlineItems.slice(0, 3).map((item) => normalizeOutlineResult(item as AiTaskResult))
    : []

  return {
    worldviewEntries,
    outlineItems
  }
}

function normalizeWorkflowDocumentsResult(result: AiTaskResult): WorkflowDocumentsResult {
  const payload = result as Partial<WorkflowDocumentsResult>
  const normalizeText = (value: unknown, fallback: string) => String(value ?? '').trim() || fallback

  return {
    task_plan: normalizeText(payload.task_plan, '# 任务计划\n\n- 待补充。'),
    findings: normalizeText(payload.findings, '# 发现记录\n\n- 待补充。'),
    progress: normalizeText(payload.progress, '# 进度记录\n\n- 待补充。'),
    current_status: normalizeText(payload.current_status, '# 当前状态卡\n\n- 待补充。'),
    novel_setting: normalizeText(payload.novel_setting, '# 小说设定\n\n- 待补充。'),
    character_relationships: normalizeText(payload.character_relationships, '# 人物关系盘\n\n- 待补充。'),
    pending_hooks: normalizeText(payload.pending_hooks, '# 待回收钩子\n\n- 待补充。'),
    resource_ledger: normalizeText(payload.resource_ledger, '# 资源账本\n\n- 待补充。')
  }
}

/**
 * 标准化章节分析结果。
 * 内部辅助函数 toList 负责将数组字段标准化：限制最多 5 项，空数组时填入兜底文案。
 */
function normalizeChapterAnalysisResult(result: AiTaskResult): ChapterAnalysisResult {
  const payload = result as Partial<ChapterAnalysisResult>
  const toList = (value: unknown, fallback: string[]): string[] => {
    if (!Array.isArray(value)) {
      return fallback
    }

    const normalized = value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 5)

    return normalized.length ? normalized : fallback
  }

  return {
    overview: payload.overview?.trim() || '这一章已经形成基础场景与推进，但还需要进一步打磨节奏和信息聚焦。',
    pacing: payload.pacing?.trim() || '节奏判断暂不稳定，建议重新检查铺垫与推进的比例。',
    tension: payload.tension?.trim() || '张力表达仍有提升空间，需要强化冲突触发点和情绪落点。',
    continuity: payload.continuity?.trim() || '连续性基本成立，但还需要核对角色动机、设定引用和上下章衔接。',
    highlights: toList(payload.highlights, ['章节已经建立了基本情境，可以继续沿当前方向深化。']),
    risks: toList(payload.risks, ['当前分析未提取到明确风险，建议人工复核逻辑与节奏。']),
    revisionActions: toList(payload.revisionActions, ['先挑一段关键正文，按冲突、节奏和画面感三个维度逐句重写。'])
  }
}

function normalizeReferenceStyleAnalysisResult(result: AiTaskResult): ReferenceStyleAnalysisResult {
  const payload = result as Partial<ReferenceStyleAnalysisResult>
  const toList = (value: unknown, fallback: string[]): string[] => {
    if (!Array.isArray(value)) {
      return fallback
    }

    const normalized = value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 6)

    return normalized.length ? normalized : fallback
  }

  return {
    overview: payload.overview?.trim() || '该参考作品的风格重在稳定推进、明确反馈和鲜明的场景驱动。',
    sentenceStyle: payload.sentenceStyle?.trim() || '句式偏直给，叙述密度中等，以动作和结果优先。',
    dialogueRatio: payload.dialogueRatio?.trim() || '对白占比适中，主要承担推进信息和制造张力。',
    pacingControl: payload.pacingControl?.trim() || '节奏以短回合冲突推进，尽量避免长时间停滞解释。',
    emotionExpression: payload.emotionExpression?.trim() || '情绪表达偏外显，通过动作、停顿和措辞变化落地。',
    narrativePerspective: payload.narrativePerspective?.trim() || '叙事视角相对稳定，画面切换服务冲突与反馈。',
    styleRules: toList(payload.styleRules, ['保持句子干净直接，每段都要有信息推进或关系变化。']),
    plotOutline: payload.plotOutline?.trim() || '故事骨架围绕主角目标、外部压迫和持续兑现的阶段收益展开。',
    reusableStylePrompt:
      payload.reusableStylePrompt?.trim() ||
      '用简洁句式、较高对白驱动和快反馈节奏写作，少做空泛描写，多让冲突在场景里直接落地。',
    avoidRules: toList(payload.avoidRules, ['不要照搬原作的人名、专有设定、组织结构和具体桥段顺序。'])
  }
}

function normalizeReferenceStyleChunkResult(result: AiTaskResult): ReferenceStyleChunkResult {
  const payload = result as Partial<ReferenceStyleChunkResult>
  const toList = (value: unknown, fallback: string[]): string[] => {
    if (!Array.isArray(value)) {
      return fallback
    }

    const normalized = value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 4)

    return normalized.length ? normalized : fallback
  }

  return {
    overview: payload.overview?.trim() || '这一段以稳定推进和局部反馈为主，能代表原作的一部分风格倾向。',
    sentenceStyle: payload.sentenceStyle?.trim() || '句式偏直接，叙述重点落在动作与结果。',
    dialogueRatio: payload.dialogueRatio?.trim() || '对白承担推进信息和制造对抗的职责。',
    pacingControl: payload.pacingControl?.trim() || '节奏以短回合推进，少停留在纯说明。',
    emotionExpression: payload.emotionExpression?.trim() || '情绪通过动作、停顿和人物反应外化。',
    plotFunction: payload.plotFunction?.trim() || '该段桥段主要承担冲突抬升或信息兑现。',
    styleRules: toList(payload.styleRules, ['保持信息推进和场景反馈同步，不做空转描写。'])
  }
}

/** 标准化单条灵感卡片，限制标签最多 4 个，为缺失字段填入默认值 */
function normalizeInspirationResult(result: AiTaskResult): InspirationResult {  const entry = result as Partial<InspirationResult>
  const tags = Array.isArray(entry.tags)
    ? entry.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 4)
    : []

  return {
    type: entry.type?.trim() || '场景火花',
    title: entry.title?.trim() || '新的灵感切口',
    content: entry.content?.trim() || 'AI 未返回有效灵感内容',
    tags: tags.length ? tags : ['待扩写', '灵感']
  }
}

/** 标准化灵感卡片组，限制最多 6 条灵感卡片，并逐条标准化 */
function normalizeInspirationPackResult(result: AiTaskResult): InspirationPackResult {
  const payload = result as Partial<InspirationPackResult>
  const entries = Array.isArray(payload.entries)
    ? payload.entries.slice(0, 6).map((entry) => normalizeInspirationResult(entry as AiTaskResult))
    : []

  return {
    entries
  }
}

/** 标准化章节伏笔识别结果，限制最多 6 条，每条限制标签最多 3 个 */
function normalizePlotThreadDetectResult(result: AiTaskResult): PlotThreadDetectResult {
  const payload = result as Partial<PlotThreadDetectResult>
  const entries = Array.isArray(payload.entries)
    ? payload.entries.slice(0, 6).map((entry) => {
        const e = entry as Partial<PlotThreadDetectEntry>
        const tags = Array.isArray(e.tags)
          ? e.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 3)
          : []
        return {
          title: e.title?.trim() || '未命名伏笔',
          description: e.description?.trim() || '暂无描述',
          tags
        }
      })
    : []

  return { entries }
}

/**
 * 校验标准化后的结果是否满足基本可用性要求。
 * 不同任务的校验规则不同：如世界观要求 title + content 非空，角色要求 name + description 非空。
 */
function isTaskResultUsable(task: AiTaskPayload, result: AiTaskResult): boolean {
  if (task.task === 'chapter-assistant' || task.task === 'chapter-first-draft') {
    return Boolean((result as ChapterAssistantResult).content?.trim())
  }

  if (task.task === 'project-bootstrap') {
    const payload = result as ProjectBootstrapResult
    return payload.worldviewEntries.length > 0 && payload.outlineItems.length > 0
  }

  if (task.task === 'chapter-analysis') {
    const analysis = result as ChapterAnalysisResult
    return Boolean(
      analysis.overview.trim() &&
        analysis.pacing.trim() &&
        analysis.tension.trim() &&
        analysis.continuity.trim() &&
        analysis.highlights.length > 0 &&
        analysis.risks.length > 0 &&
        analysis.revisionActions.length > 0
    )
  }

  if (task.task === 'reference-style-analysis') {
    const analysis = result as ReferenceStyleAnalysisResult
    return Boolean(
      analysis.overview.trim() &&
        analysis.sentenceStyle.trim() &&
        analysis.dialogueRatio.trim() &&
        analysis.pacingControl.trim() &&
        analysis.emotionExpression.trim() &&
        analysis.narrativePerspective.trim() &&
        analysis.styleRules.length > 0 &&
        analysis.plotOutline.trim() &&
        analysis.reusableStylePrompt.trim() &&
        analysis.avoidRules.length > 0
    )
  }

  if (task.task === 'reference-style-chunk') {
    const analysis = result as ReferenceStyleChunkResult
    return Boolean(
      analysis.overview.trim() &&
        analysis.sentenceStyle.trim() &&
        analysis.dialogueRatio.trim() &&
        analysis.pacingControl.trim() &&
        analysis.emotionExpression.trim() &&
        analysis.plotFunction.trim() &&
        analysis.styleRules.length > 0
    )
  }

  if (task.task === 'inspiration-pack') {
    const payload = result as InspirationPackResult
    return payload.entries.length > 0
  }

  if (task.task === 'plot-thread-detect') {
    const payload = result as PlotThreadDetectResult
    return payload.entries.length > 0
  }

  if (task.task === 'outline-batch' || task.task === 'outline-chain') {
    const payload = result as OutlineBatchResult
    return payload.entries.length > 0
  }

  if (task.task === 'workflow-documents') {
    const payload = result as WorkflowDocumentsResult
    return Boolean(
      payload.task_plan.trim() &&
      payload.findings.trim() &&
      payload.progress.trim() &&
      payload.current_status.trim() &&
      payload.novel_setting.trim() &&
      payload.character_relationships.trim() &&
      payload.pending_hooks.trim() &&
      payload.resource_ledger.trim()
    )
  }

  if (task.task === 'worldview-entry') {
    const entry = result as WorldviewResult
    return Boolean(entry.title.trim() && entry.content.trim())
  }

  if (task.task === 'character-card') {
    const character = result as CharacterResult
    return Boolean(character.name.trim() && character.description.trim())
  }

  const outline = result as OutlineResult
  return Boolean(outline.title.trim() && outline.summary.trim())
}

/**
 * 将 AI 返回的原始文本解析并标准化为对应任务类型的结果对象。
 * 章节助理任务直接处理纯文本，其他任务先提取 JSON 再按类型标准化。
 */
function normalizeTaskResult(task: AiTaskPayload, rawText: string): AiTaskResult {
  if (task.task === 'chapter-assistant' || task.task === 'chapter-first-draft' || task.task === 'chapter-summarize') {
    return normalizeAssistantText(rawText)
  }

  const parsed = extractJsonObject(rawText)

  switch (task.task) {
    case 'worldview-entry':
      return normalizeWorldviewResult(parsed)
    case 'character-card':
      return normalizeCharacterResult(parsed)
    case 'project-bootstrap':
      return normalizeProjectBootstrapResult(parsed)
    case 'workflow-documents':
      return normalizeWorkflowDocumentsResult(parsed)
    case 'outline-batch':
    case 'outline-chain':
      return normalizeOutlineBatchResult(parsed)
    case 'chapter-analysis':
      return normalizeChapterAnalysisResult(parsed)
    case 'reference-style-chunk':
      return normalizeReferenceStyleChunkResult(parsed)
    case 'reference-style-analysis':
      return normalizeReferenceStyleAnalysisResult(parsed)
    case 'inspiration-pack':
      return normalizeInspirationPackResult(parsed)
    case 'plot-thread-detect':
      return normalizePlotThreadDetectResult(parsed)
    case 'outline-item':
    default:
      return normalizeOutlineResult(parsed)
  }
}

/**
 * 解析并验证 AI 任务结果，失败时尝试一次修复。
 * 先尝试直接解析原始文本；若结果不可用且为结构化任务，则用修复提示词让 AI 重新生成合法 JSON。
 * 修复后仍不合格则抛出错误。
 */
async function resolveTaskResult(task: AiTaskPayload, settings: AppSettings, rawText: string): Promise<AiTaskResult> {
  try {
    const normalized = normalizeTaskResult(task, rawText)
    if (isTaskResultUsable(task, normalized)) {
      return normalized
    }
  } catch {
    // 解析或校验失败，进入修复流程
  }

  // 章节助理等非结构化任务不走修复流程，直接返回
  if (!isStructuredTask(task)) {
    return normalizeTaskResult(task, rawText)
  }

  // 用修复提示词让 AI 重新生成合法 JSON
  const repairPrompt = buildRepairPrompt(task, rawText)
  logPrompt('REPAIR', settings, repairPrompt, task)
  const repairedText = await requestAiText(settings, repairPrompt, task)
  const repairedResult = normalizeTaskResult(task, repairedText)

  if (!isTaskResultUsable(task, repairedResult)) {
    throw new Error('AI 返回的结构化结果不完整，请稍后重试或调整提示词。')
  }

  return repairedResult
}

/** 测试 AI 连接是否可用，发送一条极简探测请求验证鉴权和网络通畅 */
export async function testAiConnection(rawSettings: AppSettings): Promise<{ provider: string; model: string }> {
  const settings = normalizeSettings(rawSettings)
  validateSettings(settings)

  const probePrompt = {
    system: 'You are a connectivity probe. Reply with CONNECTED only.',
    user: 'Return CONNECTED'
  }

  logPrompt('TEST', settings, probePrompt)
  const text = await requestAiText(settings, probePrompt)

  if (!text.trim()) {
    throw new Error('模型连接成功，但没有返回可读内容。')
  }

  return {
    provider: settings.provider,
    model: settings.model
  }
}

/**
 * 执行一次非流式 AI 任务。
 * 完整流程：标准化设置 → 校验 → 构建提示词 → 发送请求 → 解析/修复结果。
 */
export async function generateAiTask(task: AiTaskPayload): Promise<AiTaskResult> {
  const settings = normalizeSettings(task.settings)
  validateSettings(settings)
  const prompt = buildTaskPrompt(task)
  logPrompt('REQUEST', settings, prompt, task)
  const rawText = await requestAiText(settings, prompt, task)
  return resolveTaskResult(task, settings, rawText)
}

/**
 * 执行一次流式 AI 任务（仅支持章节创作助理）。
 * 通过 handlers.onTextDelta 实时推送增量文本到 UI，最终返回标准化的 ChapterAssistantResult。
 */
export async function streamAiTask(
  task: AiTaskPayload,
  handlers: AiStreamHandlers,
  signal: AbortSignal
): Promise<ChapterAssistantResult> {
  if (task.task !== 'chapter-assistant' && task.task !== 'chapter-first-draft') {
    throw new Error('当前流式输出仅支持章节创作助理和章节初稿生成。')
  }

  const settings = normalizeSettings(task.settings)
  validateSettings(settings)
  const prompt = buildTaskPrompt(task)
  logPrompt('STREAM', settings, prompt, task)
  const rawText = await requestAiTextStream(settings, prompt, handlers, signal, task)
  return normalizeAssistantText(rawText)
}
