import type { DatabaseSync } from 'node:sqlite'
import type { SaveWorkspaceEntitiesRequest } from '@shared/ipc-types'

function deleteMissingRows(
  db: DatabaseSync,
  table: 'worldview_entries' | 'characters' | 'inspiration_entries',
  projectId: string,
  activeIds: Set<string>
): void {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE project_id = ?`).all(projectId) as Array<{ id: string }>
  const remove = db.prepare(`DELETE FROM ${table} WHERE id = ? AND project_id = ?`)
  for (const row of rows) {
    if (!activeIds.has(String(row.id))) remove.run(row.id, projectId)
  }
}

function cleanupDeletedCharacterReferences(
  db: DatabaseSync,
  projectId: string,
  activeCharacterIds: Set<string>
): void {
  const relationships = db.prepare(`
    SELECT id, from_character_id AS fromCharacterId, to_character_id AS toCharacterId
    FROM character_relationships
    WHERE project_id = ?
  `).all(projectId) as Array<{ id: string; fromCharacterId: string; toCharacterId: string }>
  const removeRelationship = db.prepare('DELETE FROM character_relationships WHERE id = ? AND project_id = ?')
  for (const relationship of relationships) {
    if (
      !activeCharacterIds.has(String(relationship.fromCharacterId))
      || !activeCharacterIds.has(String(relationship.toCharacterId))
    ) {
      removeRelationship.run(relationship.id, projectId)
    }
  }

  const memberships = db.prepare(`
    SELECT id, character_id AS characterId
    FROM organization_memberships
    WHERE project_id = ?
  `).all(projectId) as Array<{ id: string; characterId: string }>
  const removeMembership = db.prepare('DELETE FROM organization_memberships WHERE id = ? AND project_id = ?')
  for (const membership of memberships) {
    if (!activeCharacterIds.has(String(membership.characterId))) {
      removeMembership.run(membership.id, projectId)
    }
  }
}

export function writeWorkspaceEntities(db: DatabaseSync, request: SaveWorkspaceEntitiesRequest): void {
  db.exec('BEGIN')
  try {
    if (request.worldviewEntries) {
      const upsert = db.prepare(`
        INSERT INTO worldview_entries (id, project_id, type, title, content, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          type = excluded.type,
          title = excluded.title,
          content = excluded.content,
          sort_order = excluded.sort_order,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `)
      const activeIds = new Set<string>()
      for (const entry of request.worldviewEntries) {
        activeIds.add(entry.id)
        upsert.run(
          entry.id,
          request.projectId,
          entry.type,
          entry.title,
          entry.content,
          entry.sortOrder,
          entry.createdAt,
          entry.updatedAt
        )
      }
      deleteMissingRows(db, 'worldview_entries', request.projectId, activeIds)
    }

    if (request.characters) {
      const upsert = db.prepare(`
        INSERT INTO characters (id, project_id, name, role, description, avatar, tags_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          name = excluded.name,
          role = excluded.role,
          description = excluded.description,
          avatar = excluded.avatar,
          tags_json = excluded.tags_json
      `)
      const activeIds = new Set<string>()
      for (const character of request.characters) {
        activeIds.add(character.id)
        upsert.run(
          character.id,
          request.projectId,
          character.name,
          character.role,
          character.description,
          character.avatar,
          JSON.stringify(character.tags ?? [])
        )
      }
      deleteMissingRows(db, 'characters', request.projectId, activeIds)
      cleanupDeletedCharacterReferences(db, request.projectId, activeIds)
    }

    if (request.inspirationEntries) {
      const upsert = db.prepare(`
        INSERT INTO inspiration_entries (
          id, project_id, type, title, content, tags_json, source, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          type = excluded.type,
          title = excluded.title,
          content = excluded.content,
          tags_json = excluded.tags_json,
          source = excluded.source,
          sort_order = excluded.sort_order,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `)
      const activeIds = new Set<string>()
      for (const entry of request.inspirationEntries) {
        activeIds.add(entry.id)
        upsert.run(
          entry.id,
          request.projectId,
          entry.type,
          entry.title,
          entry.content,
          JSON.stringify(entry.tags ?? []),
          entry.source,
          entry.sortOrder,
          entry.createdAt,
          entry.updatedAt
        )
      }
      deleteMissingRows(db, 'inspiration_entries', request.projectId, activeIds)
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
