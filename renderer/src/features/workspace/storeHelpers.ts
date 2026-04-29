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

export interface StoredState {
  theme: ThemeName
  selectedProjectId: string
  projects: ProjectSummary[]
  workspaces: Record<string, ProjectWorkspaceData>
  appSettings: AppSettings
}

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

export const defaultAppSettings: AppSettings = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  apiKey: 'sk-1234567890abcdef',
  baseUrl: 'https://api.deepseek.com/v1',
  autoSaveInterval: '5m',
  uiScale: 1
}

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

export function normalizeChapterDraft(chapter: ChapterDraft): ChapterDraft {
  return {
    ...chapter,
    summary: chapter.summary?.trim() || '待补充章节摘要',
    status: chapter.status ?? 'draft',
    wordTarget: chapter.wordTarget?.trim() || '预估 3000字'
  }
}

export function normalizeChapterVersion(version: ChapterVersion): ChapterVersion {
  return {
    ...version,
    summary: version.summary?.trim() || '待补充章节摘要',
    status: version.status ?? 'draft',
    wordTarget: version.wordTarget?.trim() || '预估 3000字',
    createdAt: version.createdAt || new Date().toISOString()
  }
}

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

export function getWorkspacePrimaryVolumeId(workspace: ProjectWorkspaceData): string {
  return workspace.outlineVolumes[0]?.id ?? createWorkspaceVolume().id
}

export function getChapterSequenceInVolume(chapters: ChapterDraft[], volumeId: string): number {
  return chapters.filter((chapter) => chapter.volumeId === volumeId).length + 1
}

export function getOutlineSequenceInVolume(outlineItems: OutlineItem[], volumeId: string): number {
  return outlineItems.filter((item) => item.volumeId === volumeId).length + 1
}

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

export function toSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(toRaw(value))) as T
}
