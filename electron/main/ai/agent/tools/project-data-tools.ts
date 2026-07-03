import { ensureWorkspaceDb } from '../../../workspace-store'
import type { Tool, ToolHandlerResult } from './types'

type WorkspaceDb = Awaited<ReturnType<typeof ensureWorkspaceDb>>

function ok(content: string): ToolHandlerResult {
  return { content }
}

function err(message: string): ToolHandlerResult {
  return { content: message, isError: true }
}

type EntityType =
  | 'worldview'
  | 'characters'
  | 'organizations'
  | 'organization_memberships'
  | 'relationships'
  | 'outline'
  | 'chapters'
  | 'plot_threads'
  | 'inspiration'
  | 'knowledge'
  | 'available_deconstructions'
  | 'deconstruction_library'
  | 'reference_works'
  | 'workflow_documents'
  | 'project_constraints'

const ENTITY_TYPES: readonly EntityType[] = [
  'worldview',
  'characters',
  'organizations',
  'organization_memberships',
  'relationships',
  'outline',
  'chapters',
  'plot_threads',
  'inspiration',
  'knowledge',
  'available_deconstructions',
  'deconstruction_library',
  'reference_works',
  'workflow_documents',
  'project_constraints'
]

const ENTITY_TYPE_SET = new Set<string>(ENTITY_TYPES)

export function createProjectDataTools(): Tool[] {
  const readProjectData: Tool = {
    definition: {
      name: 'read_project_data',
      description: 'Read current project data by module. Omit entity_type to get a lightweight index first. Use available_deconstructions for the public deconstruction/reference-work library available to all projects. Supports targeted reads with entity_id, summary_only, limit, and doc_key (for workflow_documents).',
      inputSchema: {
        type: 'object',
        properties: {
          entity_type: {
            type: 'string',
            enum: [...ENTITY_TYPES],
            description: 'The project data module to read. Omit to get an index.'
          },
          entity_id: {
            type: 'string',
            description: 'Optional. Read a single entity by ID when supported.'
          },
          summary_only: {
            type: 'boolean',
            description: 'Optional. Return concise summaries or index-style rows instead of full content.'
          },
          limit: {
            type: 'integer',
            description: 'Optional. Limit how many rows are returned when reading a full module.'
          },
          doc_key: {
            type: 'string',
            description: 'Optional. For workflow_documents, read a specific document by doc_key.'
          }
        }
      }
    },
    handler: async (input, ctx) => {
      try {
        if (!ctx.projectId) {
          return err('Missing projectId')
        }

        const entityType = typeof input.entity_type === 'string' ? input.entity_type.trim() : ''
        const entityId = typeof input.entity_id === 'string' ? input.entity_id.trim() : ''
        const summaryOnly = input.summary_only === true
        const limit = typeof input.limit === 'number' && Number.isFinite(input.limit)
          ? Math.max(1, Math.min(Math.floor(input.limit), 20))
          : undefined
        const docKey = typeof input.doc_key === 'string' ? input.doc_key.trim() : ''

        if (!entityType) {
          return ok(await buildIndex(ctx.projectId))
        }

        if (!ENTITY_TYPE_SET.has(entityType)) {
          return err(`Unsupported entity_type: ${entityType}. Available: ${ENTITY_TYPES.join(', ')}`)
        }

        return ok(await readEntities(ctx.projectId, {
          type: entityType as EntityType,
          entityId,
          summaryOnly,
          limit,
          docKey
        }))
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error))
      }
    }
  }

  return [readProjectData]
}

async function buildIndex(projectId: string): Promise<string> {
  const db = await ensureWorkspaceDb()
  const sections: string[] = []

  const worldview = db.prepare('SELECT id, title FROM worldview_entries WHERE project_id = ?').all(projectId) as { id: string; title: string }[]
  if (worldview.length) sections.push(`## Worldview (${worldview.length})\n${worldview.map((item) => `- [${item.id}] ${item.title}`).join('\n')}`)

  const characters = db.prepare('SELECT id, name, role FROM characters WHERE project_id = ?').all(projectId) as { id: string; name: string; role: string }[]
  if (characters.length) sections.push(`## Characters (${characters.length})\n${characters.map((item) => `- [${item.id}] ${item.name}${item.role ? ` (${item.role})` : ''}`).join('\n')}`)

  const organizations = db.prepare('SELECT id, name FROM organizations WHERE project_id = ?').all(projectId) as { id: string; name: string }[]
  if (organizations.length) sections.push(`## Organizations (${organizations.length})\n${organizations.map((item) => `- [${item.id}] ${item.name}`).join('\n')}`)

  const memberships = db.prepare('SELECT id, character_id, organization_id, role FROM organization_memberships WHERE project_id = ?').all(projectId) as { id: string; character_id: string; organization_id: string; role: string }[]
  if (memberships.length) sections.push(`## Organization Memberships (${memberships.length})\n${memberships.map((item) => `- [${item.id}] ${item.character_id} -> ${item.organization_id}${item.role ? ` (${item.role})` : ''}`).join('\n')}`)

  const relationships = db.prepare('SELECT id, from_character_id, to_character_id, type FROM character_relationships WHERE project_id = ?').all(projectId) as { id: string; from_character_id: string; to_character_id: string; type: string }[]
  if (relationships.length) sections.push(`## Relationships (${relationships.length})\n${relationships.map((item) => `- [${item.id}] ${item.from_character_id} -> ${item.to_character_id}${item.type ? ` (${item.type})` : ''}`).join('\n')}`)

  const outline = db.prepare('SELECT id, title FROM outline_items WHERE project_id = ? ORDER BY sort_order').all(projectId) as { id: string; title: string }[]
  if (outline.length) sections.push(`## Outline (${outline.length})\n${outline.map((item, index) => `- ${index + 1}. [${item.id}] ${item.title}`).join('\n')}`)

  const chapters = db.prepare('SELECT id, title, status FROM chapters WHERE project_id = ? ORDER BY sort_order').all(projectId) as { id: string; title: string; status: string }[]
  if (chapters.length) sections.push(`## Chapters (${chapters.length})\n${chapters.map((item) => `- [${item.id}] ${item.title}${item.status ? ` (${item.status})` : ''}`).join('\n')}`)

  const plotThreads = db.prepare('SELECT id, title, status FROM plot_threads WHERE project_id = ?').all(projectId) as { id: string; title: string; status: string }[]
  if (plotThreads.length) sections.push(`## Plot Threads (${plotThreads.length})\n${plotThreads.map((item) => `- [${item.id}] ${item.title}${item.status ? ` (${item.status})` : ''}`).join('\n')}`)

  const inspiration = db.prepare('SELECT id, title FROM inspiration_entries WHERE project_id = ?').all(projectId) as { id: string; title: string }[]
  if (inspiration.length) sections.push(`## Inspiration (${inspiration.length})\n${inspiration.map((item) => `- [${item.id}] ${item.title}`).join('\n')}`)

  const knowledge = db.prepare('SELECT id, title FROM knowledge_documents WHERE project_id = ?').all(projectId) as { id: string; title: string }[]
  if (knowledge.length) sections.push(`## Knowledge (${knowledge.length})\n${knowledge.map((item) => `- [${item.id}] ${item.title}`).join('\n')}`)

  const availableDeconstructions = readPublicReferenceWorks(db)
  if (availableDeconstructions.rows.length) {
    sections.push(`## Available Deconstructions (${availableDeconstructions.rows.length})\n${availableDeconstructions.rows.map((item) => `- [${String(item.id)}] ${String(item.title)}`).join('\n')}`)
  }

  const deconstruction = db.prepare("SELECT id, title FROM knowledge_documents WHERE project_id = '' OR project_id IS NULL").all() as { id: string; title: string }[]
  if (deconstruction.length) sections.push(`## Deconstruction Library (${deconstruction.length})\n${deconstruction.map((item) => `- [${item.id}] ${item.title}`).join('\n')}`)

  const referenceWorks = db.prepare('SELECT id, title FROM reference_works ORDER BY created_at DESC, rowid DESC').all() as { id: string; title: string }[]
  if (referenceWorks.length) sections.push(`## Reference Works (${referenceWorks.length})\n${referenceWorks.map((item) => `- [${item.id}] ${item.title}`).join('\n')}`)

  const workflowDocuments = db.prepare('SELECT id, title, doc_key FROM workflow_documents WHERE project_id = ? ORDER BY sort_order').all(projectId) as { id: string; title: string; doc_key: string }[]
  if (workflowDocuments.length) sections.push(`## Creative Memory (${workflowDocuments.length})\n${workflowDocuments.map((item) => `- [${item.id}] ${item.title} (${item.doc_key})`).join('\n')}`)

  const constraints = db.prepare(`
    SELECT id, title
    FROM knowledge_documents
    WHERE project_id = ? AND source_type = 'canon-fact' AND source_label = 'global-constraint'
    ORDER BY updated_at DESC
  `).all(projectId) as { id: string; title: string }[]
  if (constraints.length) sections.push(`## Project Constraints (${constraints.length})\n${constraints.map((item) => `- [${item.id}] ${item.title}`).join('\n')}`)

  return sections.length ? sections.join('\n\n') : 'No project data found.'
}

type ReadEntitiesOptions = {
  type: EntityType
  entityId: string
  summaryOnly: boolean
  limit?: number
  docKey: string
}

function applyLimit<T>(rows: T[], limit?: number): T[] {
  return typeof limit === 'number' ? rows.slice(0, limit) : rows
}

function withLimitNote(body: string, originalCount: number, limit?: number): string {
  if (typeof limit === 'number' && originalCount > limit) {
    return `${body}\n\n(Showing ${limit} of ${originalCount} items.)`
  }
  return body
}

function normalizeNaturalRef(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[《》「」『』“”"']/g, '')
}

function parseOrdinalRef(value: string): number | null {
  const normalized = normalizeNaturalRef(value)
  const arabic = normalized.match(/^第?(\d+)章?$/)
  if (arabic) return Number(arabic[1])

  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  }
  const chinese = normalized.match(/^第?([零一二两三四五六七八九十百]+)章?$/)
  if (!chinese) return null
  const raw = chinese[1]
  if (raw === '十') return 10
  const tenIndex = raw.indexOf('十')
  if (tenIndex >= 0) {
    const before = raw.slice(0, tenIndex)
    const after = raw.slice(tenIndex + 1)
    const tens = before ? digits[before] ?? 0 : 1
    const ones = after ? digits[after] ?? 0 : 0
    return tens * 10 + ones
  }
  return digits[raw] ?? null
}

function resolveOrderedEntity<T extends { id: string; title: string }>(
  rows: T[],
  ref: string
): T | undefined {
  const rawRef = ref.trim()
  const direct = rows.find((row) => row.id === rawRef)
  if (direct) return direct

  const ordinal = parseOrdinalRef(rawRef)
  if (ordinal !== null && ordinal >= 1 && ordinal <= rows.length) {
    return rows[ordinal - 1]
  }

  const normalizedRef = normalizeNaturalRef(rawRef)
  const exact = rows.find((row) => normalizeNaturalRef(row.title) === normalizedRef)
  if (exact) return exact

  const contains = rows.filter((row) => normalizeNaturalRef(row.title).includes(normalizedRef))
  return contains.length === 1 ? contains[0] : undefined
}

async function readEntities(projectId: string, options: ReadEntitiesOptions): Promise<string> {
  const db = await ensureWorkspaceDb()
  const { type, entityId, summaryOnly, limit, docKey } = options

  switch (type) {
    case 'worldview': {
      if (entityId) {
        const row = db.prepare('SELECT title, content FROM worldview_entries WHERE id = ? AND project_id = ?').get(entityId, projectId) as { title: string; content: string } | undefined
        if (!row) return `Worldview entry not found: ${entityId}`
        return summaryOnly ? `# ${row.title}\n\n${truncateText(row.content, 400)}` : `# ${row.title}\n\n${row.content}`
      }
      const rows = db.prepare('SELECT id, title, content FROM worldview_entries WHERE project_id = ? ORDER BY sort_order').all(projectId) as { id: string; title: string; content: string }[]
      if (!rows.length) return 'No worldview entries.'
      const limitedRows = applyLimit(rows, limit)
      const body = summaryOnly
        ? limitedRows.map((row) => `- [${row.id}] ${row.title}: ${truncateText(row.content, 140)}`).join('\n')
        : limitedRows.map((row) => `# ${row.title}\n\n${row.content}`).join('\n\n---\n\n')
      return withLimitNote(body, rows.length, limit)
    }
    case 'characters': {
      if (entityId) {
        const row = db.prepare('SELECT name, role, description FROM characters WHERE id = ? AND project_id = ?').get(entityId, projectId) as { name: string; role: string; description: string } | undefined
        if (!row) return `Character not found: ${entityId}`
        return summaryOnly
          ? `# ${row.name}${row.role ? ` (${row.role})` : ''}\n\n${truncateText(row.description, 320)}`
          : `# ${row.name}${row.role ? ` (${row.role})` : ''}\n\n${row.description}`
      }
      const rows = db.prepare('SELECT id, name, role, description FROM characters WHERE project_id = ?').all(projectId) as { id: string; name: string; role: string; description: string }[]
      if (!rows.length) return 'No characters.'
      const limitedRows = applyLimit(rows, limit)
      const body = summaryOnly
        ? limitedRows.map((row) => `- [${row.id}] ${row.name}${row.role ? ` (${row.role})` : ''}: ${truncateText(row.description, 120)}`).join('\n')
        : limitedRows.map((row) => `# ${row.name}${row.role ? ` (${row.role})` : ''}\n${row.description}`).join('\n\n---\n\n')
      return withLimitNote(body, rows.length, limit)
    }
    case 'organizations': {
      if (entityId) {
        const row = db.prepare('SELECT name, type, description, motto FROM organizations WHERE id = ? AND project_id = ?').get(entityId, projectId) as { name: string; type: string; description: string; motto: string } | undefined
        if (!row) return `Organization not found: ${entityId}`
        return summaryOnly
          ? [`# ${row.name}${row.type ? ` (${row.type})` : ''}`, truncateText(row.description, 240), row.motto ? `Motto: ${row.motto}` : ''].filter(Boolean).join('\n\n')
          : [`# ${row.name}${row.type ? ` (${row.type})` : ''}`, row.description, row.motto ? `Motto: ${row.motto}` : ''].filter(Boolean).join('\n\n')
      }
      const rows = db.prepare('SELECT id, name, type, description FROM organizations WHERE project_id = ?').all(projectId) as { id: string; name: string; type: string; description: string }[]
      if (!rows.length) return 'No organizations.'
      const limitedRows = applyLimit(rows, limit)
      const body = summaryOnly
        ? limitedRows.map((row) => `- [${row.id}] ${row.name}${row.type ? ` (${row.type})` : ''}: ${truncateText(row.description, 120)}`).join('\n')
        : limitedRows.map((row) => `# ${row.name}${row.type ? ` (${row.type})` : ''}\n${row.description}`).join('\n\n---\n\n')
      return withLimitNote(body, rows.length, limit)
    }
    case 'relationships': {
      const chars = db.prepare('SELECT id, name FROM characters WHERE project_id = ?').all(projectId) as { id: string; name: string }[]
      const charMap = new Map(chars.map((item) => [item.id, item.name]))
      if (entityId) {
        const row = db.prepare('SELECT id, from_character_id, to_character_id, type, description, intensity FROM character_relationships WHERE id = ? AND project_id = ?').get(entityId, projectId) as Record<string, unknown> | undefined
        if (!row) return `Relationship not found: ${entityId}`
        const from = charMap.get(String(row.from_character_id)) ?? String(row.from_character_id)
        const to = charMap.get(String(row.to_character_id)) ?? String(row.to_character_id)
        const description = String(row.description ?? '').trim()
        const title = `${from} -> ${to}${row.type ? ` (${String(row.type)})` : ''}`
        return summaryOnly
          ? `${title}\nIntensity: ${String(row.intensity ?? '')}\n${truncateText(description, 320)}`
          : `${title}\nIntensity: ${String(row.intensity ?? '')}\n\n${description}`
      }
      const rows = db.prepare('SELECT id, from_character_id, to_character_id, type, description, intensity FROM character_relationships WHERE project_id = ?').all(projectId) as Array<Record<string, unknown>>
      if (!rows.length) return 'No relationships.'
      const limitedRows = applyLimit(rows, limit)
      const body = limitedRows.map((row) => {
        const from = charMap.get(String(row.from_character_id)) ?? String(row.from_character_id)
        const to = charMap.get(String(row.to_character_id)) ?? String(row.to_character_id)
        const typeLabel = String(row.type ?? '').trim()
        const description = String(row.description ?? '').trim()
        const intensity = row.intensity == null ? '' : `Intensity: ${String(row.intensity)}`
        if (summaryOnly) {
          return `- [${String(row.id)}] ${from} -> ${to}${typeLabel ? ` (${typeLabel})` : ''}${description ? `: ${truncateText(description, 100)}` : ''}`
        }
        return [`${from} -> ${to}${typeLabel ? ` (${typeLabel})` : ''}`, intensity, description].filter(Boolean).join('\n')
      }).join(summaryOnly ? '\n' : '\n\n')
      return withLimitNote(body, rows.length, limit)
    }
    case 'organization_memberships': {
      const chars = db.prepare('SELECT id, name FROM characters WHERE project_id = ?').all(projectId) as { id: string; name: string }[]
      const orgs = db.prepare('SELECT id, name FROM organizations WHERE project_id = ?').all(projectId) as { id: string; name: string }[]
      const charMap = new Map(chars.map((item) => [item.id, item.name]))
      const orgMap = new Map(orgs.map((item) => [item.id, item.name]))
      if (entityId) {
        const row = db.prepare('SELECT id, character_id, organization_id, role, notes FROM organization_memberships WHERE id = ? AND project_id = ?').get(entityId, projectId) as Record<string, unknown> | undefined
        if (!row) return `Organization membership not found: ${entityId}`
        const character = charMap.get(String(row.character_id)) ?? String(row.character_id)
        const organization = orgMap.get(String(row.organization_id)) ?? String(row.organization_id)
        const role = String(row.role ?? '').trim()
        const notes = String(row.notes ?? '').trim()
        return summaryOnly
          ? `${character} -> ${organization}${role ? ` (${role})` : ''}${notes ? `: ${truncateText(notes, 240)}` : ''}`
          : [`${character} -> ${organization}${role ? ` (${role})` : ''}`, notes].filter(Boolean).join('\n\n')
      }
      const rows = db.prepare('SELECT id, character_id, organization_id, role, notes FROM organization_memberships WHERE project_id = ?').all(projectId) as Array<Record<string, unknown>>
      if (!rows.length) return 'No organization memberships.'
      const limitedRows = applyLimit(rows, limit)
      const body = limitedRows.map((row) => {
        const character = charMap.get(String(row.character_id)) ?? String(row.character_id)
        const organization = orgMap.get(String(row.organization_id)) ?? String(row.organization_id)
        const role = String(row.role ?? '').trim()
        const notes = String(row.notes ?? '').trim()
        if (summaryOnly) {
          return `- [${String(row.id)}] ${character} -> ${organization}${role ? ` (${role})` : ''}${notes ? `: ${truncateText(notes, 100)}` : ''}`
        }
        return [`${character} -> ${organization}${role ? ` (${role})` : ''}`, notes].filter(Boolean).join('\n')
      }).join(summaryOnly ? '\n' : '\n\n')
      return withLimitNote(body, rows.length, limit)
    }
    case 'outline': {
      const rows = db.prepare('SELECT id, title, summary, conflict, word_target FROM outline_items WHERE project_id = ? ORDER BY sort_order').all(projectId) as { id: string; title: string; summary: string; conflict: string; word_target: string }[]
      if (!rows.length) return 'No outline items.'
      if (entityId) {
        const row = resolveOrderedEntity(rows, entityId)
        if (!row) return `Outline item not found: ${entityId}`
        return [`## ${row.title}`, row.summary, row.conflict ? `Conflict: ${row.conflict}` : '', row.word_target ? `Word target: ${row.word_target}` : ''].filter(Boolean).join('\n')
      }
      const limitedRows = applyLimit(rows, limit)
      const body = summaryOnly
        ? limitedRows.map((row, index) => `- ${index + 1}. [${row.id}] ${row.title}: ${truncateText(row.summary, 120)}`).join('\n')
        : limitedRows.map((row, index) => `## ${index + 1}. ${row.title}\n${row.summary}${row.conflict ? `\nConflict: ${row.conflict}` : ''}`).join('\n\n')
      return withLimitNote(body, rows.length, limit)
    }
    case 'chapters': {
      if (entityId) {
        const row = db.prepare('SELECT id, title, summary, status, word_target, content, sort_order FROM chapters WHERE id = ? AND project_id = ?').get(entityId, projectId) as Record<string, unknown> | undefined
        if (!row) return `Chapter not found: ${entityId}`
        const content = stripHtml(String(row.content ?? ''))
        return summaryOnly
          ? [
              `# ${String(row.title)}`,
              `Status: ${String(row.status)}`,
              `Word target: ${String(row.word_target)}`,
              `Summary: ${String(row.summary || '(none)')}`,
              '',
              truncateText(content, 800)
            ].join('\n')
          : [
              `# ${String(row.title)}`,
              `Status: ${String(row.status)}`,
              `Word target: ${String(row.word_target)}`,
              `Summary: ${String(row.summary || '(none)')}`,
              '',
              content.length > 15000 ? `${content.slice(0, 15000)}\n...(truncated)` : content
            ].join('\n')
      }
      const rows = db.prepare('SELECT id, title, summary, status, content FROM chapters WHERE project_id = ? ORDER BY sort_order').all(projectId) as Array<Record<string, unknown>>
      if (!rows.length) return 'No chapters.'
      const limitedRows = applyLimit(rows, limit)
      const body = summaryOnly
        ? limitedRows.map((row) => `- [${String(row.id)}] ${String(row.title)} (${String(row.status)}): ${truncateText(String(row.summary ?? ''), 140)}`).join('\n')
        : limitedRows.map((row) => {
            const content = stripHtml(String(row.content ?? ''))
            return `# ${String(row.title)} (${String(row.status)})\nSummary: ${String(row.summary || '(none)')}\n\n${truncateText(content, 1200)}`
          }).join('\n\n---\n\n')
      return withLimitNote(body, rows.length, limit)
    }
    case 'plot_threads': {
      if (entityId) {
        const row = db.prepare('SELECT id, title, description, status, opened_in_chapter_id, closed_in_chapter_id, tags_json, updated_at FROM plot_threads WHERE id = ? AND project_id = ?').get(entityId, projectId) as Record<string, unknown> | undefined
        if (!row) return `Plot thread not found: ${entityId}`
        const tags = safeParseArray(row.tags_json)
        return [
          `# ${String(row.title)} (${String(row.status)})`,
          String(row.opened_in_chapter_id) ? `Opened in chapter: ${String(row.opened_in_chapter_id)}` : '',
          String(row.closed_in_chapter_id) ? `Closed in chapter: ${String(row.closed_in_chapter_id)}` : '',
          tags.length ? `Tags: ${tags.join(', ')}` : '',
          `Updated: ${String(row.updated_at ?? '')}`,
          '',
          summaryOnly ? truncateText(String(row.description ?? ''), 500) : String(row.description ?? '')
        ].filter(Boolean).join('\n')
      }
      const rows = db.prepare('SELECT id, title, description, status FROM plot_threads WHERE project_id = ?').all(projectId) as { id: string; title: string; description: string; status: string }[]
      if (!rows.length) return 'No plot threads.'
      const limitedRows = applyLimit(rows, limit)
      const body = summaryOnly
        ? limitedRows.map((row) => `- [${row.id}] ${row.title}${row.status ? ` (${row.status})` : ''}: ${truncateText(row.description, 120)}`).join('\n')
        : limitedRows.map((row) => `## ${row.title}${row.status ? ` (${row.status})` : ''}\n${row.description}`).join('\n\n')
      return withLimitNote(body, rows.length, limit)
    }
    case 'inspiration': {
      if (entityId) {
        const row = db.prepare('SELECT title, content, source FROM inspiration_entries WHERE id = ? AND project_id = ?').get(entityId, projectId) as { title: string; content: string; source: string } | undefined
        if (!row) return `Inspiration entry not found: ${entityId}`
        return summaryOnly
          ? `# ${row.title}\nSource: ${row.source || 'unknown'}\n\n${truncateText(row.content, 320)}`
          : `# ${row.title}\nSource: ${row.source || 'unknown'}\n\n${row.content}`
      }
      const rows = db.prepare('SELECT id, title, content FROM inspiration_entries WHERE project_id = ?').all(projectId) as { id: string; title: string; content: string }[]
      if (!rows.length) return 'No inspiration entries.'
      const limitedRows = applyLimit(rows, limit)
      const body = summaryOnly
        ? limitedRows.map((row) => `- [${row.id}] ${row.title}: ${truncateText(row.content, 120)}`).join('\n')
        : limitedRows.map((row) => `## ${row.title}\n${row.content}`).join('\n\n')
      return withLimitNote(body, rows.length, limit)
    }
    case 'knowledge': {
      if (entityId) {
        const row = db.prepare('SELECT title, content, summary, source_label FROM knowledge_documents WHERE id = ? AND project_id = ?').get(entityId, projectId) as { title: string; content: string; summary: string; source_label: string } | undefined
        if (!row) return `Knowledge document not found: ${entityId}`
        return summaryOnly
          ? [`# ${row.title}`, row.source_label ? `Source: ${row.source_label}` : '', row.summary ? `Summary: ${row.summary}` : '', '', truncateText(row.content, 500)].filter(Boolean).join('\n')
          : [`# ${row.title}`, row.source_label ? `Source: ${row.source_label}` : '', row.summary ? `Summary: ${row.summary}` : '', '', row.content].filter(Boolean).join('\n')
      }
      const rows = db.prepare('SELECT id, title, summary FROM knowledge_documents WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as { id: string; title: string; summary: string }[]
      if (!rows.length) return 'No project knowledge documents.'
      const limitedRows = applyLimit(rows, limit)
      const body = limitedRows.map((row) => `- [${row.id}] ${row.title}: ${row.summary || '(no summary)'}`).join('\n')
      return withLimitNote(body, rows.length, limit)
    }
    case 'available_deconstructions': {
      const available = readPublicReferenceWorks(db)
      if (entityId) {
        const row = available.rows.find((item) => String(item.id) === entityId)
        if (!row) return `Available deconstruction not found: ${entityId}`
        const analysis = safeParseJson(String(row.analysis_json ?? '{}'))
        const analysisText = formatReferenceAnalysis(analysis, summaryOnly)
        return [
          `# ${String(row.title)}`,
          String(row.source) ? `Source: ${String(row.source)}` : '',
          String(row.file_name) ? `File: ${String(row.file_name)}` : '',
          'Scope: public deconstruction library',
          `Updated: ${String(row.updated_at ?? '')}`,
          String(row.notes) ? `Notes: ${String(row.notes)}` : '',
          analysisText ? `\n${analysisText}` : ''
        ].filter(Boolean).join('\n')
      }
      if (!available.rows.length) {
        return 'No available deconstructions. No reference works have been imported.'
      }
      const limitedRows = applyLimit(available.rows, limit)
      const body = [
        `Public deconstruction library: ${available.rows.length} reference work(s).`,
        limitedRows.map(formatReferenceWorkListItem).join('\n')
      ].filter(Boolean).join('\n')
      return withLimitNote(body, available.rows.length, limit)
    }
    case 'deconstruction_library': {
      if (entityId) {
        const row = db.prepare("SELECT title, content, summary FROM knowledge_documents WHERE id = ? AND (project_id = '' OR project_id IS NULL)").get(entityId) as { title: string; content: string; summary: string } | undefined
        if (!row) return `Deconstruction document not found: ${entityId}`
        return summaryOnly
          ? [`# ${row.title}`, row.summary ? `Summary: ${row.summary}` : '', '', truncateText(row.content, 500)].filter(Boolean).join('\n')
          : [`# ${row.title}`, row.summary ? `Summary: ${row.summary}` : '', '', row.content].filter(Boolean).join('\n')
      }
      const rows = db.prepare("SELECT id, title, summary, source_type FROM knowledge_documents WHERE project_id = '' OR project_id IS NULL ORDER BY updated_at DESC").all() as { id: string; title: string; summary: string; source_type: string }[]
      if (!rows.length) return 'No deconstruction documents.'
      const limitedRows = applyLimit(rows, limit)
      const body = limitedRows.map((row) => `- [${row.id}] ${row.title}${row.source_type ? ` (${row.source_type})` : ''}: ${row.summary || '(no summary)'}`).join('\n')
      return withLimitNote(body, rows.length, limit)
    }
    case 'reference_works': {
      if (entityId) {
        const row = db.prepare('SELECT title, source, notes, file_name, analysis_json, updated_at FROM reference_works WHERE id = ?').get(entityId) as Record<string, unknown> | undefined
        if (!row) return `Reference work not found: ${entityId}`
        const analysis = safeParseJson(String(row.analysis_json ?? '{}'))
        const analysisText = formatReferenceAnalysis(analysis, summaryOnly)
        return [
          `# ${String(row.title)}`,
          String(row.source) ? `Source: ${String(row.source)}` : '',
          String(row.file_name) ? `File: ${String(row.file_name)}` : '',
          `Updated: ${String(row.updated_at ?? '')}`,
          String(row.notes) ? `Notes: ${String(row.notes)}` : '',
          analysisText ? `\n${analysisText}` : ''
        ].filter(Boolean).join('\n')
      }
      const rows = db.prepare('SELECT id, title, source, notes, file_name, analysis_json FROM reference_works ORDER BY created_at DESC, rowid DESC').all() as Array<Record<string, unknown>>
      if (!rows.length) return 'No reference works.'
      const limitedRows = applyLimit(rows, limit)
      const body = limitedRows.map(formatReferenceWorkListItem).join('\n')
      return withLimitNote(body, rows.length, limit)
    }
    case 'workflow_documents': {
      if (docKey) {
        const row = db.prepare('SELECT id, title, doc_key, content, updated_at FROM workflow_documents WHERE doc_key = ? AND project_id = ?').get(docKey, projectId) as { id: string; title: string; doc_key: string; content: string; updated_at: string } | undefined
        if (!row) return `Creative memory not found for doc_key: ${docKey}`
        return summaryOnly
          ? [`# ${row.title}`, `ID: ${row.id}`, `Key: ${row.doc_key}`, `Updated: ${row.updated_at}`, '', truncateText(row.content, 500)].join('\n')
          : [`# ${row.title}`, `ID: ${row.id}`, `Key: ${row.doc_key}`, `Updated: ${row.updated_at}`, '', row.content].join('\n')
      }
      if (entityId) {
        const row = db.prepare('SELECT title, doc_key, content, updated_at FROM workflow_documents WHERE id = ? AND project_id = ?').get(entityId, projectId) as { title: string; doc_key: string; content: string; updated_at: string } | undefined
        if (!row) return `Creative memory not found: ${entityId}`
        return summaryOnly
          ? [`# ${row.title}`, `Key: ${row.doc_key}`, `Updated: ${row.updated_at}`, '', truncateText(row.content, 500)].join('\n')
          : [`# ${row.title}`, `Key: ${row.doc_key}`, `Updated: ${row.updated_at}`, '', row.content].join('\n')
      }
      const rows = db.prepare('SELECT id, title, doc_key, content, updated_at FROM workflow_documents WHERE project_id = ? ORDER BY sort_order').all(projectId) as { id: string; title: string; doc_key: string; content: string; updated_at: string }[]
      if (!rows.length) return 'No creative memory.'
      const limitedRows = applyLimit(rows, limit)
      const body = summaryOnly
        ? limitedRows.map((row) => `- [${row.id}] ${row.title} (${row.doc_key}) Updated: ${row.updated_at}`).join('\n')
        : limitedRows.map((row) => `# ${row.title}\nID: ${row.id}\nKey: ${row.doc_key}\nUpdated: ${row.updated_at}\n\n${row.content}`).join('\n\n---\n\n')
      return withLimitNote(body, rows.length, limit)
    }
    case 'project_constraints': {
      if (entityId) {
        const row = db.prepare(`
          SELECT title, content, summary, metadata_json, updated_at
          FROM knowledge_documents
          WHERE id = ? AND project_id = ? AND source_type = 'canon-fact' AND source_label = 'global-constraint'
        `).get(entityId, projectId) as { title: string; content: string; summary: string; metadata_json: string; updated_at: string } | undefined
        if (!row) return `Project constraint not found: ${entityId}`
        const metadata = safeParseJson(row.metadata_json)
        const scope = typeof metadata.scope === 'string' ? metadata.scope : ''
        return summaryOnly
          ? [`# ${row.title}`, scope ? `Scope: ${scope}` : '', `Updated: ${row.updated_at}`, row.summary ? `Summary: ${row.summary}` : '', '', truncateText(row.content, 500)].filter(Boolean).join('\n')
          : [`# ${row.title}`, scope ? `Scope: ${scope}` : '', `Updated: ${row.updated_at}`, row.summary ? `Summary: ${row.summary}` : '', '', row.content].filter(Boolean).join('\n')
      }
      const rows = db.prepare(`
        SELECT id, title, content, summary, metadata_json, updated_at
        FROM knowledge_documents
        WHERE project_id = ? AND source_type = 'canon-fact' AND source_label = 'global-constraint'
        ORDER BY updated_at DESC
      `).all(projectId) as { id: string; title: string; content: string; summary: string; metadata_json: string; updated_at: string }[]
      if (!rows.length) return 'No project constraints.'
      const limitedRows = applyLimit(rows, limit)
      const body = limitedRows.map((row) => {
        const metadata = safeParseJson(row.metadata_json)
        const scope = typeof metadata.scope === 'string' ? ` (${metadata.scope})` : ''
        if (summaryOnly) {
          return `- [${row.id}] ${row.title}${scope}: ${row.summary || truncateText(row.content, 120)}`
        }
        return `# ${row.title}${scope}\nUpdated: ${row.updated_at}\n${row.summary ? `Summary: ${row.summary}\n` : ''}\n${row.content}`
      }).join(summaryOnly ? '\n' : '\n\n---\n\n')
      return withLimitNote(body, rows.length, limit)
    }
  }
}

function safeParseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

type PublicReferenceWorks = {
  rows: Array<Record<string, unknown>>
}

function readPublicReferenceWorks(db: WorkspaceDb): PublicReferenceWorks {
  const rows = db.prepare('SELECT id, title, source, notes, file_name, analysis_json, updated_at FROM reference_works ORDER BY created_at DESC, rowid DESC').all() as Array<Record<string, unknown>>
  return { rows }
}

function formatReferenceWorkListItem(row: Record<string, unknown>): string {
  const analysis = safeParseJson(String(row.analysis_json ?? '{}'))
  const overview = typeof analysis.overview === 'string' ? analysis.overview : ''
  return `- [${String(row.id)}] ${String(row.title)}${row.file_name ? ` (${String(row.file_name)})` : ''}: ${truncateText(overview || String(row.notes ?? ''), 160)}`
}

function safeParseArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'))
    return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

function formatReferenceAnalysis(analysis: Record<string, unknown>, summaryOnly: boolean): string {
  const fields = [
    ['Overview', analysis.overview],
    ['Sentence Style', analysis.sentenceStyle],
    ['Dialogue Ratio', analysis.dialogueRatio],
    ['Pacing Control', analysis.pacingControl],
    ['Emotion Expression', analysis.emotionExpression],
    ['Narrative Perspective', analysis.narrativePerspective],
    ['Reusable Style Prompt', analysis.reusableStylePrompt]
  ]
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => `${label}: ${summaryOnly ? truncateText(String(value), 360) : String(value)}`)

  const topKeywords = Array.isArray(analysis.topKeywords)
    ? analysis.topKeywords.map((item) => String(item).trim()).filter(Boolean)
    : []
  if (topKeywords.length) {
    fields.unshift(`Keywords: ${topKeywords.join(', ')}`)
  }

  return fields.join('\n\n')
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
}
