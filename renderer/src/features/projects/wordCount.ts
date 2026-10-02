import { getChapterCharacterCount } from '@/features/chapters/editorContent'
import type { ChapterDraft } from '@/types/app'

export function calculateProjectWordCount(chapters: ChapterDraft[]): number {
  return chapters.reduce((count, chapter) => count + (
    chapter.contentLoaded === false
      ? Math.max(0, Number(chapter.contentLength ?? 0))
      : getChapterCharacterCount(chapter.content)
  ), 0)
}

export function formatProjectWordCount(chapters: ChapterDraft[]): string {
  const total = calculateProjectWordCount(chapters)
  return `${total.toLocaleString('zh-CN')} 字`
}
