import type { AiTaskName } from '../shared-types'

/** Skill 分类：市场调研、文本分析、写作、润色、封面、工具 */
export type SkillCategory = 'market' | 'analysis' | 'writing' | 'polish' | 'cover' | 'tool'

/** Skill 兼容性：原生支持、部分支持、仅外部使用 */
export type SkillCompatibility = 'native' | 'partial' | 'external-only'

/** 写作阶段标识 */
export type SkillStageId = 'reference' | 'premise' | 'setting' | 'outline' | 'draft'

/** Skill 参考文件加载规则 */
export type SkillReferenceRule = {
  file: string
  loadWhen?: {
    task?: AiTaskName
    chapterIndexMax?: number
  }
}

/** Skill 清单：描述 skill 的分类、适用任务、阶段、触发词等元数据 */
export type SkillManifest = {
  category: SkillCategory
  tasks: AiTaskName[]
  stages: SkillStageId[]
  triggers: string[]
  priority: number
  references: SkillReferenceRule[]
  /**
   * 标记为 required 的 skill 在适用任务/阶段被选中后，会在 agent 路径中直接注入 system prompt，
   * 不依赖模型自己决定是否加载；未绑定任务/阶段时可作为通用必选规则。
   * 用于"去 AI 味"、"项目风格"等用户明确要求必须生效的 skill。
   */
  required?: boolean
}

/** Skill 完整定义：包含 id、元数据、manifest、文件内容等全部信息 */
export type SkillDefinition = {
  id: string
  name: string
  version: string
  path: string
  scope: 'builtin' | 'project'
  rootDir: string
  description: string
  source: string
  manifest: SkillManifest
  compatibility: SkillCompatibility
  compatibilityNote: string
  enabled: boolean
  referencesCount: number
  referenceFiles: string[]
  content: string
}

/** Skill 选中结果：匹配后用于注入 prompt 的 skill 数据 */
export type SkillSelection = {
  id: string
  name: string
  content: string
  referenceContents: Array<{ file: string; content: string }>
  score: number
  /** 评分分项明细，用于选择日志排查与调参。可选——仅 matcher 产出时携带。 */
  scoreBreakdown?: {
    total: number
    task: number
    stage: number
    trigger: number
    narrative: number
    length: number
    priority: number
  }
}

/** Skill 扫描摘要条目：用于前端展示 skill 列表 */
export type SkillScanEntry = {
  id: string
  name: string
  version: string
  path: string
  scope: 'builtin' | 'project'
  description: string
  category: SkillCategory
  compatibility: SkillCompatibility
  compatibilityNote: string
  source: string
  referencesCount: number
  enabled: boolean
  stageIds: SkillStageId[]
}
