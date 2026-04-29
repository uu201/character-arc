type ProviderName = 'openai' | 'deepseek' | 'anthropic' | 'ollama' | string

type AppSettings = {
  provider: string
  model: string
  apiKey: string
  baseUrl: string
}

type AiTaskName = 'worldview-entry' | 'character-card' | 'outline-item' | 'chapter-assistant' | 'project-bootstrap'

export type AiTaskPayload = {
  task: AiTaskName
  settings: AppSettings
  context: Record<string, unknown>
}

type WorldviewResult = {
  type: string
  title: string
  content: string
}

type CharacterResult = {
  name: string
  role: string
  description: string
  tags: string[]
}

type OutlineResult = {
  title: string
  wordTarget: string
  conflict: string
  summary: string
}

type ChapterAssistantResult = {
  content: string
}

type ProjectBootstrapResult = {
  worldviewEntries: WorldviewResult[]
  outlineItems: OutlineResult[]
}

type AiTaskResult = WorldviewResult | CharacterResult | OutlineResult | ChapterAssistantResult | ProjectBootstrapResult
type PromptPair = { system: string; user: string }
type AiStreamHandlers = {
  onTextDelta: (delta: string) => void
}

const AI_REQUEST_TIMEOUT_MS = 60_000

function resolveProviderDefaults(provider: ProviderName): { baseUrl: string; model: string } {
  switch (provider) {
    case 'openai':
      return { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
    case 'deepseek':
      return { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
    case 'anthropic':
      return { baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest' }
    case 'ollama':
      return { baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2' }
    default:
      return { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
  }
}

function normalizeSettings(settings: AppSettings): AppSettings {
  const provider = settings.provider?.trim().toLowerCase() || 'deepseek'
  const defaults = resolveProviderDefaults(provider)
  return {
    provider,
    model: settings.model?.trim() || defaults.model,
    apiKey: settings.apiKey?.trim() || '',
    baseUrl: settings.baseUrl?.trim() || defaults.baseUrl
  }
}

function isLocalBaseUrl(baseUrl: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(baseUrl.trim())
}

function requiresApiKey(settings: AppSettings): boolean {
  if (settings.provider === 'ollama') {
    return false
  }

  // Some self-hosted OpenAI-compatible gateways run locally without auth.
  return !isLocalBaseUrl(settings.baseUrl)
}

function validateSettings(settings: AppSettings): void {
  if (!settings.model.trim()) {
    throw new Error('请先填写模型名称。')
  }

  if (!settings.baseUrl.trim()) {
    throw new Error('请先填写 Base URL。')
  }

  if (requiresApiKey(settings) && !settings.apiKey.trim()) {
    throw new Error('当前模型供应商需要 API Key，请先在设置页填写。')
  }
}

function buildTaskPrompt(task: AiTaskPayload): PromptPair {
  const { context } = task

  if (task.task === 'worldview-entry') {
    return {
      system:
        '你是小说世界观设定助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 type、title、content。',
      user: `基于以下上下文，为当前小说项目新增一条世界观设定。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有世界观：${JSON.stringify(context.worldviewTitles ?? [])}\n\n要求：\n1. 返回一条不与已有条目重复的新设定\n2. type 必须是 地理 / 法则 / 物种 / 势力 / 历史 之一\n3. title 要简洁\n4. content 用中文完整描述，80 到 180 字\n\n返回格式：{"type":"","title":"","content":""}`
    }
  }

  if (task.task === 'character-card') {
    return {
      system:
        '你是小说角色设定助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 name、role、description、tags。',
      user: `基于以下上下文，为当前小说项目生成一名新角色。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有角色：${JSON.stringify(context.characterNames ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n\n要求：\n1. 不与已有角色重名\n2. role 用短语概括角色定位\n3. description 用中文完整描述，80 到 160 字\n4. tags 返回 2 到 4 个简短标签数组\n\n返回格式：{"name":"","role":"","description":"","tags":["",""]}`
    }
  }

  if (task.task === 'project-bootstrap') {
    return {
      system:
        '你是小说项目初始化助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 worldviewEntries、outlineItems。',
      user: `请基于以下信息，为小说项目生成首批世界观设定和剧情大纲。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n目标字数：${String(context.projectWordTarget ?? '')}\n核心点子：${String(context.projectPremise ?? '')}\n\n要求：\n1. worldviewEntries 返回 3 条设定，每条都包含 type、title、content\n2. worldviewEntries 的 type 必须是 地理 / 法则 / 物种 / 势力 / 历史 之一\n3. outlineItems 返回 3 条章节大纲，每条都包含 title、wordTarget、conflict、summary\n4. wordTarget 使用“预估 xxxx字”格式\n5. 所有内容使用中文，紧贴题材和核心点子，不要重复\n\n返回格式：{"worldviewEntries":[{"type":"","title":"","content":""}],"outlineItems":[{"title":"","wordTarget":"","conflict":"","summary":""}]}`
    }
  }

  if (task.task === 'chapter-assistant') {
    const worldviewEntries = Array.isArray(context.worldviewEntries)
      ? context.worldviewEntries
          .slice(0, 8)
          .map((entry) => `${String((entry as Record<string, unknown>).title ?? '')}：${String((entry as Record<string, unknown>).content ?? '')}`)
          .join('\n')
      : ''
    const characters = Array.isArray(context.characters)
      ? context.characters
          .slice(0, 8)
          .map((character) => `${String((character as Record<string, unknown>).name ?? '')} / ${String((character as Record<string, unknown>).role ?? '')}：${String((character as Record<string, unknown>).description ?? '')}`)
          .join('\n')
      : ''
    const outlineItems = Array.isArray(context.outlineItems)
      ? context.outlineItems
          .slice(0, 6)
          .map((item) => `${String((item as Record<string, unknown>).title ?? '')}：${String((item as Record<string, unknown>).summary ?? '')}`)
          .join('\n')
      : ''
    const relatedChapters = Array.isArray(context.relatedChapters)
      ? context.relatedChapters
          .slice(0, 2)
          .map((item, index) => {
            const record = item as Record<string, unknown>
            return `关联章节${index + 1}：${String(record.title ?? '')}\n摘要：${String(record.summary ?? '')}\n正文预览：${String(record.preview ?? '')}`
          })
          .join('\n\n')
      : ''
    const recentMessages = Array.isArray(context.recentMessages)
      ? context.recentMessages
          .slice(-4)
          .map((item) => {
            const record = item as Record<string, unknown>
            const role = String(record.role ?? '') === 'assistant' ? '助理' : '用户'
            return `${role}：${String(record.content ?? '')}`
          })
          .join('\n')
      : ''
    const selectedText = String(context.selectedText ?? '').trim()
    const quickAction = String(context.quickAction ?? '自由提问')
    const responseMode = String(context.responseMode ?? 'freeform')
    const responseLength = String(context.responseLength ?? 'medium')
    const modeInstruction = resolveChapterAssistantModeInstruction(responseMode)
    const lengthInstruction = resolveChapterAssistantLengthInstruction(responseLength)
    const quickActionInstruction = resolveChapterAssistantQuickActionInstruction(quickAction)

    return {
      system:
        '你是 CharacterArc 的小说创作助理。请基于当前项目和章节上下文，用中文直接输出可供作者使用的正文、润色稿、分析或建议。不要输出 Markdown 标题，不要解释你是 AI，也不要返回 JSON。',
      user: `请处理当前写作请求，并优先给出可直接使用的结果。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节状态：${String(context.chapterStatus ?? '')}\n当前章节预估字数：${String(context.chapterWordTarget ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n\n当前选中文本：\n${selectedText || '暂无'}\n\n相邻章节参考：\n${relatedChapters || '暂无'}\n\n相关世界观：\n${worldviewEntries || '暂无'}\n\n相关角色：\n${characters || '暂无'}\n\n相关大纲：\n${outlineItems || '暂无'}\n\n最近对话：\n${recentMessages || '暂无'}\n\n快捷动作：${quickAction}\n输出模式：${responseMode}\n输出长度：${responseLength}\n用户请求：${String(context.userPrompt ?? '')}\n\n要求：\n1. 回答要紧贴当前章节上下文\n2. 如果请求是润色、续写、描写，请优先输出可直接插入正文的内容\n3. 如果提供了当前选中文本，并且请求与润色、改写、分析有关，请优先只围绕这段文本处理，不要重写整章\n4. 如果请求是分析或建议，请给出清晰可执行的建议\n5. 避免与最近几条对话重复表达，除非用户明确要求重写\n6. 如果是续写，请尽量与相邻章节和当前分卷的情绪、节奏保持连续\n7. ${modeInstruction}\n8. ${lengthInstruction}\n9. ${quickActionInstruction}`
    }
  }

  return {
    system:
      '你是小说剧情大纲助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 title、wordTarget、conflict、summary。',
    user: `基于以下上下文，为当前小说项目补充一个新的章节大纲节点。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节预估字数：${String(context.chapterWordTarget ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n已有大纲：${JSON.stringify(context.outlineTitles ?? [])}\n当前分卷已有节点：${JSON.stringify(context.currentVolumeOutlineItems ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n角色参考：${JSON.stringify(context.characters ?? [])}\n补充要求：${String(context.userPrompt ?? '')}\n\n要求：\n1. title 为新的章节标题，并体现与当前章节的承接关系\n2. wordTarget 使用“预估 xxxx字”格式\n3. conflict 用一句话概括下一章的核心冲突\n4. summary 用中文描述剧情推进，80 到 180 字\n5. 与当前分卷目标、已有大纲和当前章节情绪保持连续，不要重复已有节点\n\n返回格式：{"title":"","wordTarget":"","conflict":"","summary":""}`
  }
}

function extractJsonObject(text: string): AiTaskResult {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  const raw = fenced?.[1] ?? text
  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  const jsonSlice = firstBrace >= 0 && lastBrace >= 0 ? raw.slice(firstBrace, lastBrace + 1) : raw
  return JSON.parse(jsonSlice) as AiTaskResult
}

function resolveChapterAssistantModeInstruction(mode: string): string {
  switch (mode) {
    case 'polish':
      return '当前模式是“润色”。请尽量直接输出可替换原文的润色结果，减少分析。'
    case 'continue':
      return '当前模式是“续写”。请紧接现有正文自然续写，保持语气、节奏和剧情方向一致。'
    case 'suggest':
      return '当前模式是“剧情建议”。请给出 3 到 5 条具体建议，按可执行性优先排序。'
    case 'reference':
      return '当前模式是“设定查阅”。请优先提炼与当前章节最相关的设定、角色和风险点。'
    default:
      return '当前模式是“自由提问”。请根据用户请求选择最合适的回答形式。'
  }
}

function resolveChapterAssistantLengthInstruction(length: string): string {
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

function resolveChapterAssistantQuickActionInstruction(quickAction: string): string {
  switch (quickAction) {
    case '章节标题':
      return '如果当前任务是生成章节标题，只输出一个最终标题，不要解释、不要分点、不要加书名号；若与通用长度要求冲突，以本条为准。'
    case '章节摘要':
      return '如果当前任务是生成章节摘要，请输出一段可直接作为本章定位的简洁摘要，不要分点，不要额外说明。'
    case '润色选中':
      return '如果当前任务是润色选中内容，请只输出润色后的最终文本，紧贴当前选中文本，不要解释，不要分点。'
    case '下一章建议':
      return '如果当前任务是下一章建议，请输出 3 条具体方案，每条都要体现推进方向、冲突和悬念。'
    default:
      return '如果快捷动作已经明确输出形态，请优先遵循该动作要求。'
  }
}

function buildRepairPrompt(task: AiTaskPayload, brokenText: string): PromptPair {
  const originalPrompt = buildTaskPrompt(task)

  return {
    system:
      '你是 JSON 输出修复助手。你只负责把已有回复整理成合法 JSON，不能输出 Markdown、解释或额外文本。',
    user: `请根据原始任务要求，把下面这段回复修正为严格合法的 JSON。\n\n原始系统要求：\n${originalPrompt.system}\n\n原始用户要求：\n${originalPrompt.user}\n\n模型原始回复：\n${brokenText}\n\n要求：\n1. 只返回一个合法 JSON 对象\n2. 不要补充与任务无关的解释\n3. 缺失字段时，根据原始任务要求补齐最合理的内容`
  }
}

function isStructuredTask(task: AiTaskPayload): boolean {
  return task.task !== 'chapter-assistant'
}

function normalizeAssistantText(text: string): ChapterAssistantResult {
  const cleaned = text
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .trim()

  return {
    content: cleaned
  }
}

function normalizeWorldviewResult(result: AiTaskResult): WorldviewResult {
  const entry = result as Partial<WorldviewResult>
  return {
    type: entry.type?.trim() || '地理',
    title: entry.title?.trim() || '新世界观词条',
    content: entry.content?.trim() || 'AI 未返回有效内容'
  }
}

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

function normalizeOutlineResult(result: AiTaskResult): OutlineResult {
  const item = result as Partial<OutlineResult>
  return {
    title: item.title?.trim() || '第1章：新剧情节点',
    wordTarget: item.wordTarget?.trim() || '预估 3000字',
    conflict: item.conflict?.trim() || '新的冲突正在酝酿。',
    summary: item.summary?.trim() || 'AI 未返回有效剧情摘要'
  }
}

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

function isTaskResultUsable(task: AiTaskPayload, result: AiTaskResult): boolean {
  if (task.task === 'chapter-assistant') {
    return Boolean((result as ChapterAssistantResult).content?.trim())
  }

  if (task.task === 'project-bootstrap') {
    const payload = result as ProjectBootstrapResult
    return payload.worldviewEntries.length > 0 && payload.outlineItems.length > 0
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
    case 'outline-item':
    default:
      return normalizeOutlineResult(parsed)
  }
}

async function readErrorMessage(response: Response, fallbackLabel: string): Promise<string> {
  const fallback = `${fallbackLabel} 请求失败：${response.status} ${response.statusText}`

  try {
    const data = (await response.json()) as Record<string, unknown>
    const error = (data.error ?? data) as Record<string, unknown>
    const message =
      (typeof error.message === 'string' && error.message) ||
      (typeof error.error === 'string' && error.error) ||
      (typeof data.message === 'string' && data.message)

    return message ? `${fallbackLabel} 请求失败：${message}` : fallback
  } catch {
    return fallback
  }
}

async function performAiRequest(
  url: string,
  init: RequestInit,
  providerLabel: string
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, providerLabel))
    }

    return response
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${providerLabel} 请求超时，请检查网络、代理或模型服务状态。`)
    }

    throw error
  } finally {
    clearTimeout(timer)
  }
}

function resolveMaxTokens(task?: AiTaskPayload): number | undefined {
  switch (task?.task) {
    case 'project-bootstrap':
      return 1500
    case 'chapter-assistant':
      switch (String(task.context.responseLength ?? 'medium')) {
        case 'short':
          return 500
        case 'long':
          return 1400
        default:
          return 900
      }
    case 'worldview-entry':
    case 'character-card':
    case 'outline-item':
      return 700
    default:
      return undefined
  }
}

async function requestOpenAiCompatible(
  settings: AppSettings,
  prompt: PromptPair,
  task?: AiTaskPayload
): Promise<string> {
  const response = await performAiRequest(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.8,
      ...(resolveMaxTokens(task) ? { max_tokens: resolveMaxTokens(task) } : {}),
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ]
    })
  }, 'OpenAI 兼容接口')

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('AI 返回内容为空')
  }

  return content
}

async function requestAnthropic(settings: AppSettings, prompt: PromptPair, task?: AiTaskPayload): Promise<string> {
  const response = await performAiRequest(`${settings.baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: resolveMaxTokens(task) ?? 600,
      system: prompt.system,
      messages: [
        { role: 'user', content: prompt.user }
      ]
    })
  }, 'Anthropic')

  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>
  }

  const content = data.content?.find((item) => item.type === 'text')?.text
  if (!content) {
    throw new Error('Anthropic 返回内容为空')
  }

  return content
}

async function requestAiText(settings: AppSettings, prompt: PromptPair, task?: AiTaskPayload): Promise<string> {
  return settings.provider === 'anthropic'
    ? requestAnthropic(settings, prompt, task)
    : requestOpenAiCompatible(settings, prompt, task)
}

function extractOpenAiCompatibleDelta(payload: Record<string, unknown>): string {
  const choice = Array.isArray(payload.choices) ? payload.choices[0] as Record<string, unknown> | undefined : undefined
  const delta = choice?.delta as Record<string, unknown> | string[] | string | undefined

  if (typeof (delta as Record<string, unknown> | undefined)?.content === 'string') {
    return String((delta as Record<string, unknown>).content)
  }

  const contentParts = (delta as Record<string, unknown> | undefined)?.content
  if (Array.isArray(contentParts)) {
    return contentParts
      .map((part) => {
        const record = part as Record<string, unknown>
        if (typeof record.text === 'string') {
          return record.text
        }

        return typeof record.content === 'string' ? record.content : ''
      })
      .join('')
  }

  return ''
}

function extractAnthropicDelta(eventName: string, payload: Record<string, unknown>): string {
  const payloadType = String(payload.type ?? '')
  if (eventName === 'content_block_delta' || payloadType === 'content_block_delta') {
    const delta = payload.delta as Record<string, unknown> | undefined
    return typeof delta?.text === 'string' ? delta.text : ''
  }

  return ''
}

async function consumeSseResponse(
  response: Response,
  onEvent: (eventName: string, data: string) => void | Promise<void>
): Promise<void> {
  if (!response.body) {
    throw new Error('模型响应不支持流式读取。')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })

    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex >= 0) {
      const rawEvent = buffer.slice(0, separatorIndex).trim()
      buffer = buffer.slice(separatorIndex + 2)

      if (rawEvent) {
        let eventName = 'message'
        const dataLines: string[] = []

        for (const line of rawEvent.split(/\r?\n/)) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim() || eventName
            continue
          }

          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart())
          }
        }

        await onEvent(eventName, dataLines.join('\n'))
      }

      separatorIndex = buffer.indexOf('\n\n')
    }

    if (done) {
      const trailingEvent = buffer.trim()
      if (trailingEvent) {
        let eventName = 'message'
        const dataLines: string[] = []

        for (const line of trailingEvent.split(/\r?\n/)) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim() || eventName
            continue
          }

          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart())
          }
        }

        await onEvent(eventName, dataLines.join('\n'))
      }

      break
    }
  }
}

async function requestOpenAiCompatibleStream(
  settings: AppSettings,
  prompt: PromptPair,
  handlers: AiStreamHandlers,
  signal: AbortSignal,
  task?: AiTaskPayload
): Promise<string> {
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
    },
    signal,
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.8,
      stream: true,
      ...(resolveMaxTokens(task) ? { max_tokens: resolveMaxTokens(task) } : {}),
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ]
    })
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'OpenAI 兼容接口'))
  }

  let content = ''
  await consumeSseResponse(response, (eventName, data) => {
    if (!data || data === '[DONE]') {
      return
    }

    const payload = JSON.parse(data) as Record<string, unknown>
    const delta = extractOpenAiCompatibleDelta(payload)
    if (!delta) {
      return
    }

    content += delta
    handlers.onTextDelta(delta)
  })

  return content
}

async function requestAnthropicStream(
  settings: AppSettings,
  prompt: PromptPair,
  handlers: AiStreamHandlers,
  signal: AbortSignal,
  task?: AiTaskPayload
): Promise<string> {
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01'
    },
    signal,
    body: JSON.stringify({
      model: settings.model,
      stream: true,
      max_tokens: resolveMaxTokens(task) ?? 600,
      system: prompt.system,
      messages: [
        { role: 'user', content: prompt.user }
      ]
    })
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Anthropic'))
  }

  let content = ''
  await consumeSseResponse(response, (eventName, data) => {
    if (!data) {
      return
    }

    const payload = JSON.parse(data) as Record<string, unknown>
    const delta = extractAnthropicDelta(eventName, payload)
    if (!delta) {
      return
    }

    content += delta
    handlers.onTextDelta(delta)
  })

  return content
}

async function requestAiTextStream(
  settings: AppSettings,
  prompt: PromptPair,
  handlers: AiStreamHandlers,
  signal: AbortSignal,
  task?: AiTaskPayload
): Promise<string> {
  return settings.provider === 'anthropic'
    ? requestAnthropicStream(settings, prompt, handlers, signal, task)
    : requestOpenAiCompatibleStream(settings, prompt, handlers, signal, task)
}

async function resolveTaskResult(task: AiTaskPayload, settings: AppSettings, rawText: string): Promise<AiTaskResult> {
  try {
    const normalized = normalizeTaskResult(task, rawText)
    if (isTaskResultUsable(task, normalized)) {
      return normalized
    }
  } catch {
    // Fall through to the repair pass below.
  }

  if (!isStructuredTask(task)) {
    return normalizeTaskResult(task, rawText)
  }

  const repairedText = await requestAiText(settings, buildRepairPrompt(task, rawText), task)
  const repairedResult = normalizeTaskResult(task, repairedText)

  if (!isTaskResultUsable(task, repairedResult)) {
    throw new Error('AI 返回的结构化结果不完整，请稍后重试或调整提示词。')
  }

  return repairedResult
}

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

export async function generateAiTask(task: AiTaskPayload): Promise<AiTaskResult> {
  const settings = normalizeSettings(task.settings)
  validateSettings(settings)
  const prompt = buildTaskPrompt(task)
  const rawText = await requestAiText(settings, prompt, task)
  return resolveTaskResult(task, settings, rawText)
}

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
