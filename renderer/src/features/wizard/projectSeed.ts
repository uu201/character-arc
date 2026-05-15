import type {
  ChapterAssistantPromptTemplate,
  ChapterDraft,
  CharacterCard,
  NovelLength,
  OutlineItem,
  OutlineVolume,
  WorldviewEntry
} from '@/types/app'
import { createOutlineVolume } from '@/features/workspace/outlineVolumes'

export interface ProjectWizardValues {
  title: string
  genre: string
  novelLength: NovelLength
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

export interface SpiralBootstrapResult {
  seed: {
    protagonist: { name: string; coreDesire: string; coreFlaw: string; innerConflict: string }
    mainArc: { premise: string; centralQuestion: string; endingDirection: string }
    worldRules: Array<{ type: string; title: string; content: string }>
  }
  expand: {
    supportingCharacters: Array<{ name: string; role: string; relationToProtagonist: string; motivation: string }>
    outlineBeats: Array<{ title: string; conflict: string; characterDriven: string; summary: string; wordTarget: string }>
    expandedWorldview: Array<{ type: string; title: string; content: string }>
  }
  validate: {
    patches: {
      characterAdjustments?: Array<{ name: string; field: string; before: string; after: string }>
      outlineAdjustments?: Array<{ title: string; field: string; before: string; after: string }>
      worldviewAdditions?: Array<{ type: string; title: string; content: string }>
    }
  }
}

export interface ProjectWorkspaceSeed {
  project: {
    title: string
    genre: string
    novelLength: NovelLength
    wordCount: string
    cover: string
    writingStylePresetId: string
    writingStylePrompt: string
    chapterAssistantTemplates: ChapterAssistantPromptTemplate[]
  }
  worldviewEntries: WorldviewEntry[]
  characters: CharacterCard[]
  outlineVolumes: OutlineVolume[]
  outlineItems: OutlineItem[]
  chapters: ChapterDraft[]
}

interface NovelLengthPreset {
  projectWordCount: string
  volumeWordTarget: string
  chapterWordTarget: string
  volumeSummary: string
}

const DEFAULT_PROJECT_COVER = 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)'

function createSeedId(prefix: string, index: number, timestamp: number): string {
  return `${prefix}-${timestamp}-${index + 1}`
}

function resolveNovelLengthPreset(length: NovelLength): NovelLengthPreset {
  if (length === 'short') {
    return {
      projectWordCount: '待统计',
      volumeWordTarget: '预估 3万字',
      chapterWordTarget: '预估 2000字',
      volumeSummary: '用于集中推进故事主冲突，并在较短篇幅内完成完整闭环。'
    }
  }

  return {
    projectWordCount: '待统计',
    volumeWordTarget: '预估 10万字',
    chapterWordTarget: '预估 3000字',
    volumeSummary: '用于承接作品最初的主线冲突、角色出场和后续长线铺垫。'
  }
}

function buildBlankStarterChapter(
  values: ProjectWizardValues,
  timestamp: number,
  volumeId: string,
  preset: NovelLengthPreset
): ChapterDraft {
  return {
    id: createSeedId('chapter', 0, timestamp),
    outlineItemId: '',
    volumeId,
    title: '第1章：开篇',
    summary: values.premise.trim() || '待补充章节摘要',
    status: 'draft',
    wordTarget: preset.chapterWordTarget,
    content: ''
  }
}

export function createProjectWorkspaceSeedFromSpiral(
  values: ProjectWizardValues,
  spiral: SpiralBootstrapResult
): ProjectWorkspaceSeed {
  const timestamp = Date.now()
  const createdAt = new Date(timestamp).toISOString()
  const firstVolumeId = createSeedId('volume', 0, timestamp)
  const novelLength: NovelLength = values.novelLength === 'short' ? 'short' : 'long'
  const preset = resolveNovelLengthPreset(novelLength)

  const outlineVolumes = [
    createOutlineVolume({
      id: firstVolumeId,
      title: '故事开端',
      wordTarget: preset.volumeWordTarget,
      summary: spiral.seed.mainArc.premise || values.premise.trim() || preset.volumeSummary
    })
  ]

  const allWorldview = [
    ...spiral.seed.worldRules,
    ...spiral.expand.expandedWorldview,
    ...(spiral.validate.patches.worldviewAdditions ?? [])
  ]
  const worldviewEntries = allWorldview.map((item, index) => ({
    id: createSeedId('world', index, timestamp),
    type: item.type?.trim() || '法则',
    title: item.title?.trim() || `设定条目 ${index + 1}`,
    content: item.content?.trim() || '待补充设定内容。',
    sortOrder: index,
    createdAt,
    updatedAt: createdAt
  }))

  const protagonistCard: CharacterCard = {
    id: createSeedId('char', 0, timestamp),
    name: spiral.seed.protagonist.name,
    role: '主角',
    description: `核心欲望：${spiral.seed.protagonist.coreDesire}\n核心缺陷：${spiral.seed.protagonist.coreFlaw}\n内在矛盾：${spiral.seed.protagonist.innerConflict}`,
    avatar: '',
    tags: [{ label: '主角' }]
  }

  const supportingCards: CharacterCard[] = spiral.expand.supportingCharacters.map((c, index) => ({
    id: createSeedId('char', index + 1, timestamp),
    name: c.name,
    role: c.role,
    description: `与主角关系：${c.relationToProtagonist}\n动机：${c.motivation}`,
    avatar: '',
    tags: [{ label: c.role }]
  }))

  const characters = [protagonistCard, ...supportingCards]

  // 应用第三圈校验产出的角色修补
  const charPatches = spiral.validate.patches.characterAdjustments ?? []
  for (const patch of charPatches) {
    const target = characters.find((c) => c.name === patch.name)
    if (target && patch.field && patch.after) {
      if (patch.field === 'role') target.role = patch.after
      else if (patch.field === 'description') target.description = patch.after
      else if (patch.field === 'name') target.name = patch.after
    }
  }

  const outlineItems = spiral.expand.outlineBeats.map((beat, index) => {
    const baseSummary = beat.summary?.trim() || '待补充剧情摘要。'
    const driven = beat.characterDriven?.trim()
    const summary = driven ? `${baseSummary}\n角色驱动：${driven}` : baseSummary
    return {
      id: createSeedId('outline', index, timestamp),
      volumeId: firstVolumeId,
      title: beat.title?.trim() || `第${index + 1}章：剧情节拍`,
      wordTarget: beat.wordTarget?.trim() || preset.chapterWordTarget,
      conflict: beat.conflict?.trim() || '待设定',
      summary,
      status: 'planned' as const,
      sortOrder: index
    }
  })

  // 应用第三圈校验产出的大纲修补
  const outlinePatches = spiral.validate.patches.outlineAdjustments ?? []
  for (const patch of outlinePatches) {
    const target = outlineItems.find((o) => o.title === patch.title)
    if (target && patch.field && patch.after) {
      if (patch.field === 'title') target.title = patch.after
      else if (patch.field === 'conflict') target.conflict = patch.after
      else if (patch.field === 'summary') target.summary = patch.after
      else if (patch.field === 'wordTarget') target.wordTarget = patch.after
    }
  }

  const chapters = outlineItems.length
    ? outlineItems.map((item, index) => ({
        id: createSeedId('chapter', index, timestamp),
        outlineItemId: item.id,
        volumeId: item.volumeId,
        title: item.title,
        summary: item.summary,
        status: 'draft' as const,
        wordTarget: item.wordTarget,
        content: ''
      }))
    : [buildBlankStarterChapter(values, timestamp, firstVolumeId, preset)]

  return {
    project: {
      title: values.title.trim(),
      genre: values.genre.trim(),
      novelLength,
      wordCount: preset.projectWordCount,
      cover: DEFAULT_PROJECT_COVER,
      writingStylePresetId: 'cinematic-cool',
      writingStylePrompt: '',
      chapterAssistantTemplates: []
    },
    worldviewEntries,
    characters,
    outlineVolumes,
    outlineItems,
    chapters
  }
}

export function createProjectWorkspaceSeed(
  values: ProjectWizardValues,
  bootstrap?: ProjectBootstrapResult | null
): ProjectWorkspaceSeed {
  const timestamp = Date.now()
  const createdAt = new Date(timestamp).toISOString()
  const firstVolumeId = createSeedId('volume', 0, timestamp)
  const novelLength: NovelLength = values.novelLength === 'short' ? 'short' : 'long'
  const preset = resolveNovelLengthPreset(novelLength)

  const outlineVolumes = [
    createOutlineVolume({
      id: firstVolumeId,
      title: '故事开端',
      wordTarget: preset.volumeWordTarget,
      summary: values.premise.trim() || preset.volumeSummary
    })
  ]

  const outlineItems = (bootstrap?.outlineItems ?? []).map((item, index) => ({
    id: createSeedId('outline', index, timestamp),
    volumeId: firstVolumeId,
    title: item.title?.trim() || `第${index + 1}章：剧情节点`,
    wordTarget: item.wordTarget?.trim() || preset.chapterWordTarget,
    conflict: item.conflict?.trim() || '新的冲突正在酝酿。',
    summary: item.summary?.trim() || '待补充剧情摘要。',
    status: 'planned' as const,
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

  const chapters = outlineItems.length
    ? outlineItems.map((item, index) => ({
        id: createSeedId('chapter', index, timestamp),
        outlineItemId: item.id,
        volumeId: item.volumeId,
        title: item.title,
        summary: item.summary,
        status: 'draft' as const,
        wordTarget: item.wordTarget,
        content: ''
      }))
    : [buildBlankStarterChapter(values, timestamp, firstVolumeId, preset)]

  return {
    project: {
      title: values.title.trim(),
      genre: values.genre.trim(),
      novelLength,
      wordCount: preset.projectWordCount,
      cover: DEFAULT_PROJECT_COVER,
      writingStylePresetId: 'cinematic-cool',
      writingStylePrompt: '',
      chapterAssistantTemplates: []
    },
    worldviewEntries,
    characters: [],
    outlineVolumes,
    outlineItems,
    chapters
  }
}
