import { buildRepairPrompt, buildTaskPrompt } from './aiPrompts'
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
  type OutlineResult,
  type ProjectBootstrapResult,
  type WorldviewResult
} from './aiShared'

export type { AiTaskPayload } from './aiShared'

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

/** 判断任务是否为结构化输出（需要返回 JSON），章节助理任务返回纯文本，不属于结构化任务 */
function isStructuredTask(task: AiTaskPayload): boolean {
  return task.task !== 'chapter-assistant'
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

/** 标准化单条灵感卡片，限制标签最多 4 个，为缺失字段填入默认值 */
function normalizeInspirationResult(result: AiTaskResult): InspirationResult {
  const entry = result as Partial<InspirationResult>
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

/**
 * 校验标准化后的结果是否满足基本可用性要求。
 * 不同任务的校验规则不同：如世界观要求 title + content 非空，角色要求 name + description 非空。
 */
function isTaskResultUsable(task: AiTaskPayload, result: AiTaskResult): boolean {
  if (task.task === 'chapter-assistant') {
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

  if (task.task === 'inspiration-pack') {
    const payload = result as InspirationPackResult
    return payload.entries.length > 0
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
  if (task.task === 'chapter-assistant') {
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
    case 'chapter-analysis':
      return normalizeChapterAnalysisResult(parsed)
    case 'inspiration-pack':
      return normalizeInspirationPackResult(parsed)
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
  const repairedText = await requestAiText(settings, buildRepairPrompt(task, rawText), task)
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
  if (task.task !== 'chapter-assistant') {
    throw new Error('当前流式输出仅支持章节创作助理。')
  }

  const settings = normalizeSettings(task.settings)
  validateSettings(settings)
  const prompt = buildTaskPrompt(task)
  const rawText = await requestAiTextStream(settings, prompt, handlers, signal, task)
  return normalizeAssistantText(rawText)
}
