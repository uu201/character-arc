import { ensureWorkspaceDb } from '../../../workspace-store'
import type { Tool, ToolHandlerResult } from './types'

function ok(content: string): ToolHandlerResult {
  return { content }
}

function err(message: string): ToolHandlerResult {
  return { content: message, isError: true }
}

type EntityType = 'worldview' | 'characters' | 'organizations' | 'relationships' | 'outline' | 'plot_threads' | 'inspiration' | 'knowledge' | 'deconstruction_library'

const ENTITY_TYPES: ReadonlySet<string> = new Set<EntityType>([
  'worldview', 'characters', 'organizations', 'relationships',
  'outline', 'plot_threads', 'inspiration', 'knowledge', 'deconstruction_library'
])

export function createProjectDataTools(): Tool[] {
  const readProjectData: Tool = {
    definition: {
      name: 'read_project_data',
      description: '读取当前项目的完整设定数据。可按类型读取：worldview（世界观）、characters（角色）、organizations（组织）、relationships（角色关系）、outline（大纲）、plot_threads（剧情线索）、inspiration（灵感）、knowledge（项目知识库）、deconstruction_library（拆书知识库，全局共享的写作技法和风格参考）。不传 entity_type 则返回所有类型的摘要索引。',
      inputSchema: {
        type: 'object',
        properties: {
          entity_type: {
            type: 'string',
            enum: Array.from(ENTITY_TYPES),
            description: '要读取的数据类型。省略则返回所有类型的条目索引。'
          },
          entity_id: {
            type: 'string',
            description: '可选。指定条目 ID 读取单条完整内容。'
          }
        }
      }
    },
    handler: async (input, ctx) => {
      try {
        const projectId = ctx.projectId
        if (!projectId) return err('缺少 projectId')

        const entityType = typeof input.entity_type === 'string' ? input.entity_type.trim() : ''
        const entityId = typeof input.entity_id === 'string' ? input.entity_id.trim() : ''

        if (!entityType) {
          return ok(await buildIndex(projectId))
        }

        if (!ENTITY_TYPES.has(entityType)) {
          return err(`不支持的 entity_type: ${entityType}。可选: ${Array.from(ENTITY_TYPES).join(', ')}`)
        }

        return ok(await readEntities(projectId, entityType as EntityType, entityId))
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
  if (worldview.length) sections.push(`## 世界观 (${worldview.length})\n${worldview.map((w) => `- [${w.id}] ${w.title}`).join('\n')}`)

  const characters = db.prepare('SELECT id, name, role FROM characters WHERE project_id = ?').all(projectId) as { id: string; name: string; role: string }[]
  if (characters.length) sections.push(`## 角色 (${characters.length})\n${characters.map((c) => `- [${c.id}] ${c.name}（${c.role}）`).join('\n')}`)

  const orgs = db.prepare('SELECT id, name FROM organizations WHERE project_id = ?').all(projectId) as { id: string; name: string }[]
  if (orgs.length) sections.push(`## 组织 (${orgs.length})\n${orgs.map((o) => `- [${o.id}] ${o.name}`).join('\n')}`)

  const relationships = db.prepare('SELECT id, from_character_id, to_character_id, type FROM character_relationships WHERE project_id = ?').all(projectId) as { id: string; from_character_id: string; to_character_id: string; type: string }[]
  if (relationships.length) sections.push(`## 角色关系 (${relationships.length})\n${relationships.map((r) => `- [${r.id}] ${r.from_character_id} → ${r.to_character_id}（${r.type}）`).join('\n')}`)

  const outline = db.prepare('SELECT id, title FROM outline_items WHERE project_id = ?').all(projectId) as { id: string; title: string }[]
  if (outline.length) sections.push(`## 大纲 (${outline.length})\n${outline.map((o) => `- [${o.id}] ${o.title}`).join('\n')}`)

  const threads = db.prepare('SELECT id, title, status FROM plot_threads WHERE project_id = ?').all(projectId) as { id: string; title: string; status: string }[]
  if (threads.length) sections.push(`## 剧情线索 (${threads.length})\n${threads.map((t) => `- [${t.id}] ${t.title}（${t.status}）`).join('\n')}`)

  const inspiration = db.prepare('SELECT id, title FROM inspiration_entries WHERE project_id = ?').all(projectId) as { id: string; title: string }[]
  if (inspiration.length) sections.push(`## 灵感 (${inspiration.length})\n${inspiration.map((i) => `- [${i.id}] ${i.title}`).join('\n')}`)

  const knowledge = db.prepare('SELECT id, title FROM knowledge_documents WHERE project_id = ?').all(projectId) as { id: string; title: string }[]
  if (knowledge.length) sections.push(`## 项目知识库 (${knowledge.length})\n${knowledge.map((k) => `- [${k.id}] ${k.title}`).join('\n')}`)

  const deconstructionDocs = db.prepare("SELECT id, title FROM knowledge_documents WHERE project_id = '' OR project_id IS NULL").all() as { id: string; title: string }[]
  if (deconstructionDocs.length) sections.push(`## 拆书知识库 (${deconstructionDocs.length})\n${deconstructionDocs.map((k) => `- [${k.id}] ${k.title}`).join('\n')}`)

  return sections.length ? sections.join('\n\n') : '当前项目暂无设定数据。'
}

async function readEntities(projectId: string, type: EntityType, entityId: string): Promise<string> {
  const db = await ensureWorkspaceDb()

  switch (type) {
    case 'worldview': {
      if (entityId) {
        const row = db.prepare('SELECT title, content FROM worldview_entries WHERE id = ? AND project_id = ?').get(entityId, projectId) as { title: string; content: string } | undefined
        if (!row) return `未找到世界观条目: ${entityId}`
        return `# ${row.title}\n\n${row.content}`
      }
      const rows = db.prepare('SELECT id, title, content FROM worldview_entries WHERE project_id = ?').all(projectId) as { id: string; title: string; content: string }[]
      return rows.map((r) => `# ${r.title}\n\n${r.content}`).join('\n\n---\n\n') || '暂无世界观条目。'
    }
    case 'characters': {
      if (entityId) {
        const row = db.prepare('SELECT name, role, description FROM characters WHERE id = ? AND project_id = ?').get(entityId, projectId) as Record<string, string> | undefined
        if (!row) return `未找到角色: ${entityId}`
        return `# ${row.name}（${row.role}）\n\n${row.description}`
      }
      const rows = db.prepare('SELECT id, name, role, description FROM characters WHERE project_id = ?').all(projectId) as Record<string, string>[]
      return rows.map((r) => `# ${r.name}（${r.role}）\n${r.description}`).join('\n\n---\n\n') || '暂无角色。'
    }
    case 'organizations': {
      if (entityId) {
        const row = db.prepare('SELECT name, type, description, motto FROM organizations WHERE id = ? AND project_id = ?').get(entityId, projectId) as Record<string, string> | undefined
        if (!row) return `未找到组织: ${entityId}`
        const parts = [`# ${row.name}（${row.type}）`]
        if (row.description) parts.push(row.description)
        if (row.motto) parts.push(`信条: ${row.motto}`)
        return parts.join('\n')
      }
      const rows = db.prepare('SELECT id, name, type, description FROM organizations WHERE project_id = ?').all(projectId) as Record<string, string>[]
      return rows.map((r) => `# ${r.name}（${r.type}）\n${r.description}`).join('\n\n---\n\n') || '暂无组织。'
    }
    case 'relationships': {
      const rows = db.prepare('SELECT id, from_character_id, to_character_id, type, description, intensity FROM character_relationships WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
      if (!rows.length) return '暂无角色关系。'
      const charMap = new Map<string, string>()
      const chars = db.prepare('SELECT id, name FROM characters WHERE project_id = ?').all(projectId) as { id: string; name: string }[]
      for (const c of chars) charMap.set(c.id, c.name)
      return rows.map((r) => {
        const from = charMap.get(String(r.from_character_id)) ?? String(r.from_character_id)
        const to = charMap.get(String(r.to_character_id)) ?? String(r.to_character_id)
        return `${from} → ${to}（${r.type}，强度 ${r.intensity}）\n${r.description || ''}`
      }).join('\n\n')
    }
    case 'outline': {
      if (entityId) {
        const row = db.prepare('SELECT title, summary, conflict, word_target FROM outline_items WHERE id = ? AND project_id = ?').get(entityId, projectId) as Record<string, string> | undefined
        if (!row) return `未找到大纲条目: ${entityId}`
        const parts = [`## ${row.title}`]
        if (row.summary) parts.push(row.summary)
        if (row.conflict) parts.push(`冲突: ${row.conflict}`)
        if (row.word_target) parts.push(`目标字数: ${row.word_target}`)
        return parts.join('\n')
      }
      const rows = db.prepare('SELECT id, title, summary, conflict FROM outline_items WHERE project_id = ? ORDER BY sort_order').all(projectId) as Record<string, string>[]
      return rows.map((r) => `## ${r.title}\n${r.summary}${r.conflict ? `\n冲突: ${r.conflict}` : ''}`).join('\n\n') || '暂无大纲。'
    }
    case 'plot_threads': {
      const rows = db.prepare('SELECT id, title, description, status FROM plot_threads WHERE project_id = ?').all(projectId) as Record<string, string>[]
      return rows.map((r) => `## ${r.title}（${r.status}）\n${r.description}`).join('\n\n') || '暂无剧情线索。'
    }
    case 'inspiration': {
      if (entityId) {
        const row = db.prepare('SELECT title, content, source FROM inspiration_entries WHERE id = ? AND project_id = ?').get(entityId, projectId) as Record<string, string> | undefined
        if (!row) return `未找到灵感条目: ${entityId}`
        return `# ${row.title}\n来源: ${row.source || '无'}\n\n${row.content}`
      }
      const rows = db.prepare('SELECT id, title, content, source FROM inspiration_entries WHERE project_id = ?').all(projectId) as Record<string, string>[]
      return rows.map((r) => `## ${r.title}\n${r.content}`).join('\n\n') || '暂无灵感条目。'
    }
    case 'knowledge': {
      if (entityId) {
        const row = db.prepare('SELECT title, content, summary FROM knowledge_documents WHERE id = ? AND project_id = ?').get(entityId, projectId) as Record<string, string> | undefined
        if (!row) return `未找到知识文档: ${entityId}`
        return `# ${row.title}\n\n${row.content}`
      }
      const rows = db.prepare('SELECT id, title, summary FROM knowledge_documents WHERE project_id = ?').all(projectId) as Record<string, string>[]
      return rows.map((r) => `- [${r.id}] ${r.title}: ${r.summary || '(无摘要)'}`).join('\n') || '暂无项目知识库文档。'
    }
    case 'deconstruction_library': {
      if (entityId) {
        const row = db.prepare("SELECT title, content, summary FROM knowledge_documents WHERE id = ? AND (project_id = '' OR project_id IS NULL)").get(entityId) as Record<string, string> | undefined
        if (!row) return `未找到拆书知识库文档: ${entityId}`
        return `# ${row.title}\n\n${row.content}`
      }
      const rows = db.prepare("SELECT id, title, summary, source_type FROM knowledge_documents WHERE project_id = '' OR project_id IS NULL").all() as Record<string, string>[]
      return rows.map((r) => `- [${r.id}] ${r.title}（${r.source_type}）: ${r.summary || '(无摘要)'}`).join('\n') || '暂无拆书知识库文档。'
    }
  }
}

