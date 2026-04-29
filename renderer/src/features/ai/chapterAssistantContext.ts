import { pickRelevantInspirationEntries } from '@/features/inspiration/relevance'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import type { ChapterDraft, CharacterCard, InspirationEntry, OutlineItem, OutlineVolume, ProjectSummary, WorldviewEntry } from '@/types/app'

type ChapterAssistantMessage = {
  role: 'user' | 'assistant'
  content: string
}

type ChapterAssistantContextInput = {
  project?: ProjectSummary
  chapter?: ChapterDraft
  chapterVolume?: OutlineVolume
  relatedChapters: Array<{
    title: string
    summary: string
    preview: string
  }>
  recentMessages: ChapterAssistantMessage[]
  worldviewEntries: WorldviewEntry[]
  characters: CharacterCard[]
  inspirationEntries: InspirationEntry[]
  outlineItems: OutlineItem[]
  selectedText: string
  responseMode: 'freeform' | 'polish' | 'continue' | 'suggest' | 'reference'
  responseLength: 'short' | 'medium' | 'long'
  quickAction?: string
  userPrompt: string
  chapterContent: string
}

export function buildChapterAssistantContext(input: ChapterAssistantContextInput): Record<string, unknown> {
  const writingStyle = buildProjectWritingStyleContext(input.project)
  const relevantInspirationEntries = pickRelevantInspirationEntries(
    input.inspirationEntries,
    {
      title: input.chapter?.title,
      summary: input.chapter?.summary,
      content: input.chapterContent
    },
    6
  )

  return {
    projectTitle: input.project?.title,
    projectGenre: input.project?.genre,
    writingStyleLabel: writingStyle.label,
    writingStylePrompt: writingStyle.prompt,
    chapterVolume: input.chapterVolume?.title,
    chapterTitle: input.chapter?.title,
    chapterSummary: input.chapter?.summary,
    chapterStatus: input.chapter?.status,
    chapterWordTarget: input.chapter?.wordTarget,
    chapterContent: input.chapterContent,
    chapterVolumeTitle: input.chapterVolume?.title,
    chapterVolumeSummary: input.chapterVolume?.summary,
    relatedChapters: input.relatedChapters,
    recentMessages: input.recentMessages,
    worldviewEntries: input.worldviewEntries.map((entry) => ({
      title: entry.title,
      content: entry.content
    })),
    characters: input.characters.map((character) => ({
      name: character.name,
      role: character.role,
      description: character.description
    })),
    inspirationEntries: relevantInspirationEntries.map((entry) => ({
      type: entry.type,
      title: entry.title,
      content: entry.content,
      tags: entry.tags
    })),
    outlineItems: input.outlineItems.map((item) => ({
      title: item.title,
      summary: item.summary
    })),
    selectedText: input.selectedText,
    responseMode: input.responseMode,
    responseLength: input.responseLength,
    quickAction: input.quickAction,
    userPrompt: input.userPrompt
  }
}
