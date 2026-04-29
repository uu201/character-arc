import type { ChapterDraft, CharacterCard, OutlineItem, OutlineVolume, WorldviewEntry } from '@/types/app'
import { createOutlineVolume } from '@/features/workspace/outlineVolumes'

export interface ProjectWizardValues {
  title: string
  genre: string
  targetWordCount: string
  premise: string
  shouldGenerate: boolean
}

export interface ProjectBootstrapResult {
  worldviewEntries?: Array<{
    type?: string
    title?: string
    content?: string
  }>
  outlineItems?: Array<{
    title?: string
    wordTarget?: string
    conflict?: string
    summary?: string
  }>
}

export interface ProjectWorkspaceSeed {
  project: {
    title: string
    genre: string
    wordCount: string
    cover: string
  }
  worldviewEntries: WorldviewEntry[]
  characters: CharacterCard[]
  outlineVolumes: OutlineVolume[]
  outlineItems: OutlineItem[]
  chapters: ChapterDraft[]
}

const DEFAULT_PROJECT_COVER = 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)'

function createSeedId(prefix: string, index: number, timestamp: number): string {
  return `${prefix}-${timestamp}-${index + 1}`
}

function normalizeTargetWordCount(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return '20万字'
  }

  return trimmed
}

function buildBlankStarterChapter(values: ProjectWizardValues, timestamp: number, volumeId: string): ChapterDraft {
  return {
    id: createSeedId('chapter', 0, timestamp),
    volumeId,
    title: '第1章：开篇',
    summary: values.premise.trim() || '待补充章节摘要',
    status: 'draft',
    wordTarget: `预估 ${normalizeTargetWordCount(values.targetWordCount)}`,
    content: ''
  }
}

export function createProjectWorkspaceSeed(
  values: ProjectWizardValues,
  bootstrap?: ProjectBootstrapResult | null
): ProjectWorkspaceSeed {
  const timestamp = Date.now()
  const createdAt = new Date(timestamp).toISOString()
  const firstVolumeId = createSeedId('volume', 0, timestamp)
  const outlineVolumes = [
    createOutlineVolume({
      id: firstVolumeId,
      title: '故事开端',
      wordTarget: `目标 ${normalizeTargetWordCount(values.targetWordCount)}`,
      summary: values.premise.trim() || '用于承接作品最初的主线冲突与人物出场。'
    })
  ]
  const outlineItems = (bootstrap?.outlineItems ?? []).map((item, index) => ({
    id: createSeedId('outline', index, timestamp),
    volumeId: firstVolumeId,
    title: item.title?.trim() || `第${index + 1}章：剧情节点`,
    wordTarget: item.wordTarget?.trim() || `预估 ${normalizeTargetWordCount(values.targetWordCount)}`,
    conflict: item.conflict?.trim() || '新的冲突正在酝酿。',
    summary: item.summary?.trim() || '待补充剧情摘要。',
    sortOrder: index
  }))
  const worldviewEntries = (bootstrap?.worldviewEntries ?? []).map((item, index) => ({
    id: createSeedId('world', index, timestamp),
    type: item.type?.trim() || '地理',
    title: item.title?.trim() || `设定条目 ${index + 1}`,
    content: item.content?.trim() || '待补充设定内容。',
    sortOrder: index,
    createdAt,
    updatedAt: createdAt
  }))

  // Keep the first project seed lightweight: generated outline nodes become matching chapter drafts.
  const chapters = outlineItems.length
    ? outlineItems.map((item, index) => ({
        id: createSeedId('chapter', index, timestamp),
        volumeId: item.volumeId,
        title: item.title,
        summary: item.summary,
        status: 'draft' as const,
        wordTarget: item.wordTarget,
        content: ''
      }))
    : [buildBlankStarterChapter(values, timestamp, firstVolumeId)]

  return {
    project: {
      title: values.title.trim(),
      genre: values.genre.trim(),
      wordCount: `目标 ${normalizeTargetWordCount(values.targetWordCount)}`,
      cover: DEFAULT_PROJECT_COVER
    },
    worldviewEntries,
    characters: [],
    outlineVolumes,
    outlineItems,
    chapters
  }
}
