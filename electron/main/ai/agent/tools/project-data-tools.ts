import { ensureWorkspaceDb } from '../../../workspace-store'
import type { Tool, ToolHandlerResult } from './types'

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
  | 'relationships'
  | 'outline'
  | 'plot_threads'
  | 'inspiration'
  | 'knowledge'
  | 'deconstruction_library'
  | 'workflow_documents'
  | 'project_constraints'

const ENTITY_TYPES: readonly EntityType[] = [
  'worldview',
  'characters',
  'organizations',
  'relationships',
  'outline',
  'plot_threads',
  'inspiration',
  'knowledge',
  'deconstruction_library',
  'workflow_documents',
  'project_constraints'
]

const ENTITY_TYPE_SET = new Set<string>(ENTITY_TYPES)

export function createProjectDataTools(): Tool[] {
  const readProjectData: Tool = {
    definition: {
      name: 'read_project_data',
      description: 'Read current project data by module. Omit entity_type to get a lightweight index first. Supports targeted reads with entity_id, summary_only, limit, and doc_key (for workflow_documents).',
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

  const relationships = db.prepare('SELECT id, from_character_id, to_character_id, type FROM character_relationships WHERE project_id = ?').all(projectId) as { id: string; from_character_id: string; to_character_id: string; type: string }[]
  if (relationships.length) sections.push(`## Relationships (${relationships.length})\n${relationships.map((item) => `- [${item.id}] ${item.from_character_id} -> ${item.to_character_id}${item.type ? ` (${item.type})` : ''}`).join('\n')}`)

  const outline = db.prepare('SELECT id, title FROM outline_items WHERE project_id = ?').all(projectId) as { id: string; title: string }[]
  if (outline.length) sections.push(`## Outline (${outline.length})\n${outline.map((item) => `- [${item.id}] ${item.title}`).join('\n')}`)

  const plotThreads = db.prepare('SELECT id, title, status FROM plot_threads WHERE project_id = ?').all(projectId) as { id: string; title: string; status: string }[]
  if (plotThreads.length) sections.push(`## Plot Threads (${plotThreads.length})\n${plotThreads.map((item) => `- [${item.id}] ${item.title}${item.status ? ` (${item.status})` : ''}`).join('\n')}`)

  const inspiration = db.prepare('SELECT id, title FROM inspiration_entries WHERE project_id = ?').all(projectId) as { id: string; title: string }[]
  if (inspiration.length) sections.push(`## Inspiration (${inspiration.length})\n${inspiration.map((item) => `- [${item.id}] ${item.title}`).join('\n')}`)

  const knowledge = db.prepare('SELECT id, title FROM knowledge_documents WHERE project_id = ?').all(projectId) as { id: string; title: string }[]
  if (knowledge.length) sections.push(`## Knowledge (${knowledge.length})\n${knowledge.map((item) => `- [${item.id}] ${item.title}`).join('\n')}`)

  const deconstruction = db.prepare("SELECT id, title FROM knowledge_documents WHERE project_id = '' OR project_id IS NULL").all() as { id: string; title: string }[]
  if (deconstruction.length) sections.push(`## Deconstruction Library (${deconstruction.length})\n${deconstruction.map((item) => `- [${item.id}] ${item.title}`).join('\n')}`)

  const workflowDocuments = db.prepare('SELECT id, title, doc_key FROM workflow_documents WHERE project_id = ? ORDER BY sort_order').all(projectId) as { id: string; title: string; doc_key: string }[]
  if (workflowDocuments.length) sections.push(`## Workflow Documents (${workflowDocuments.length})\n${workflowDocuments.map((item) => `- [${item.id}] ${item.title} (${item.doc_key})`).join('\n')}`)

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
    case 'outline': {
      if (entityId) {
        const row = db.prepare('SELECT title, summary, conflict, word_target FROM outline_items WHERE id = ? AND project_id = ?').get(entityId, projectId) as { title: string; summary: string; conflict: string; word_target: string } | undefined
        if (!row) return `Outline item not found: ${entityId}`
        return [`## ${row.title}`, row.summary, row.conflict ? `Conflict: ${row.conflict}` : '', row.word_target ? `Word target: ${row.word_target}` : ''].filter(Boolean).join('\n')
      }
      const rows = db.prepare('SELECT id, title, summary, conflict FROM outline_items WHERE project_id = ? ORDER BY sort_order').all(projectId) as { id: string; title: string; summary: string; conflict: string }[]
      if (!rows.length) return 'No outline items.'
      const limitedRows = applyLimit(rows, limit)
      const body = summaryOnly
        ? limitedRows.map((row) => `- [${row.id}] ${row.title}: ${truncateText(row.summary, 120)}`).join('\n')
        : limitedRows.map((row) => `## ${row.title}\n${row.summary}${row.conflict ? `\nConflict: ${row.conflict}` : ''}`).join('\n\n')
      return withLimitNote(body, rows.length, limit)
    }
    case 'plot_threads': {
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
    case 'workflow_documents': {
      if (docKey) {
        const row = db.prepare('SELECT id, title, doc_key, content, updated_at FROM workflow_documents WHERE doc_key = ? AND project_id = ?').get(docKey, projectId) as { id: string; title: string; doc_key: string; content: string; updated_at: string } | undefined
        if (!row) return `Workflow document not found for doc_key: ${docKey}`
        return summaryOnly
          ? [`# ${row.title}`, `ID: ${row.id}`, `Key: ${row.doc_key}`, `Updated: ${row.updated_at}`, '', truncateText(row.content, 500)].join('\n')
          : [`# ${row.title}`, `ID: ${row.id}`, `Key: ${row.doc_key}`, `Updated: ${row.updated_at}`, '', row.content].join('\n')
      }
      if (entityId) {
        const row = db.prepare('SELECT title, doc_key, content, updated_at FROM workflow_documents WHERE id = ? AND project_id = ?').get(entityId, projectId) as { title: string; doc_key: string; content: string; updated_at: string } | undefined
        if (!row) return `Workflow document not found: ${entityId}`
        return summaryOnly
          ? [`# ${row.title}`, `Key: ${row.doc_key}`, `Updated: ${row.updated_at}`, '', truncateText(row.content, 500)].join('\n')
          : [`# ${row.title}`, `Key: ${row.doc_key}`, `Updated: ${row.updated_at}`, '', row.content].join('\n')
      }
      const rows = db.prepare('SELECT id, title, doc_key, content, updated_at FROM workflow_documents WHERE project_id = ? ORDER BY sort_order').all(projectId) as { id: string; title: string; doc_key: string; content: string; updated_at: string }[]
      if (!rows.length) return 'No workflow documents.'
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

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
}
