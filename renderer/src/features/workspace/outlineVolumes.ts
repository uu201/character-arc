import type { ChapterDraft, OutlineItem, OutlineVolume } from '@/types/app'

// 中文数字映射表，用于将卷序号转为"第一卷"、"第二卷"等中文格式
const CHINESE_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

// 分卷默认字数目标
export const DEFAULT_VOLUME_WORD_TARGET = '目标 5万字'
// 分卷默认摘要提示文案
export const DEFAULT_VOLUME_SUMMARY = '用于承载这一卷的主线目标、阶段冲突和情绪走势。'

// 将阿拉伯数字转为中文数字字符串（支持 1-99 的范围）
function formatChineseNumber(value: number): string {
  // 10 以内直接查表
  if (value <= 10) {
    return CHINESE_NUMERALS[value - 1] ?? String(value)
  }

  // 11-19 格式为"十X"
  if (value < 20) {
    return `十${CHINESE_NUMERALS[value - 11] ?? ''}`
  }

  // 20 及以上格式为"X十Y"，如"二十三"
  const tens = Math.floor(value / 10)
  const units = value % 10
  return `${CHINESE_NUMERALS[tens - 1] ?? String(tens)}十${units ? CHINESE_NUMERALS[units - 1] ?? String(units) : ''}`
}

// 创建分卷大纲对象，所有字段均可通过 overrides 覆盖，否则使用默认值
export function createOutlineVolume(overrides?: Partial<OutlineVolume>): OutlineVolume {
  return {
    id: overrides?.id ?? `volume-${Date.now()}`,
    title: overrides?.title?.trim() || '故事开端',
    wordTarget: overrides?.wordTarget?.trim() || DEFAULT_VOLUME_WORD_TARGET,
    summary: overrides?.summary?.trim() || DEFAULT_VOLUME_SUMMARY
  }
}

// 浅拷贝分卷列表
export function cloneOutlineVolumes(outlineVolumes?: OutlineVolume[]): OutlineVolume[] {
  return outlineVolumes?.length ? outlineVolumes.map((volume) => ({ ...volume })) : []
}

// 标准化分卷标题：空白时回退为"分卷 N"格式
export function normalizeVolumeTitle(title: string, fallbackIndex: number): string {
  return title.trim() || `分卷 ${fallbackIndex}`
}

// 确保分卷、大纲条目和章节三个集合的数据一致性：
// 1. 保证至少存在一个分卷
// 2. 为引用了不存在分卷 ID 的条目/章节自动补充缺失的分卷
// 3. 将引用了无效分卷 ID 的条目/章节重定向到第一个分卷
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

  // 构建已有分卷的索引映射
  const volumeMap = new Map(outlineVolumes.map((volume) => [volume.id, volume]))
  // 收集所有被引用的分卷 ID
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

  // 若无任何分卷，自动创建一个默认分卷
  if (outlineVolumes.length === 0) {
    const firstReferencedVolumeId = Array.from(referencedVolumeIds)[0]
    outlineVolumes.push(
      createOutlineVolume({
        id: firstReferencedVolumeId || `volume-${Date.now()}`
      })
    )
    volumeMap.set(outlineVolumes[0].id, outlineVolumes[0])
  }

  // 补充被引用但不存在的分卷
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

  // 所有无效 volumeId 重定向到第一个分卷
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

// 格式化分卷显示标签，支持 'formal'（"第一卷"）和 'compact'（"卷一"）两种格式
export function formatVolumeLabel(volume: OutlineVolume, index: number, mode: 'formal' | 'compact' = 'formal'): string {
  const volumeNumber = formatChineseNumber(index + 1)
  const prefix = mode === 'formal' ? `第${volumeNumber}卷` : `卷${volumeNumber}`
  return `${prefix}：${normalizeVolumeTitle(volume.title, index + 1)}`
}

// 将条目按分卷分组，返回每个分卷及其对应的条目列表，用于分卷视图渲染
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
