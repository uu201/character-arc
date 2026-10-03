import { Mark, mergeAttributes } from '@tiptap/core'

export type ChapterRevisionSource = 'ai' | 'manual'

export type ChapterRevisionAttrs = {
  id: string
  source: ChapterRevisionSource
  color: string
  turnId?: string
  reason?: string
  createdAt: string
}

const DEFAULT_COLOR = '#FFE58F'

function normalizeRevisionColor(value: unknown): string {
  const color = String(value ?? '').trim()
  return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_COLOR
}

export const ChapterRevisionMark = Mark.create({
  name: 'chapterRevision',
  inclusive: false,

  addAttributes() {
    return {
      id: { default: '', parseHTML: (element) => element.getAttribute('data-arc-revision-id') ?? '' },
      source: { default: 'manual', parseHTML: (element) => element.getAttribute('data-arc-revision-source') ?? 'manual' },
      color: { default: DEFAULT_COLOR, parseHTML: (element) => normalizeRevisionColor(element.getAttribute('data-arc-revision-color')) },
      turnId: { default: '', parseHTML: (element) => element.getAttribute('data-arc-revision-turn-id') ?? '' },
      reason: { default: '', parseHTML: (element) => element.getAttribute('data-arc-revision-reason') ?? '' },
      createdAt: { default: '', parseHTML: (element) => element.getAttribute('data-arc-revision-created-at') ?? '' }
    }
  },

  parseHTML() {
    return [{ tag: 'mark[data-arc-revision-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const color = normalizeRevisionColor(HTMLAttributes.color)
    return [
      'mark',
      mergeAttributes({
        'data-arc-revision-id': HTMLAttributes.id,
        'data-arc-revision-source': HTMLAttributes.source,
        'data-arc-revision-color': color,
        'data-arc-revision-turn-id': HTMLAttributes.turnId || undefined,
        'data-arc-revision-reason': HTMLAttributes.reason || undefined,
        'data-arc-revision-created-at': HTMLAttributes.createdAt || undefined,
        style: `background-color: ${color}`
      }),
      0
    ]
  }
})

export function revisionAttrsFromElement(element: HTMLElement): ChapterRevisionAttrs | null {
  const id = element.dataset.arcRevisionId?.trim()
  if (!id) return null
  return {
    id,
    source: element.dataset.arcRevisionSource === 'ai' ? 'ai' : 'manual',
    color: normalizeRevisionColor(element.dataset.arcRevisionColor),
    turnId: element.dataset.arcRevisionTurnId || undefined,
    reason: element.dataset.arcRevisionReason || undefined,
    createdAt: element.dataset.arcRevisionCreatedAt || ''
  }
}
