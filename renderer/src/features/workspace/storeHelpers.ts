import { toRaw } from 'vue'
import { createDefaultWorkflowDocuments, normalizeWorkflowDocuments } from '@/features/novelWorkflow/documents'
import { createDefaultNovelWorkflowStages, normalizeNovelWorkflowStages } from '@/features/novelWorkflow/stages'
import { DEFAULT_CHAPTER_WORD_TARGET, normalizeChapterWordTarget } from '@/features/chapters/wordTarget'
import { createOutlineVolume as createWorkspaceVolume } from '@/features/workspace/outlineVolumes'
import { createDemoWorkspace, normalizeWorkspace } from '@/features/workspace/projectWorkspace'
import type {
  AppSettings,
  ChapterAssistantPromptTemplate,
  ChapterDraft,
  ChapterVersion,
  ChatMessage,
  CharacterRelationship,
  CharacterCard,
  InspirationEntry,
  NovelLength,
  OrganizationEntry,
  OrganizationMembership,
  OutlineItem,
  OutlineVolume,
  ProjectSummary,
  ProjectSkillItem,
  ReferenceWorkItem,
  ReferenceStyleAnalysis,
  ReferenceStyleMetric,
  ProjectWorkspaceData,
  ThemeName,
  WorldviewEntry
} from '@/types/app'

// 持久化到本地存储的完整应用状态结构
export interface StoredState {
  theme: ThemeName
  selectedProjectId: string
  projects: ProjectSummary[]
  workspaces: Record<string, ProjectWorkspaceData> // 按项目 ID 映射的工作区数据
  appSettings: AppSettings
}

// 旧版存储结构：所有字段可选，用于从旧格式迁移数据
export interface LegacyStoredState {
  theme?: ThemeName
  selectedProjectId?: string
  projects?: ProjectSummary[]
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
  messages?: ChatMessage[]
  appSettings?: AppSettings
}

// 默认项目列表：空列表，新用户通过向导创建第一个项目
export const defaultProjects: ProjectSummary[] = []

export function normalizeNovelLength(length?: string | null): NovelLength {
  return length === 'short' ? 'short' : 'long'
}

export function normalizeChapterAssistantTemplates(
  templates?: ChapterAssistantPromptTemplate[] | null
): ChapterAssistantPromptTemplate[] {
  return Array.isArray(templates)
    ? templates.map((template) => ({
        ...template,
        label: template.label?.trim() || '未命名模板',
        prompt: template.prompt?.trim() || '',
        group: template.group,
        mode: template.mode,
        length: template.length,
        task: template.task,
        requiresSelection: Boolean(template.requiresSelection)
      }))
    : []
}

export function normalizeProjectSummary(project: ProjectSummary): ProjectSummary {
  return {
    ...project,
    novelLength: normalizeNovelLength(project.novelLength),
    wordCount: project.wordCount?.trim() || '待统计',
    writingStylePresetId: project.writingStylePresetId?.trim() || 'cinematic-cool',
    writingStylePrompt: project.writingStylePrompt?.trim() || '',
    chapterAssistantTemplates: normalizeChapterAssistantTemplates(project.chapterAssistantTemplates),
    novelWorkflowStages: normalizeNovelWorkflowStages(project.novelWorkflowStages),
    projectSkills: normalizeProjectSkills(project.projectSkills),
    targetPlatform: project.targetPlatform?.trim() || '',
    referenceWorks: normalizeReferenceWorks(project.referenceWorks)
  }
}

export function normalizeProjectSkills(skills?: ProjectSkillItem[] | null): ProjectSkillItem[] {
  return Array.isArray(skills)
    ? skills.map((skill) => ({
        ...skill,
        name: skill.name?.trim() || '未命名 Skill',
        path: skill.path?.trim() || '',
        description: skill.description?.trim() || '',
        enabled: Boolean(skill.enabled),
        stageIds: Array.isArray(skill.stageIds) ? skill.stageIds : []
      }))
    : []
}

function normalizeReferenceStyleMetrics(metrics?: ReferenceStyleMetric[] | null): ReferenceStyleMetric[] {
  return Array.isArray(metrics)
    ? metrics
        .map((metric) => ({
          label: metric.label?.trim() || '未命名指标',
          value: metric.value?.trim() || '待补充'
        }))
        .slice(0, 8)
    : []
}

function normalizeReferenceStyleAnalysis(
  analysis?: ReferenceStyleAnalysis | null,
  fileNameFallback = ''
): ReferenceStyleAnalysis | undefined {
  if (!analysis) {
    return undefined
  }

  const fileType = analysis.fileType === 'md' || analysis.fileType === 'docx' ? analysis.fileType : 'txt'

  return {
    createdAt: analysis.createdAt || new Date().toISOString(),
    fileName: analysis.fileName?.trim() || fileNameFallback,
    fileType,
    characterCount: Number.isFinite(analysis.characterCount) ? Math.max(0, analysis.characterCount) : 0,
    chapterCount: Number.isFinite(analysis.chapterCount) ? Math.max(0, analysis.chapterCount) : 0,
    excerpt: analysis.excerpt?.trim() || '',
    topKeywords: Array.isArray(analysis.topKeywords)
      ? analysis.topKeywords.map((keyword) => String(keyword).trim()).filter(Boolean).slice(0, 10)
      : [],
    metrics: normalizeReferenceStyleMetrics(analysis.metrics),
    overview: analysis.overview?.trim() || '',
    sentenceStyle: analysis.sentenceStyle?.trim() || '',
    dialogueRatio: analysis.dialogueRatio?.trim() || '',
    pacingControl: analysis.pacingControl?.trim() || '',
    emotionExpression: analysis.emotionExpression?.trim() || '',
    narrativePerspective: analysis.narrativePerspective?.trim() || '',
    styleRules: Array.isArray(analysis.styleRules)
      ? analysis.styleRules.map((rule) => String(rule).trim()).filter(Boolean).slice(0, 6)
      : [],
    plotOutline: analysis.plotOutline?.trim() || '',
    reusableStylePrompt: analysis.reusableStylePrompt?.trim() || '',
    avoidRules: Array.isArray(analysis.avoidRules)
      ? analysis.avoidRules.map((rule) => String(rule).trim()).filter(Boolean).slice(0, 6)
      : []
  }
}

export function normalizeReferenceWorks(works?: ReferenceWorkItem[] | null): ReferenceWorkItem[] {
  return Array.isArray(works)
    ? works.map((work) => ({
        ...work,
        title: work.title?.trim() || '未命名参考作品',
        source: work.source?.trim() || '未标注来源',
        notes: work.notes?.trim() || '',
        fileName: work.fileName?.trim() || '',
        analysis: normalizeReferenceStyleAnalysis(work.analysis, work.fileName?.trim() || '')
      }))
    : []
}

// 默认应用设置：5分钟自动保存，API 信息由用户在设置中填写
export const defaultAppSettings: AppSettings = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  autoSaveInterval: '5m',
  uiScale: 1,
  darkMode: false
}

// 合并用户设置与默认设置，uiScale 限制在 0.75-1.75 的合理范围内
export function normalizeAppSettings(settings?: Partial<AppSettings> | null): AppSettings {
  return {
    ...defaultAppSettings,
    ...settings,
    uiScale:
      settings?.uiScale !== undefined && Number.isFinite(settings.uiScale)
        ? Math.min(1.75, Math.max(0.75, settings.uiScale))
        : defaultAppSettings.uiScale
  }
}

// 加载本地持久化的应用状态，当前实现为返回空初始状态
export function loadStoredState(): StoredState {
  return {
    theme: 'ocean',
    selectedProjectId: '',
    projects: defaultProjects,
    workspaces: {},
    appSettings: defaultAppSettings
  }
}

// 标准化章节草稿：确保摘要、状态和目标字数都有合理的默认值
export function normalizeChapterDraft(chapter: ChapterDraft): ChapterDraft {
  return {
    ...chapter,
    outlineItemId: chapter.outlineItemId ?? '',
    summary: chapter.summary?.trim() || '待补充章节摘要',
    status: chapter.status ?? 'draft',
    wordTarget: normalizeChapterWordTarget(chapter.wordTarget)
  }
}

// 标准化章节版本：除基本字段外还确保创建时间合法
export function normalizeChapterVersion(version: ChapterVersion): ChapterVersion {
  return {
    ...version,
    summary: version.summary?.trim() || '待补充章节摘要',
    status: version.status ?? 'draft',
    wordTarget: normalizeChapterWordTarget(version.wordTarget),
    createdAt: version.createdAt || new Date().toISOString()
  }
}

// 标准化整个工作区数据：先通过 normalizeWorkspace 校正集合，再对章节和版本做额外规范化
export function normalizeProjectWorkspaceData(
  workspace?: Partial<ProjectWorkspaceData> | null
): ProjectWorkspaceData {
  const normalized = normalizeWorkspace(workspace)
  return {
    worldviewEntries: normalized.worldviewEntries,
    characters: normalized.characters,
    organizations: normalized.organizations,
    characterRelationships: normalized.characterRelationships,
    organizationMemberships: normalized.organizationMemberships,
    inspirationEntries: normalized.inspirationEntries,
    outlineVolumes: normalized.outlineVolumes,
    outlineItems: normalized.outlineItems,
    chapters: normalized.chapters.map(normalizeChapterDraft),
    chapterVersions: normalized.chapterVersions.map(normalizeChapterVersion),
    messages: normalized.messages,
    workflowDocuments: normalizeWorkflowDocuments(normalized.workflowDocuments)
  }
}

// 快速创建一个空白的起始章节草稿，用于新建项目或新卷时的默认章节
export function buildStarterChapter(volumeId: string, title = '第1章：开篇'): ChapterDraft {
  return {
    id: `chapter-${Date.now()}`,
    outlineItemId: '',
    volumeId,
    title,
    summary: '待补充章节摘要',
    status: 'draft',
    wordTarget: DEFAULT_CHAPTER_WORD_TARGET,
    content: ''
  }
}

// 获取工作区中第一个分卷的 ID，若无分卷则创建一个新的并返回其 ID
export function getWorkspacePrimaryVolumeId(workspace: ProjectWorkspaceData): string {
  return workspace.outlineVolumes[0]?.id ?? createWorkspaceVolume().id
}

// 计算某分卷中下一个章节的序号（当前章节数 + 1）
export function getChapterSequenceInVolume(chapters: ChapterDraft[], volumeId: string): number {
  return chapters.filter((chapter) => chapter.volumeId === volumeId).length + 1
}

// 计算某分卷中下一个大纲条目的序号（当前条目数 + 1）
export function getOutlineSequenceInVolume(outlineItems: OutlineItem[], volumeId: string): number {
  return outlineItems.filter((item) => item.volumeId === volumeId).length + 1
}

// 将新条目插入到同一分卷的最后一个条目之后，保持分卷内条目连续
// 若目标分卷无已有条目，则追加到数组末尾
export function insertIntoVolumeSection<T extends { volumeId: string }>(items: T[], nextItem: T): T[] {
  const nextItems = [...items]
  const lastIndexInVolume = nextItems.reduce(
    (lastMatchIndex, item, index) => (item.volumeId === nextItem.volumeId ? index : lastMatchIndex),
    -1
  )

  if (lastIndexInVolume === -1) {
    nextItems.push(nextItem)
    return nextItems
  }

  nextItems.splice(lastIndexInVolume + 1, 0, nextItem)
  return nextItems
}

// 从旧版扁平存储结构迁移为新版按项目 ID 分组的工作区映射
// 仅当前选中项目的关联数据会被完整迁移，其余项目回退到演示数据或空工作区
export function buildWorkspaceMapFromLegacy(
  payload: LegacyStoredState,
  selectedProjectId: string
): Record<string, ProjectWorkspaceData> {
  const workspaceEntries = payload.projects?.map((project, index) => [
    project.id,
    normalizeProjectWorkspaceData(
      project.id === selectedProjectId
        ? {
            worldviewEntries: payload.worldviewEntries,
            characters: payload.characters,
            organizations: payload.organizations,
            characterRelationships: payload.characterRelationships,
            organizationMemberships: payload.organizationMemberships,
            inspirationEntries: payload.inspirationEntries,
            outlineVolumes: payload.outlineVolumes,
            outlineItems: payload.outlineItems,
            chapters: payload.chapters,
            chapterVersions: payload.chapterVersions,
            messages: payload.messages
          }
        : undefined
    )
  ]) ?? []

  return Object.fromEntries(workspaceEntries)
}

// 将 Vue 响应式对象转换为可序列化的纯对象，用于 JSON 持久化
export function toSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(toRaw(value))) as T
}
