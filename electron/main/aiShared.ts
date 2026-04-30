/** AI 供应商名称，支持主流平台和自定义字符串 */
export type ProviderName = 'openai' | 'deepseek' | 'anthropic' | 'ollama' | string

/** 应用级 AI 设置，描述与 LLM 交互所需的连接信息 */
export type AppSettings = {
  /** 供应商标识，如 'deepseek'、'anthropic'、'ollama' */
  provider: string
  /** 调用的模型名称，如 'deepseek-chat'、'claude-3-5-sonnet-latest' */
  model: string
  /** 鉴权密钥，部分供应商（如 ollama、本地部署）可留空 */
  apiKey: string
  /** API 基础地址，不含具体路径；自动补全斜杠后接 /chat/completions 或 /v1/messages */
  baseUrl: string
}

/** AI 任务类型枚举，决定提示词构建和结果解析方式 */
export type AiTaskName =
  | 'worldview-entry'     // 生成一条世界观设定
  | 'character-card'      // 生成一个角色卡
  | 'outline-item'        // 生成一条剧情大纲节点
  | 'chapter-assistant'   // 章节创作助理（支持流式）
  | 'project-bootstrap'   // 项目初始化，批量生成世界观 + 大纲
  | 'chapter-analysis'    // 章节质量分析
  | 'inspiration-pack'    // 批量生成灵感卡片

/** AI 任务请求载荷，包含任务类型、设置和上下文信息 */
export type AiTaskPayload = {
  /** 任务类型，决定提示词和解析策略 */
  task: AiTaskName
  /** 调用 AI 时使用的设置 */
  settings: AppSettings
  /** 任务上下文，内容因任务类型而异（如项目标题、已有角色等） */
  context: Record<string, unknown>
}

/** AI 返回的世界观设定结构 */
export type WorldviewResult = {
  /** 世界观分类：地理 / 法则 / 物种 / 势力 / 历史 */
  type: string
  /** 词条标题 */
  title: string
  /** 词条正文描述 */
  content: string
}

/** AI 返回的角色卡结构 */
export type CharacterResult = {
  /** 角色姓名 */
  name: string
  /** 角色定位短语 */
  role: string
  /** 角色详细描述 */
  description: string
  /** 2-4 个简短标签 */
  tags: string[]
}

/** AI 返回的剧情大纲节点结构 */
export type OutlineResult = {
  /** 章节标题 */
  title: string
  /** 预估字数，格式为 "预估 xxxx字" */
  wordTarget: string
  /** 一句话核心冲突描述 */
  conflict: string
  /** 剧情推进摘要 */
  summary: string
}

/** AI 返回的章节助理文本结果（用于流式/非流式章节助理） */
export type ChapterAssistantResult = {
  /** 可直接插入正文的文本内容 */
  content: string
}

/** AI 返回的项目初始化结果，包含首批世界观和大纲 */
export type ProjectBootstrapResult = {
  /** 生成的世界观设定列表 */
  worldviewEntries: WorldviewResult[]
  /** 生成的剧情大纲节点列表 */
  outlineItems: OutlineResult[]
}

/** AI 返回的章节质量分析结果 */
export type ChapterAnalysisResult = {
  /** 章节完成度、情绪和主要问题的概括 */
  overview: string
  /** 节奏判断短评 */
  pacing: string
  /** 张力判断短评 */
  tension: string
  /** 连续性判断短评 */
  continuity: string
  /** 2-4 条章节亮点 */
  highlights: string[]
  /** 2-4 条潜在风险 */
  risks: string[]
  /** 3-5 条可执行的修改建议 */
  revisionActions: string[]
}

/** AI 返回的单条灵感卡片结构 */
export type InspirationResult = {
  /** 灵感类型：标题灵感 / 开篇钩子 / 场景火花 / 剧情转折 / 设定补完 / 人物动机 */
  type: string
  /** 灵感标题 */
  title: string
  /** 60-140 字的可执行灵感描述 */
  content: string
  /** 2-4 个筛选标签 */
  tags: string[]
}

/** AI 返回的灵感卡片组，包含多条灵感卡片 */
export type InspirationPackResult = {
  /** 灵感卡片列表 */
  entries: InspirationResult[]
}

/** 所有 AI 任务结果的联合类型 */
export type AiTaskResult =
  | WorldviewResult
  | CharacterResult
  | OutlineResult
  | ChapterAssistantResult
  | ProjectBootstrapResult
  | ChapterAnalysisResult
  | InspirationPackResult

/** 提示词对：系统提示词 + 用户提示词 */
export type PromptPair = {
  /** 系统角色指令，定义 AI 的行为边界 */
  system: string
  /** 用户请求正文，包含上下文和任务要求 */
  user: string
}

/** AI 流式输出回调函数集合 */
export type AiStreamHandlers = {
  /** 收到增量文本时触发，delta 为新追加的文本片段 */
  onTextDelta: (delta: string) => void
}

/** AI 请求超时时间（毫秒），超时后自动中断请求 */
export const AI_REQUEST_TIMEOUT_MS = 60_000

/**
 * 根据供应商名称返回其默认 Base URL 和推荐模型。
 * 用于用户未手动填写时的自动补全。
 */
export function resolveProviderDefaults(provider: ProviderName): { baseUrl: string; model: string } {
  switch (provider) {
    case 'openai':
      return { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
    case 'deepseek':
      return { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
    case 'qwen':
      return { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' }
    case 'zhipu':
      return { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7' }
    case 'moonshot':
      return { baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.5' }
    case 'siliconflow':
      return { baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-72B-Instruct' }
    case 'anthropic':
      return { baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest' }
    case 'ollama':
      return { baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2' }
    case 'new-api':
    case 'one-api':
      // 本地中转网关，默认使用 qwen-plus 模型
      return { baseUrl: 'http://127.0.0.1:3000/v1', model: 'qwen-plus' }
    default:
      return { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
  }
}

/**
 * 标准化 AI 设置：统一小写 provider，空白字段用默认值补全。
 * 调用 AI 前必须先经过此函数处理。
 */
export function normalizeSettings(settings: AppSettings): AppSettings {
  const provider = settings.provider?.trim().toLowerCase() || 'deepseek'
  const defaults = resolveProviderDefaults(provider)
  return {
    provider,
    model: settings.model?.trim() || defaults.model,
    apiKey: settings.apiKey?.trim() || '',
    baseUrl: settings.baseUrl?.trim() || defaults.baseUrl
  }
}

/** 判断 Base URL 是否指向本机（127.0.0.1 或 localhost） */
export function isLocalBaseUrl(baseUrl: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(baseUrl.trim())
}

/**
 * 判断当前设置是否需要 API Key。
 * Ollama 和本机部署的模型通常无需 API Key。
 */
export function requiresApiKey(settings: AppSettings): boolean {
  if (settings.provider === 'ollama') {
    return false
  }

  return !isLocalBaseUrl(settings.baseUrl)
}

/** 校验 AI 设置的完整性，缺少必填项时抛出中文错误信息 */
export function validateSettings(settings: AppSettings): void {
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

/**
 * 根据任务类型决定最大输出 token 数。
 * 不同任务对输出长度的需求差异较大，此函数按经验设定上限。
 */
export function resolveMaxTokens(task?: AiTaskPayload): number | undefined {
  switch (task?.task) {
    case 'project-bootstrap':
      // 初始化任务需要一次性输出世界观 + 大纲，token 需求较高
      return 1500
    case 'chapter-analysis':
    case 'inspiration-pack':
      // 分析和灵感包输出中等长度
      return 1200
    case 'chapter-assistant':
      // 章节助理根据用户选择的响应长度动态调整
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
      // 单条结构化输出，长度较短
      return 700
    default:
      return undefined
  }
}
