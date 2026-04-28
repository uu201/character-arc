import type { ChapterDraft, OutlineItem, OutlineVolume } from '@/types/app'

const CHINESE_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export const DEFAULT_VOLUME_WORD_TARGET = '目标 5万字'
export const DEFAULT_VOLUME_SUMMARY = '用于承载这一卷的主线目标、阶段冲突和情绪走势。'

function formatChineseNumber(value: number): string {
  if (value <= 10) {
    return CHINESE_NUMERALS[value - 1] ?? String(value)
  }

  if (value < 20) {
    return `十${CHINESE_NUMERALS[value - 11] ?? ''}`
  }

  const tens = Math.floor(value / 10)
  const units = value % 10
  return `${CHINESE_NUMERALS[tens - 1] ?? String(tens)}十${units ? CHINESE_NUMERALS[units - 1] ?? String(units) : ''}`
}

export function createOutlineVolume(overrides?: Partial<OutlineVolume>): OutlineVolume {
  return {
    id: overrides?.id ?? `volume-${Date.now()}`,
    title: overrides?.title?.trim() || '故事开端',
    wordTarget: overrides?.wordTarget?.trim() || DEFAULT_VOLUME_WORD_TARGET,
    summary: overrides?.summary?.trim() || DEFAULT_VOLUME_SUMMARY
  }
}

export function cloneOutlineVolumes(outlineVolumes?: OutlineVolume[]): OutlineVolume[] {
  return outlineVolumes?.length ? outlineVolumes.map((volume) => ({ ...volume })) : []
}

export function normalizeVolumeTitle(title: string, fallbackIndex: number): string {
  return title.trim() || `分卷 ${fallbackIndex}`
}

export function ensureVolumeCollections(payload?: {
  outlineVolumes?: OutlineVolume[]
  outlineItems?: OutlineItem[]
  chapters?: ChapterDraft[]
}): {
  outlineVolumes: OutlineVolume[]
  outlineItems: OutlineItem[]
  chapters: ChapterDraft[]
} {
  const outlineVolumes = cloneOutlineVolumes(payload?.outlineVolumes)
  const outlineItems = payload?.outlineItems?.map((item) => ({ ...item })) ?? []
  const chapters = payload?.chapters?.map((chapter) => ({ ...chapter })) ?? []

  const volumeMap = new Map(outlineVolumes.map((volume) => [volume.id, volume]))
  const referencedVolumeIds = new Set<string>()

  for (const item of outlineItems) {
    if (item.volumeId) {
      referencedVolumeIds.add(item.volumeId)
    }
  }

  for (const chapter of chapters) {
    if (chapter.volumeId) {
      referencedVolumeIds.add(chapter.volumeId)
    }
  }

  if (outlineVolumes.length === 0) {
    const firstReferencedVolumeId = Array.from(referencedVolumeIds)[0]
    outlineVolumes.push(
      createOutlineVolume({
        id: firstReferencedVolumeId || `volume-${Date.now()}`
      })
    )
    volumeMap.set(outlineVolumes[0].id, outlineVolumes[0])
  }

  for (const volumeId of referencedVolumeIds) {
    if (!volumeMap.has(volumeId)) {
      const missingVolume = createOutlineVolume({
        id: volumeId,
        title: `未命名分卷 ${outlineVolumes.length + 1}`
      })
      outlineVolumes.push(missingVolume)
      volumeMap.set(volumeId, missingVolume)
    }
  }

  const fallbackVolumeId = outlineVolumes[0].id

  return {
    outlineVolumes,
    outlineItems: outlineItems.map((item) => ({
      ...item,
      volumeId: item.volumeId && volumeMap.has(item.volumeId) ? item.volumeId : fallbackVolumeId
    })),
    chapters: chapters.map((chapter) => ({
      ...chapter,
      volumeId: chapter.volumeId && volumeMap.has(chapter.volumeId) ? chapter.volumeId : fallbackVolumeId
    }))
  }
}

export function formatVolumeLabel(volume: OutlineVolume, index: number, mode: 'formal' | 'compact' = 'formal'): string {
  const volumeNumber = formatChineseNumber(index + 1)
  const prefix = mode === 'formal' ? `第${volumeNumber}卷` : `卷${volumeNumber}`
  return `${prefix}：${normalizeVolumeTitle(volume.title, index + 1)}`
}

export function buildVolumeGroups<T extends { volumeId: string }>(
  outlineVolumes: OutlineVolume[],
  items: T[]
): Array<{ volume: OutlineVolume; index: number; items: T[] }> {
  return outlineVolumes.map((volume, index) => ({
    volume,
    index,
    items: items.filter((item) => item.volumeId === volume.id)
  }))
}
