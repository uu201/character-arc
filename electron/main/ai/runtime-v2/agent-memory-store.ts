import { randomUUID } from 'node:crypto'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { AgentMemory, AgentMemoryKind } from '@shared/assistant-runtime'

const MAX_MEMORY_CONTENT = 1200
const MAX_MEMORIES_PER_PROJECT = 200
const VALID_KINDS = new Set<AgentMemoryKind>(['preference', 'lesson', 'fact', 'method'])

export interface AgentMemoryInput {
  projectId: string
  kind?: AgentMemoryKind
  content: string
  source?: AgentMemory['source']
  importance?: number
  sourceTurnId?: string
}

interface MemoryRow {
  id: string
  project_id: string
  kind: string
  content: string
  source: string
  importance: number
  source_turn_id: string
  created_at: string
  updated_at: string
}

function normalizeImportance(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(5, Math.max(1, Math.round(number))) : 3
}

function rowToMemory(row: MemoryRow): AgentMemory {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: VALID_KINDS.has(row.kind as AgentMemoryKind) ? row.kind as AgentMemoryKind : 'preference',
    content: row.content,
    source: row.source === 'agent' || row.source === 'system' ? row.source : 'user',
    importance: row.importance,
    sourceTurnId: row.source_turn_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function initAgentMemorySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'preference',
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user',
      importance INTEGER NOT NULL DEFAULT 3,
      source_turn_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_assistant_memories_project
      ON assistant_memories (project_id, importance DESC, updated_at DESC);
  `)
}

export class AgentMemoryStore {
  private readonly stmts: {
    insert: StatementSync
    findDuplicate: StatementSync
    get: StatementSync
    list: StatementSync
    remove: StatementSync
    updateImportance: StatementSync
    count: StatementSync
    pruneOne: StatementSync
  }

  constructor(db: DatabaseSync) {
    initAgentMemorySchema(db)
    this.stmts = {
      insert: db.prepare(`
        INSERT INTO assistant_memories
          (id, project_id, kind, content, source, importance, source_turn_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      findDuplicate: db.prepare(`
        SELECT * FROM assistant_memories WHERE project_id = ? AND content = ? LIMIT 1
      `),
      get: db.prepare(`SELECT * FROM assistant_memories WHERE id = ? AND project_id = ?`),
      list: db.prepare(`
        SELECT * FROM assistant_memories
        WHERE project_id = ?
        ORDER BY importance DESC, updated_at DESC
        LIMIT ?
      `),
      remove: db.prepare(`DELETE FROM assistant_memories WHERE id = ? AND project_id = ?`),
      updateImportance: db.prepare(`
        UPDATE assistant_memories SET importance = ?, updated_at = ?
        WHERE id = ? AND project_id = ?
      `),
      count: db.prepare(`SELECT COUNT(*) AS count FROM assistant_memories WHERE project_id = ?`),
      pruneOne: db.prepare(`
        DELETE FROM assistant_memories WHERE id = (
          SELECT id FROM assistant_memories WHERE project_id = ?
          ORDER BY importance ASC, updated_at ASC LIMIT 1
        )
      `)
    }
  }

  create(input: AgentMemoryInput): AgentMemory {
    const projectId = String(input.projectId || '').trim()
    const content = String(input.content || '').replace(/\s+/g, ' ').trim().slice(0, MAX_MEMORY_CONTENT)
    if (!projectId) throw new Error('缺少项目 ID，无法保存创作记忆。')
    if (!content) throw new Error('创作记忆内容不能为空。')

    const duplicate = this.stmts.findDuplicate.get(projectId, content) as MemoryRow | undefined
    if (duplicate) return rowToMemory(duplicate)

    const now = new Date().toISOString()
    const kind = VALID_KINDS.has(input.kind ?? 'preference') ? input.kind ?? 'preference' : 'preference'
    const source = input.source === 'agent' || input.source === 'system' ? input.source : 'user'
    const memory: AgentMemory = {
      id: randomUUID(),
      projectId,
      kind,
      content,
      source,
      importance: normalizeImportance(input.importance),
      sourceTurnId: String(input.sourceTurnId || '').trim() || undefined,
      createdAt: now,
      updatedAt: now
    }
    this.stmts.insert.run(
      memory.id,
      memory.projectId,
      memory.kind,
      memory.content,
      memory.source,
      memory.importance,
      memory.sourceTurnId ?? '',
      memory.createdAt,
      memory.updatedAt
    )
    this.prune(projectId)
    return memory
  }

  list(projectId: string, limit = 50): AgentMemory[] {
    const safeLimit = Math.min(100, Math.max(1, Math.round(Number(limit) || 50)))
    const rows = this.stmts.list.all(String(projectId || '').trim(), safeLimit) as unknown as MemoryRow[]
    return rows.map(rowToMemory)
  }

  remove(id: string, projectId: string): boolean {
    return this.stmts.remove.run(String(id || ''), String(projectId || '')).changes > 0
  }

  setImportance(id: string, projectId: string, importance: number): AgentMemory | null {
    this.stmts.updateImportance.run(
      normalizeImportance(importance),
      new Date().toISOString(),
      String(id || ''),
      String(projectId || '')
    )
    const row = this.stmts.get.get(String(id || ''), String(projectId || '')) as MemoryRow | undefined
    return row ? rowToMemory(row) : null
  }

  private prune(projectId: string): void {
    const row = this.stmts.count.get(projectId) as { count?: number } | undefined
    let count = Number(row?.count ?? 0)
    while (count > MAX_MEMORIES_PER_PROJECT) {
      this.stmts.pruneOne.run(projectId)
      count -= 1
    }
  }
}

export function formatAgentMemories(memories: AgentMemory[]): string {
  if (!memories.length) return ''
  const labels: Record<AgentMemoryKind, string> = {
    preference: '偏好',
    lesson: '教训',
    fact: '事实',
    method: '方法'
  }
  return [
    '这些是用户可查看和删除的项目级长期记忆。除非用户本轮明确推翻，否则应遵守；若与当前项目事实冲突，先向用户说明。',
    ...memories.map((memory, index) =>
      `${index + 1}. [${labels[memory.kind]}·重要度${memory.importance}] ${memory.content}`
    )
  ].join('\n')
}
