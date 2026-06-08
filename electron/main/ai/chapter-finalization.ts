import type { StateDelta } from '../story-state-store'

export interface ChapterFinalizationPreview {
  chapterSummary: string
  stateDelta: StateDelta | null
  nextChapterBridge: string
  warnings: string[]
}

export interface ChapterFinalizationRequest {
  projectId: string
  chapterId: string
  userGuidance: string
  hasUserGuidance: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asString(item)).filter(Boolean)
}

function normalizeStateDelta(value: unknown): StateDelta | null {
  const record = asRecord(value)
  if (!Object.keys(record).length) return null

  const foreshadowing = asRecord(record.foreshadowing_delta)
  const timeline = asRecord(record.timeline)

  return {
    characters_updated: Array.isArray(record.characters_updated)
      ? record.characters_updated as StateDelta['characters_updated']
      : [],
    relationships_delta: Array.isArray(record.relationships_delta)
      ? record.relationships_delta as StateDelta['relationships_delta']
      : [],
    foreshadowing_delta: {
      planted: Array.isArray(foreshadowing.planted)
        ? foreshadowing.planted as StateDelta['foreshadowing_delta']['planted']
        : [],
      advanced: Array.isArray(foreshadowing.advanced)
        ? foreshadowing.advanced as StateDelta['foreshadowing_delta']['advanced']
        : [],
      resolved: Array.isArray(foreshadowing.resolved)
        ? foreshadowing.resolved as StateDelta['foreshadowing_delta']['resolved']
        : []
    },
    timeline: {
      story_time_elapsed: asString(timeline.story_time_elapsed),
      current_story_date: asString(timeline.current_story_date),
      events: asStringArray(timeline.events),
      world_state_changes: asStringArray(timeline.world_state_changes)
    }
  }
}

function hasStateDeltaContent(delta: StateDelta | null): boolean {
  if (!delta) return false
  return delta.characters_updated.length > 0
    || delta.relationships_delta.length > 0
    || delta.foreshadowing_delta.planted.length > 0
    || delta.foreshadowing_delta.advanced.length > 0
    || delta.foreshadowing_delta.resolved.length > 0
    || delta.timeline.events.length > 0
    || Boolean(delta.timeline.world_state_changes?.length)
}

export function normalizeFinalizationPreview(value: unknown): ChapterFinalizationPreview {
  const record = asRecord(value)
  const stateDelta = normalizeStateDelta(record.stateDelta ?? record.state_delta)

  return {
    chapterSummary: asString(record.chapterSummary ?? record.chapter_summary),
    stateDelta,
    nextChapterBridge: asString(record.nextChapterBridge ?? record.next_chapter_bridge),
    warnings: asStringArray(record.warnings)
  }
}

export function validateFinalizationPreview(preview: ChapterFinalizationPreview): boolean {
  return Boolean(
    preview.chapterSummary
      || preview.nextChapterBridge
      || hasStateDeltaContent(preview.stateDelta)
  )
}

export function normalizeFinalizationRequest(value: unknown): ChapterFinalizationRequest {
  const record = asRecord(value)
  const userGuidance = asString(record.userGuidance ?? record.user_guidance)

  return {
    projectId: asString(record.projectId ?? record.project_id),
    chapterId: asString(record.chapterId ?? record.chapter_id),
    userGuidance,
    hasUserGuidance: Boolean(userGuidance)
  }
}

export function summarizePreviewForDisplay(preview: ChapterFinalizationPreview): string {
  return [
    preview.chapterSummary,
    preview.nextChapterBridge,
    ...preview.warnings
  ].filter(Boolean).join('\n')
}
