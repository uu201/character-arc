import type { SkillManifest } from './types'
import type { SkillReferenceRule } from './types'

export function validateManifest(raw: Partial<SkillManifest> | null): Partial<SkillManifest> | null {
  if (!raw) return null

  return {
    category: isValidCategory(raw.category) ? raw.category : undefined,
    tasks: Array.isArray(raw.tasks) ? raw.tasks.filter((t) => typeof t === 'string') : undefined,
    stages: Array.isArray(raw.stages) ? raw.stages.filter((s) => typeof s === 'string') : undefined,
    triggers: Array.isArray(raw.triggers) ? raw.triggers.filter((t) => typeof t === 'string') : undefined,
    priority: typeof raw.priority === 'number' && raw.priority >= 0 && raw.priority <= 10 ? raw.priority : undefined,
    references: Array.isArray(raw.references) ? raw.references.filter(isValidReference) : undefined,
    required: raw.required === true ? true : undefined
  }
}

function isValidCategory(value: unknown): value is SkillManifest['category'] {
  return typeof value === 'string' && ['market', 'analysis', 'writing', 'polish', 'cover', 'tool'].includes(value)
}

function isValidReference(value: unknown): value is SkillReferenceRule {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.file === 'string' && record.file.length > 0
}
