import type { StagedChange } from '@shared/assistant-runtime'

const STAGE_PREVIEW_LENGTH = 1200

export function toStageResponse(change: StagedChange, detail?: boolean): StagedChange
export function toStageResponse(change: null | undefined, detail?: boolean): null
export function toStageResponse(change: StagedChange | null | undefined, detail?: boolean): StagedChange | null
export function toStageResponse(
  change: StagedChange | null | undefined,
  detail = false
): StagedChange | null {
  if (!change) return null
  if (detail) return { ...change, detailLoaded: true }

  const preview = (value: string) => value.length > STAGE_PREVIEW_LENGTH
    ? `${value.slice(0, STAGE_PREVIEW_LENGTH)}…`
    : value
  const response = {
    ...change,
    before: preview(change.before),
    after: preview(change.after),
    detailLoaded: false
  }
  delete response.chapterHtml
  delete response.entityPayload
  return response
}
