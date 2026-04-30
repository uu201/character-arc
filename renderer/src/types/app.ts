/** 主题名称，决定应用的视觉色调 */
export type ThemeName = 'ocean' | 'jade' | 'amber' | 'rose'

/** 工作台面板名称，对应 8 个功能面板 */
export type PanelName = 'overview' | 'world' | 'characters' | 'relations' | 'inspiration' | 'outline' | 'chapters' | 'settings'

/** 项目摘要信息，用于项目列表页展示 */
export interface ProjectSummary {
  /** 项目唯一标识 */
  id: string
  /** 作品标题 */
  title: string
  /** 题材分类，如"科幻"、"仙侠" */
  genre: string
  /** 目标字数描述，如"目标 50万字" */
  wordCount: string
  /** 最后编辑时间的人类可读文本 */
  lastEdited: string
  /** 封面图 URL 或 CSS 渐变色值 */
  cover: string
  /** 写作风格预设 ID */
  writingStylePresetId: string
  /** 自定义写作风格提示词 */
  writingStylePrompt: string
}

/** 世界观设定条目 */
export interface WorldviewEntry {
  /** 条目唯一标识 */
  id: string
  /** 分类：地理 / 法则 / 物种 / 势力 / 历史 */
  type: string
  /** 条目标题 */
  title: string
  /** 条目正文描述 */
  content: string
  /** 排序权重，数值越小越靠前 */
  sortOrder: number
  /** 创建时间 ISO 时间戳 */
  createdAt: string
  /** 最后更新时间 ISO 时间戳 */
  updatedAt: string
}

/** 角色标签，用于角色卡的视觉标记 */
export interface CharacterTag {
  /** 标签文本 */
  label: string
  /** 标签色调，默认为灰色；danger=红，success=绿，warning=橙 */
  tone?: 'default' | 'danger' | 'success' | 'warning'
}

/** 角色卡数据结构 */
export interface CharacterCard {
  /** 角色唯一标识 */
  id: string
  /** 角色姓名 */
  name: string
  /** 角色定位短语，如"叛逆黑客 / 小队领袖" */
  role: string
  /** 角色详细描述 */
  description: string
  /** 头像 URL 或 CSS 渐变色值 */
  avatar: string
  /** 角色标签列表 */
  tags: CharacterTag[]
}

/** 组织/势力条目 */
export interface OrganizationEntry {
  /** 组织唯一标识 */
  id: string
  /** 组织名称 */
  name: string
  /** 组织类型，如"中立势力"、"反抗军" */
  type: string
  /** 组织定位和功能描述 */
  description: string
  /** 组织信条/口号 */
  motto: string
  /** 组织主色调，CSS 渐变色值 */
  color: string
  /** 排序权重 */
  sortOrder: number
  /** 创建时间 */
  createdAt: string
  /** 最后更新时间 */
  updatedAt: string
}

/** 角色之间的关系条目 */
export interface CharacterRelationship {
  /** 关系唯一标识 */
  id: string
  /** 关系发起方角色 ID */
  fromCharacterId: string
  /** 关系接收方角色 ID */
  toCharacterId: string
  /** 关系类型，如"战友"、"宿敌"、"暗恋" */
  type: string
  /** 关系描述 */
  description: string
  /** 关系强度 0-100，数值越大关系越紧密/激烈 */
  intensity: number
  /** 创建时间 */
  createdAt: string
  /** 最后更新时间 */
  updatedAt: string
}

/** 角色在组织中的成员归属关系 */
export interface OrganizationMembership {
  /** 归属关系唯一标识 */
  id: string
  /** 角色 ID */
  characterId: string
  /** 组织 ID */
  organizationId: string
  /** 在组织中的身份/职位 */
  role: string
  /** 额外备注说明 */
  notes: string
  /** 创建时间 */
  createdAt: string
  /** 最后更新时间 */
  updatedAt: string
}

/** 灵感卡片条目 */
export interface InspirationEntry {
  /** 灵感唯一标识 */
  id: string
  /** 灵感类型：标题灵感 / 开篇钩子 / 场景火花 / 剧情转折 / 设定补完 / 人物动机 */
  type: string
  /** 灵感标题 */
  title: string
  /** 灵感正文描述 */
  content: string
  /** 筛选标签列表 */
  tags: string[]
  /** 来源：ai=AI 生成，manual=用户手动创建 */
  source: 'ai' | 'manual'
  /** 排序权重 */
  sortOrder: number
  /** 创建时间 */
  createdAt: string
  /** 最后更新时间 */
  updatedAt: string
}

/** 大纲分卷，用于将大纲节点和章节按卷分组 */
export interface OutlineVolume {
  /** 分卷唯一标识 */
  id: string
  /** 分卷标题，如"第一卷：开端" */
  title: string
  /** 分卷目标字数描述 */
  wordTarget: string
  /** 分卷整体剧情摘要 */
  summary: string
}

/** 大纲剧情节点 */
export interface OutlineItem {
  /** 节点唯一标识 */
  id: string
  /** 所属分卷 ID */
  volumeId: string
  /** 章节标题 */
  title: string
  /** 预估字数描述 */
  wordTarget: string
  /** 一句话核心冲突描述 */
  conflict: string
  /** 剧情推进摘要 */
  summary: string
  /** 排序权重 */
  sortOrder: number
}

/** AI 助手聊天消息 */
export interface ChatMessage {
  /** 消息唯一标识 */
  id: string
  /** 消息角色：用户 或 助手 */
  role: 'user' | 'assistant'
  /** 消息正文内容 */
  content: string
}

/** 主窗口向助手窗口发送的提示词请求 */
export interface AssistantPromptRequest {
  /** 请求唯一标识，用于消费确认（避免重复处理） */
  id: string
  /** 用户输入的提示词文本 */
  prompt: string
  /** 可选的快捷动作标识，如"润色选中"、"章节标题" */
  quickAction?: string
}

/** 章节正文插入模式 */
export type ChapterInsertionMode = 'cursor' | 'append' | 'replace-selection'

/** 将 AI 生成的内容插入章节正文的请求 */
export interface ChapterInsertionRequest {
  /** 请求唯一标识 */
  id: string
  /** 目标章节 ID */
  chapterId: string
  /** 要插入的文本内容 */
  content: string
  /** 插入模式：光标处 / 追加末尾 / 替换选区 */
  mode: ChapterInsertionMode
}

/** 编辑器中用户当前选中的文本状态 */
export interface ChapterSelectionState {
  /** 选中文本所在的章节 ID */
  chapterId: string
  /** 用户选中的文本内容 */
  text: string
}

/** 章节稿件数据结构 */
export interface ChapterDraft {
  /** 章节唯一标识 */
  id: string
  /** 所属分卷 ID */
  volumeId: string
  /** 章节标题 */
  title: string
  /** 章节摘要 */
  summary: string
  /** 章节状态：草稿 / 审阅 / 润色 / 定稿 */
  status: 'draft' | 'review' | 'polish' | 'final'
  /** 预估字数描述 */
  wordTarget: string
  /** 章节正文 HTML 内容 */
  content: string
}

/** 章节历史版本快照，用于版本回溯 */
export interface ChapterVersion {
  /** 版本唯一标识 */
  id: string
  /** 关联的章节 ID */
  chapterId: string
  /** 快照时的章节标题 */
  title: string
  /** 快照时的章节摘要 */
  summary: string
  /** 快照时的章节状态 */
  status: ChapterDraft['status']
  /** 快照时的预估字数 */
  wordTarget: string
  /** 快照时的章节正文内容 */
  content: string
  /** 版本创建时间 */
  createdAt: string
}

/** 单个项目的工作区完整数据，包含所有业务实体 */
export interface ProjectWorkspaceData {
  /** 世界观设定列表 */
  worldviewEntries: WorldviewEntry[]
  /** 角色卡列表 */
  characters: CharacterCard[]
  /** 组织列表 */
  organizations: OrganizationEntry[]
  /** 角色关系列表 */
  characterRelationships: CharacterRelationship[]
  /** 组织成员归属列表 */
  organizationMemberships: OrganizationMembership[]
  /** 灵感卡片列表 */
  inspirationEntries: InspirationEntry[]
  /** 大纲分卷列表 */
  outlineVolumes: OutlineVolume[]
  /** 大纲节点列表 */
  outlineItems: OutlineItem[]
  /** 章节稿件列表 */
  chapters: ChapterDraft[]
  /** 章节历史版本列表 */
  chapterVersions: ChapterVersion[]
  /** AI 聊天消息列表 */
  messages: ChatMessage[]
}

/** 导入/导出的模块类型标识 */
export type ImportExportModuleType = 'project' | 'characters' | 'outline' | 'inspiration' | 'relations' | 'chapters'

/** 导入冲突解决模式 */
export type ImportConflictMode = 'overwrite' | 'copy'

/** 项目导入数据载荷，所有字段均可选 */
export interface ProjectImportPayload {
  /** 项目基础信息 */
  project?: Partial<ProjectSummary>
  worldviewEntries?: WorldviewEntry[]
  characters?: CharacterCard[]
  organizations?: OrganizationEntry[]
  characterRelationships?: CharacterRelationship[]
  organizationMemberships?: OrganizationMembership[]
  inspirationEntries?: InspirationEntry[]
  outlineVolumes?: OutlineVolume[]
  outlineItems?: OutlineItem[]
  chapters?: ChapterDraft[]
  chapterVersions?: ChapterVersion[]
}

/** CharacterArc 导出文件的标准信封格式 */
export interface CharacterArcExportEnvelope {
  /** 应用标识，固定为 'CharacterArc' */
  app: 'CharacterArc'
  /** 导出文件的 schema 版本号 */
  schemaVersion: string
  /** 导出的模块类型 */
  moduleType: ImportExportModuleType
  /** 兼容性说明文案 */
  compatibilityNote: string
  /** 导出时间 ISO 时间戳 */
  exportedAt: string
  /** 导出的实际数据载荷 */
  data: ProjectImportPayload
}

/** 应用全局设置 */
export interface AppSettings {
  /** AI 供应商标识 */
  provider: string
  /** AI 模型名称 */
  model: string
  /** API 鉴权密钥 */
  apiKey: string
  /** API 基础地址 */
  baseUrl: string
  /** 自动保存间隔选项值，如 '5m'、'live' */
  autoSaveInterval: string
  /** UI 缩放比例，范围 0.75-1.75 */
  uiScale: number
}
