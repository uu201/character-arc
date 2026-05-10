import type { AiTaskName } from '../shared-types'

export type SkillCategory = 'market' | 'analysis' | 'writing' | 'polish' | 'cover' | 'tool'

export type SkillCompatibility = 'native' | 'partial' | 'external-only'

export type SkillStageId = 'reference' | 'premise' | 'setting' | 'outline' | 'draft'

export type SkillReferenceRule = {
  file: string
  loadWhen?: {
    task?: AiTaskName
    chapterIndexMax?: number
  }
}

export type SkillManifest = {
  category: SkillCategory
  tasks: AiTaskName[]
  stages: SkillStageId[]
  triggers: string[]
  priority: number
  references: SkillReferenceRule[]
  /**
   * 标记为 required 的 skill 在 agent 路径里会被直接注入 system prompt（不依赖模型自己决定是否加载），
   * 在传统路径里会无条件进入候选池（即使 score 为 0 也不会被过滤掉）。
   * 用于"去 AI 味"、"项目风格"等用户明确要求必须生效的 skill。
   */
  required?: boolean
}

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
  content: string
}

export type SkillSelection = {
  id: string
  name: string
  content: string
  referenceContents: Array<{ file: string; content: string }>
  score: number
}

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
