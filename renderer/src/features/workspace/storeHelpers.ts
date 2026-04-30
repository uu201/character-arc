import { toRaw } from 'vue'
import { createOutlineVolume as createWorkspaceVolume } from '@/features/workspace/outlineVolumes'
import { createDemoWorkspace, normalizeWorkspace } from '@/features/workspace/projectWorkspace'
import type {
  AppSettings,
  ChapterDraft,
  ChapterVersion,
  ChatMessage,
  CharacterRelationship,
  CharacterCard,
  InspirationEntry,
  OrganizationEntry,
  OrganizationMembership,
  OutlineItem,
  OutlineVolume,
  ProjectSummary,
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

// 默认项目列表：包含一个赛博朋克主题的示例项目，供新用户首次使用
export const defaultProjects: ProjectSummary[] = [
  {
    id: 'project-1',
    title: '赛博飞升指南',
    genre: '科幻 / 赛博朋克',
    wordCount: '12.5万字',
    lastEdited: '10分钟前编辑',
    cover: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
    writingStylePresetId: 'cinematic-cool',
    writingStylePrompt: ''
  }
]

// 默认应用设置：使用 DeepSeek API，5分钟自动保存
export const defaultAppSettings: AppSettings = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  apiKey: 'sk-1234567890abcdef',
  baseUrl: 'https://api.deepseek.com/v1',
  autoSaveInterval: '5m',
  uiScale: 1
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

// 加载本地持久化的应用状态，当前实现为返回包含默认数据的初始状态
export function loadStoredState(): StoredState {
  return {
    theme: 'ocean',
    selectedProjectId: defaultProjects[0].id,
    projects: defaultProjects,
    workspaces: {
      [defaultProjects[0].id]: createDemoWorkspace()
    },
    appSettings: defaultAppSettings
  }
}

// 标准化章节草稿：确保摘要、状态和目标字数都有合理的默认值
export function normalizeChapterDraft(chapter: ChapterDraft): ChapterDraft {
  return {
    ...chapter,
    summary: chapter.summary?.trim() || '待补充章节摘要',
    status: chapter.status ?? 'draft',
    wordTarget: chapter.wordTarget?.trim() || '预估 3000字'
  }
}

// 标准化章节版本：除基本字段外还确保创建时间合法
export function normalizeChapterVersion(version: ChapterVersion): ChapterVersion {
  return {
    ...version,
    summary: version.summary?.trim() || '待补充章节摘要',
    status: version.status ?? 'draft',
    wordTarget: version.wordTarget?.trim() || '预估 3000字',
    createdAt: version.createdAt || new Date().toISOString()
  }
}

// 标准化整个工作区数据：先通过 normalizeWorkspace 校正集合，再对章节和版本做额外规范化
export function normalizeProjectWorkspaceData(
  workspace?: Partial<ProjectWorkspaceData> | null,
  options?: { fallbackToDemo?: boolean }
): ProjectWorkspaceData {
  const normalized = normalizeWorkspace(workspace, options)
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
    messages: normalized.messages
  }
}

// 快速创建一个空白的起始章节草稿，用于新建项目或新卷时的默认章节
export function buildStarterChapter(volumeId: string, title = '第1章：开篇'): ChapterDraft {
  return {
    id: `chapter-${Date.now()}`,
    volumeId,
    title,
    summary: '待补充章节摘要',
    status: 'draft',
    wordTarget: '预估 3000字',
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
        : undefined,
      { fallbackToDemo: index === 0 && project.id === defaultProjects[0].id }
    )
  ]) ?? []

  return Object.fromEntries(workspaceEntries)
}

// 将 Vue 响应式对象转换为可序列化的纯对象，用于 JSON 持久化
export function toSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(toRaw(value))) as T
}
