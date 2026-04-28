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
  const defaults = resolveProviderDefaults(settings.provider)
  return {
    provider: settings.provider,
    model: settings.model?.trim() || defaults.model,
    apiKey: settings.apiKey?.trim() || '',
    baseUrl: settings.baseUrl?.trim() || defaults.baseUrl
  }
}

function buildTaskPrompt(task: AiTaskPayload): { system: string; user: string } {
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

    return {
      system:
        '你是 CharacterArc 的小说创作助理。请基于当前项目和章节上下文，用中文直接输出可供作者使用的正文、润色稿、分析或建议。不要输出 Markdown 标题，不要解释你是 AI，也不要返回 JSON。',
      user: `请处理当前写作请求，并优先给出可直接使用的结果。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节状态：${String(context.chapterStatus ?? '')}\n当前章节预估字数：${String(context.chapterWordTarget ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n\n相关世界观：\n${worldviewEntries || '暂无'}\n\n相关角色：\n${characters || '暂无'}\n\n相关大纲：\n${outlineItems || '暂无'}\n\n快捷动作：${String(context.quickAction ?? '自由提问')}\n用户请求：${String(context.userPrompt ?? '')}\n\n要求：\n1. 回答要紧贴当前章节上下文\n2. 如果请求是润色、续写、描写，请优先输出可直接插入正文的内容\n3. 如果请求是分析或建议，请给出清晰可执行的建议\n4. 控制篇幅，默认输出 120 到 400 字，除非用户明确要求更长`
    }
  }

  return {
    system:
      '你是小说剧情大纲助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 title、wordTarget、conflict、summary。',
    user: `基于以下上下文，为当前小说项目补充一个新的章节大纲节点。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有大纲：${JSON.stringify(context.outlineTitles ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n\n要求：\n1. title 为新的章节标题\n2. wordTarget 使用“预估 xxxx字”格式\n3. conflict 用一句话概括核心冲突\n4. summary 用中文描述剧情推进，80 到 180 字\n\n返回格式：{"title":"","wordTarget":"","conflict":"","summary":""}`
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

function normalizeAssistantText(text: string): ChapterAssistantResult {
  const cleaned = text
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .trim()

  return {
    content: cleaned
  }
}

async function requestOpenAiCompatible(settings: AppSettings, prompt: { system: string; user: string }): Promise<string> {
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.8,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ]
    })
  })

  if (!response.ok) {
    throw new Error(`AI 请求失败：${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('AI 返回内容为空')
  }

  return content
}

async function requestAnthropic(settings: AppSettings, prompt: { system: string; user: string }): Promise<string> {
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 600,
      system: prompt.system,
      messages: [
        { role: 'user', content: prompt.user }
      ]
    })
  })

  if (!response.ok) {
    throw new Error(`Anthropic 请求失败：${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>
  }

  const content = data.content?.find((item) => item.type === 'text')?.text
  if (!content) {
    throw new Error('Anthropic 返回内容为空')
  }

  return content
}

export async function generateAiTask(task: AiTaskPayload): Promise<AiTaskResult> {
  const settings = normalizeSettings(task.settings)
  const prompt = buildTaskPrompt(task)

  let rawText = ''
  if (settings.provider === 'anthropic') {
    rawText = await requestAnthropic(settings, prompt)
  } else {
    rawText = await requestOpenAiCompatible(settings, prompt)
  }

  if (task.task === 'chapter-assistant') {
    return normalizeAssistantText(rawText)
  }

  return extractJsonObject(rawText)
}
