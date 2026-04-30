import type { ChapterDraft, CharacterCard, OutlineItem, OutlineVolume, WorldviewEntry } from '@/types/app'
import { createOutlineVolume } from '@/features/workspace/outlineVolumes'

// 项目向导中用户填写的表单值
export interface ProjectWizardValues {
  title: string            // 作品标题
  genre: string            // 类型/题材
  targetWordCount: string  // 目标总字数
  premise: string          // 故事前提/梗概
  shouldGenerate: boolean  // 是否让 AI 自动生成初始大纲和世界观
}

// AI 引导生成的初始数据结构（来自 bootstrap 接口）
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

// 最终生成的项目工作区种子数据，包含项目信息和全部工作区集合
export interface ProjectWorkspaceSeed {
  project: {
    title: string
    genre: string
    wordCount: string
    cover: string
    writingStylePresetId: string
    writingStylePrompt: string
  }
  worldviewEntries: WorldviewEntry[]
  characters: CharacterCard[]
  outlineVolumes: OutlineVolume[]
  outlineItems: OutlineItem[]
  chapters: ChapterDraft[]
}

// 新项目的默认封面渐变色
const DEFAULT_PROJECT_COVER = 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)'

// 生成带前缀、索引和时间戳的唯一 ID，保证同一批次内不重复
function createSeedId(prefix: string, index: number, timestamp: number): string {
  return `${prefix}-${timestamp}-${index + 1}`
}

// 标准化目标字数，空值回退到默认的 "20万字"
function normalizeTargetWordCount(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return '20万字'
  }

  return trimmed
}

// 构建空白起始章节，用于没有 AI 生成大纲时的兜底章节
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

// 根据向导表单值和可选的 AI 引导数据，构建完整的项目工作区种子：
// 1. 创建第一个分卷
// 2. 将 bootstrap 中的大纲条目转为 OutlineItem
// 3. 将 bootstrap 中的世界观设定转为 WorldviewEntry
// 4. 若有大纲条目，将其一一映射为章节草稿；否则创建一个空白起始章节
export function createProjectWorkspaceSeed(
  values: ProjectWizardValues,
  bootstrap?: ProjectBootstrapResult | null
): ProjectWorkspaceSeed {
  const timestamp = Date.now()
  const createdAt = new Date(timestamp).toISOString()
  const firstVolumeId = createSeedId('volume', 0, timestamp)

  // 创建第一个分卷，使用向导中的字数目标和故事前提
  const outlineVolumes = [
    createOutlineVolume({
      id: firstVolumeId,
      title: '故事开端',
      wordTarget: `目标 ${normalizeTargetWordCount(values.targetWordCount)}`,
      summary: values.premise.trim() || '用于承接作品最初的主线冲突与人物出场。'
    })
  ]

  // 将 AI 生成的大纲条目转为带完整字段的 OutlineItem
  const outlineItems = (bootstrap?.outlineItems ?? []).map((item, index) => ({
    id: createSeedId('outline', index, timestamp),
    volumeId: firstVolumeId,
    title: item.title?.trim() || `第${index + 1}章：剧情节点`,
    wordTarget: item.wordTarget?.trim() || `预估 ${normalizeTargetWordCount(values.targetWordCount)}`,
    conflict: item.conflict?.trim() || '新的冲突正在酝酿。',
    summary: item.summary?.trim() || '待补充剧情摘要。',
    sortOrder: index
  }))

  // 将 AI 生成的世界观条目转为带完整字段的 WorldviewEntry
  const worldviewEntries = (bootstrap?.worldviewEntries ?? []).map((item, index) => ({
    id: createSeedId('world', index, timestamp),
    type: item.type?.trim() || '地理',
    title: item.title?.trim() || `设定条目 ${index + 1}`,
    content: item.content?.trim() || '待补充设定内容。',
    sortOrder: index,
    createdAt,
    updatedAt: createdAt
  }))

  // 若有大纲条目，每个条目对应创建一个章节草稿；否则创建空白起始章节
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
      cover: DEFAULT_PROJECT_COVER,
      writingStylePresetId: 'cinematic-cool', // 默认使用冷峻电影感写作风格
      writingStylePrompt: ''
    },
    worldviewEntries,
    characters: [],  // 初始项目无角色，由用户后续添加
    outlineVolumes,
    outlineItems,
    chapters
  }
}
