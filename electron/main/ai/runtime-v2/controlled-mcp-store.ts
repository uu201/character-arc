import { randomUUID } from 'node:crypto'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { ControlledMcpServer, ControlledMcpTool } from '@shared/assistant-runtime'

interface McpServerRow {
  id: string
  project_id: string
  name: string
  url: string
  api_key: string
  enabled: number
  allowed_tools_json: string
  discovered_tools_json: string
  last_connected_at: string
  last_error: string
  created_at: string
  updated_at: string
}

export interface ControlledMcpServerSecret extends ControlledMcpServer {
  apiKey: string
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean).slice(0, 100) : []
  } catch {
    return []
  }
}

function parseTools(value: string): ControlledMcpTool[] {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, 100).map((tool) => ({
      name: String(tool?.name ?? '').slice(0, 120),
      description: String(tool?.description ?? '').slice(0, 500) || undefined,
      inputSchema: tool?.inputSchema && typeof tool.inputSchema === 'object'
        ? tool.inputSchema as Record<string, unknown>
        : undefined
    })).filter((tool) => tool.name)
  } catch {
    return []
  }
}

function rowToServer(row: McpServerRow): ControlledMcpServerSecret {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    url: row.url,
    apiKey: row.api_key,
    hasApiKey: Boolean(row.api_key),
    enabled: row.enabled === 1,
    allowedTools: parseStringArray(row.allowed_tools_json),
    discoveredTools: parseTools(row.discovered_tools_json),
    lastConnectedAt: row.last_connected_at || undefined,
    lastError: row.last_error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function publicServer(server: ControlledMcpServerSecret): ControlledMcpServer {
  const { apiKey: _apiKey, ...safe } = server
  return safe
}

export function initControlledMcpSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_mcp_servers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 0,
      allowed_tools_json TEXT NOT NULL DEFAULT '[]',
      discovered_tools_json TEXT NOT NULL DEFAULT '[]',
      last_connected_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_assistant_mcp_servers_project
      ON assistant_mcp_servers (project_id, updated_at DESC);
  `)
}

export class ControlledMcpStore {
  private readonly stmts: {
    list: StatementSync
    get: StatementSync
    insert: StatementSync
    update: StatementSync
    remove: StatementSync
    setEnabled: StatementSync
    setAllowedTools: StatementSync
    setConnectionResult: StatementSync
  }

  constructor(db: DatabaseSync) {
    initControlledMcpSchema(db)
    this.stmts = {
      list: db.prepare(`SELECT * FROM assistant_mcp_servers WHERE project_id = ? ORDER BY updated_at DESC`),
      get: db.prepare(`SELECT * FROM assistant_mcp_servers WHERE id = ? AND project_id = ?`),
      insert: db.prepare(`
        INSERT INTO assistant_mcp_servers
          (id, project_id, name, url, api_key, enabled, allowed_tools_json, discovered_tools_json,
           last_connected_at, last_error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, '[]', '[]', '', '', ?, ?)
      `),
      update: db.prepare(`
        UPDATE assistant_mcp_servers
        SET name = ?, url = ?, api_key = ?, enabled = 0, discovered_tools_json = '[]',
            allowed_tools_json = '[]', last_error = '', updated_at = ?
        WHERE id = ? AND project_id = ?
      `),
      remove: db.prepare(`DELETE FROM assistant_mcp_servers WHERE id = ? AND project_id = ?`),
      setEnabled: db.prepare(`
        UPDATE assistant_mcp_servers SET enabled = ?, updated_at = ? WHERE id = ? AND project_id = ?
      `),
      setAllowedTools: db.prepare(`
        UPDATE assistant_mcp_servers SET allowed_tools_json = ?, updated_at = ? WHERE id = ? AND project_id = ?
      `),
      setConnectionResult: db.prepare(`
        UPDATE assistant_mcp_servers
        SET discovered_tools_json = ?, last_connected_at = ?, last_error = ?, updated_at = ?
        WHERE id = ? AND project_id = ?
      `)
    }
  }

  list(projectId: string): ControlledMcpServer[] {
    const rows = this.stmts.list.all(String(projectId || '')) as unknown as McpServerRow[]
    return rows.map(rowToServer).map(publicServer)
  }

  listEnabledSecrets(projectId: string): ControlledMcpServerSecret[] {
    const rows = this.stmts.list.all(String(projectId || '')) as unknown as McpServerRow[]
    return rows.map(rowToServer).filter((server) => server.enabled && server.allowedTools.length > 0)
  }

  getSecret(id: string, projectId: string): ControlledMcpServerSecret | null {
    const row = this.stmts.get.get(String(id || ''), String(projectId || '')) as McpServerRow | undefined
    return row ? rowToServer(row) : null
  }

  save(input: { id?: string; projectId: string; name: string; url: string; apiKey?: string }): ControlledMcpServer {
    const projectId = String(input.projectId || '').trim()
    const name = String(input.name || '').trim().slice(0, 80)
    const url = String(input.url || '').trim().slice(0, 2048)
    if (!projectId || !name || !url) throw new Error('MCP 服务器需要项目、名称和 URL。')
    const now = new Date().toISOString()

    if (input.id) {
      const existing = this.getSecret(input.id, projectId)
      if (!existing) throw new Error('MCP 服务器不存在或不属于当前项目。')
      const apiKey = input.apiKey === undefined ? existing.apiKey : String(input.apiKey).trim().slice(0, 4096)
      this.stmts.update.run(name, url, apiKey, now, existing.id, projectId)
      return publicServer(this.getSecret(existing.id, projectId)!)
    }

    const id = randomUUID()
    this.stmts.insert.run(id, projectId, name, url, String(input.apiKey || '').trim().slice(0, 4096), now, now)
    return publicServer(this.getSecret(id, projectId)!)
  }

  remove(id: string, projectId: string): boolean {
    return this.stmts.remove.run(String(id || ''), String(projectId || '')).changes > 0
  }

  setEnabled(id: string, projectId: string, enabled: boolean): ControlledMcpServer {
    const server = this.getSecret(id, projectId)
    if (!server) throw new Error('MCP 服务器不存在或不属于当前项目。')
    if (enabled && server.allowedTools.length === 0) throw new Error('请先测试连接并选择允许的工具。')
    this.stmts.setEnabled.run(enabled ? 1 : 0, new Date().toISOString(), id, projectId)
    return publicServer(this.getSecret(id, projectId)!)
  }

  setAllowedTools(id: string, projectId: string, names: string[]): ControlledMcpServer {
    const server = this.getSecret(id, projectId)
    if (!server) throw new Error('MCP 服务器不存在或不属于当前项目。')
    const discovered = new Set(server.discoveredTools.map((tool) => tool.name))
    const allowed = Array.from(new Set(names.map(String))).filter((name) => discovered.has(name)).slice(0, 50)
    this.stmts.setAllowedTools.run(JSON.stringify(allowed), new Date().toISOString(), id, projectId)
    return publicServer(this.getSecret(id, projectId)!)
  }

  recordConnection(id: string, projectId: string, tools: ControlledMcpTool[], error = ''): ControlledMcpServer {
    const now = new Date().toISOString()
    this.stmts.setConnectionResult.run(
      JSON.stringify(tools.slice(0, 100)),
      error ? '' : now,
      String(error || '').slice(0, 1000),
      now,
      id,
      projectId
    )
    const server = this.getSecret(id, projectId)
    if (!server) throw new Error('MCP 服务器不存在或不属于当前项目。')
    return publicServer(server)
  }
}
