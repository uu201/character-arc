import type {
  ChapterAssistantPromptTemplate,
  ChapterDraft,
  CharacterCard,
  CharacterRelationship,
  NovelLength,
  OutlineItem,
  OutlineVolume,
  OrganizationEntry,
  OrganizationMembership,
  WorldviewEntry
} from '@/types/app'
import { createOutlineVolume } from '@/features/workspace/outlineVolumes'
import { normalizeWorldviewType } from '@shared/worldview-type'

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
    protagonist: { name: string; tags?: string[]; coreDesire: string; coreFlaw: string; innerConflict: string }
    mainArc: { premise: string; centralQuestion: string; endingDirection: string }
    worldRules: Array<{ type: string; title: string; content: string }>
  }
  expand: {
    supportingCharacters: Array<{ name: string; role: string; tags?: string[]; relationToProtagonist: string; motivation: string }>
    organizations: Array<{ name: string; type: string; description: string; motto: string; members: Array<{ characterName: string; role: string; notes: string }> }>
    relationships: Array<{ fromCharacter: string; toCharacter: string; type: string; description: string; intensity: number }>
    outlineBeats: Array<{ title: string; conflict: string; characterDriven: string; summary: string; wordTarget: string; relatedCharacters?: string[]; relatedOrganizations?: string[]; relatedWorldview?: string[] }>
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
    premise: string
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
  organizations: OrganizationEntry[]
  characterRelationships: CharacterRelationship[]
  organizationMemberships: OrganizationMembership[]
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
      volumeWordTarget: '30000',
      chapterWordTarget: '2000',
      volumeSummary: '用于集中推进故事主冲突，并在较短篇幅内完成完整闭环。'
    }
  }

  return {
    projectWordCount: '待统计',
    volumeWordTarget: '100000',
    chapterWordTarget: '3000',
    volumeSummary: '用于承接作品最初的主线冲突、角色出场和后续长线铺垫。'
  }
}

function normalizeChapterTitle(value: unknown, index: number): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  const withoutPrefix = raw
    .replace(/^\s*第[^章]{1,12}章\s*[:：、.．-]?\s*/u, '')
    .replace(/^\s*\d+\s*[.．、:：-]\s*/u, '')
  return `第${index + 1}章：${withoutPrefix || '剧情节拍'}`
}

function normalizeChapterWordTarget(value: unknown, novelLength: NovelLength, fallback: string): string {
  const isShort = novelLength === 'short'
  const minimum = isShort ? 1800 : 3000
  const maximum = isShort ? 2800 : 4000
  const fallbackNumber = Number(fallback.match(/\d+/)?.[0] ?? (isShort ? 2000 : 3000))
  const matched = String(value ?? '').replace(/,/g, '').match(/\d+/)
  const parsed = matched ? Number(matched[0]) : fallbackNumber
  const clamped = Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallbackNumber))
  return String(Math.round(clamped / 100) * 100)
}

function mapCharacterTags(value: unknown, role: string): Array<{ label: string }> {
  if (!Array.isArray(value)) return []
  const normalizedRole = role.trim()
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item && item !== normalizedRole))]
    .slice(0, 5)
    .map((label) => ({ label }))
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
    type: normalizeWorldviewType(item.type, '法则'),
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
    tags: mapCharacterTags(spiral.seed.protagonist.tags, '主角')
  }

  const supportingCards: CharacterCard[] = spiral.expand.supportingCharacters.map((c, index) => ({
    id: createSeedId('char', index + 1, timestamp),
    name: c.name,
    role: c.role,
    description: `与主角关系：${c.relationToProtagonist}\n动机：${c.motivation}`,
    avatar: '',
    tags: mapCharacterTags(c.tags, c.role)
  }))

  const characters = [protagonistCard, ...supportingCards]
  const characterNamesBeforePatches = new Map(characters.map((character) => [character.name.trim(), character.id]))

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

  const characterIdByName = new Map([
    ...characterNamesBeforePatches.entries(),
    ...characters.map((character) => [character.name.trim(), character.id] as const)
  ])
  const organizations: OrganizationEntry[] = spiral.expand.organizations.map((organization, index) => ({
    id: createSeedId('org', index, timestamp),
    name: organization.name?.trim() || `组织 ${index + 1}`,
    type: organization.type?.trim() || '势力',
    description: organization.description?.trim() || '待补充组织定位。',
    motto: organization.motto?.trim() || '',
    color: '',
    sortOrder: index,
    createdAt,
    updatedAt: createdAt
  }))
  const organizationIdByName = new Map(organizations.map((organization) => [organization.name.trim(), organization.id]))
  const worldviewIdByTitle = new Map(worldviewEntries.map((entry) => [entry.title.trim(), entry.id]))
  const organizationMemberships: OrganizationMembership[] = []
  for (const [organizationIndex, organization] of spiral.expand.organizations.entries()) {
    const organizationId = organizations[organizationIndex]?.id
    if (!organizationId) continue
    for (const [memberIndex, member] of (organization.members ?? []).entries()) {
      const characterId = characterIdByName.get(member.characterName?.trim())
      if (!characterId) continue
      organizationMemberships.push({
        id: createSeedId('membership', organizationIndex * 10 + memberIndex, timestamp),
        characterId,
        organizationId,
        role: member.role?.trim() || '成员',
        notes: member.notes?.trim() || '',
        createdAt,
        updatedAt: createdAt
      })
    }
  }
  const characterRelationships: CharacterRelationship[] = (spiral.expand.relationships ?? [])
    .map((relationship, index) => ({
      id: createSeedId('relationship', index, timestamp),
      fromCharacterId: characterIdByName.get(relationship.fromCharacter?.trim()) ?? '',
      toCharacterId: characterIdByName.get(relationship.toCharacter?.trim()) ?? '',
      type: relationship.type?.trim() || '关系',
      description: relationship.description?.trim() || '待补充关系说明。',
      intensity: Math.min(100, Math.max(0, Number(relationship.intensity) || 50)),
      createdAt,
      updatedAt: createdAt
    }))
    .filter((relationship) => relationship.fromCharacterId && relationship.toCharacterId && relationship.fromCharacterId !== relationship.toCharacterId)

  const outlineItems = spiral.expand.outlineBeats.map((beat, index) => {
    const baseSummary = beat.summary?.trim() || '待补充剧情摘要。'
    const driven = beat.characterDriven?.trim()
    const summary = driven ? `${baseSummary}\n角色驱动：${driven}` : baseSummary
    return {
      id: createSeedId('outline', index, timestamp),
      volumeId: firstVolumeId,
      title: normalizeChapterTitle(beat.title, index),
      wordTarget: normalizeChapterWordTarget(beat.wordTarget, novelLength, preset.chapterWordTarget),
      conflict: beat.conflict?.trim() || '待设定',
      summary,
      relatedCharacterIds: [...new Set((beat.relatedCharacters ?? [])
        .map((name) => characterIdByName.get(name.trim()))
        .filter((id): id is string => Boolean(id)))],
      relatedOrganizationIds: [...new Set((beat.relatedOrganizations ?? [])
        .map((name) => organizationIdByName.get(name.trim()))
        .filter((id): id is string => Boolean(id)))],
      relatedWorldviewIds: [...new Set((beat.relatedWorldview ?? [])
        .map((title) => worldviewIdByTitle.get(title.trim()))
        .filter((id): id is string => Boolean(id)))],
      status: 'planned' as const,
      sortOrder: index
    }
  })

  // 应用第三圈校验产出的大纲修补
  const outlinePatches = spiral.validate.patches.outlineAdjustments ?? []
  for (const patch of outlinePatches) {
    const target = outlineItems.find((o) => o.title === patch.title)
    if (target && patch.field && patch.after) {
      if (patch.field === 'title') target.title = normalizeChapterTitle(patch.after, outlineItems.indexOf(target))
      else if (patch.field === 'conflict') target.conflict = patch.after
      else if (patch.field === 'summary') target.summary = patch.after
      else if (patch.field === 'wordTarget') target.wordTarget = normalizeChapterWordTarget(patch.after, novelLength, preset.chapterWordTarget)
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
      premise: values.premise.trim(),
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
    organizations,
    characterRelationships,
    organizationMemberships,
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
    title: normalizeChapterTitle(item.title, index),
    wordTarget: normalizeChapterWordTarget(item.wordTarget, novelLength, preset.chapterWordTarget),
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
      premise: values.premise.trim(),
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
    organizations: [],
    characterRelationships: [],
    organizationMemberships: [],
    outlineVolumes,
    outlineItems,
    chapters
  }
}
