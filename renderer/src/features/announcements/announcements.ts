import rawAnnouncements from '../../../../announcements.json'

export type AnnouncementItem = {
  title: string
  date: string
  type: 'success' | 'info' | 'warning' | 'error'
  items: string[]
}

const ANNOUNCEMENT_TYPES = new Set<AnnouncementItem['type']>(['success', 'info', 'warning', 'error'])

function normalizeAnnouncementItem(value: unknown): AnnouncementItem | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<AnnouncementItem>
  const title = String(item.title ?? '').trim()
  const date = String(item.date ?? '').trim()
  const type = ANNOUNCEMENT_TYPES.has(item.type as AnnouncementItem['type']) ? item.type as AnnouncementItem['type'] : 'info'
  const items = Array.isArray(item.items)
    ? item.items.map((line) => String(line).trim()).filter(Boolean)
    : []

  if (!title || !date || items.length === 0) return null
  return { title, date, type, items }
}

export function normalizeAnnouncements(value: unknown): AnnouncementItem[] {
  return Array.isArray(value)
    ? value.map(normalizeAnnouncementItem).filter((item): item is AnnouncementItem => Boolean(item))
    : []
}

export function resolveLatestAnnouncementDate(items: AnnouncementItem[]): string {
  return items.map((item) => item.date).sort().at(-1) ?? ''
}

export const LOCAL_ANNOUNCEMENTS = normalizeAnnouncements(rawAnnouncements)
