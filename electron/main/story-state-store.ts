import { DatabaseSync } from 'node:sqlite'

// ==================== Types ====================

export interface CharacterState {
  characterId: string
  chapterIndex: number
  location: string
  physicalState: string
  mentalState: string
  arcStage: string
  powerLevel: string
  knowledge: string[]
  inventory: string[]
  goals: string[]
}

export interface Foreshadowing {
  foreshadowingId: string
  type: string
  description: string
  status: 'active' | 'advanced' | 'resolved' | 'abandoned'
  plantedChapter: number
  plantedMethod: string
  payoffChapter: number | null
  resolvedChapter: number | null
  clues: Array<{ chapter: number; clue: string; method?: string }>
  connections: string[]
}

export interface Relationship {
  relationshipId: string
  participantA: string
  participantB: string
  currentStatus: string
  tensionPoints: string[]
  trajectory: string
  lastInteractionChapter: number | null
}

export interface TimelineEntry {
  chapterIndex: number
  storyDate: string
  events: string[]
  worldStateChanges: string[]
}

export interface WorldRule {
  ruleId: string
  ruleContent: string
  establishedChapter: number
  exceptions: string[]
  mustComply: boolean
}

export interface CountdownClock {
  clockId: string
  eventDescription: string
  deadlineChapter: number | null
  status: 'active' | 'expired' | 'resolved'
  urgency: string
}

export interface StateDelta {
  characters_updated: Array<{
    character_id: string
    changes: {
      location?: { from: string; to: string }
      physical_state?: string
      mental_state?: string
      arc_progression?: string
      power_level?: string
      inventory_delta?: { added: string[]; removed: string[] }
      new_knowledge?: string[]
      goals_update?: { completed: string[]; added: string[] }
    }
  }>
  relationships_delta: Array<{
    relationship_id: string
    participants?: [string, string]
    status_change?: { from: string; to: string; pivot_event: string }
    new_tension_points?: string[]
  }>
  foreshadowing_delta: {
    planted: Array<{ id: string; type: string; description: string; method: string; payoff_chapter?: number }>
    advanced: Array<{ id: string; clue: string; method: string }>
    resolved: Array<{ id: string; method: string; impact: string }>
  }
  timeline: {
    story_time_elapsed: string
    current_story_date: string
    events: string[]
    world_state_changes?: string[]
  }
}

export interface ForeshadowingHealthReport {
  totalActive: number
  overdue: Array<{ id: string; plantedChapter: number; expectedPayoff: number }>
  densityWarning: boolean
  currentChapter: number
}

export interface StoryStateContext {
  characterStates: CharacterState[]
  activeForeshadowing: Foreshadowing[]
  relationships: Relationship[]
  recentTimeline: TimelineEntry[]
  worldRules: WorldRule[]
  activeClocks: CountdownClock[]
}

// ==================== Schema ====================

const STORY_STATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS story_character_state (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    physical_state TEXT NOT NULL DEFAULT '正常',
    mental_state TEXT NOT NULL DEFAULT '',
    arc_stage TEXT NOT NULL DEFAULT '',
    power_level TEXT NOT NULL DEFAULT '',
    knowledge_json TEXT NOT NULL DEFAULT '[]',
    inventory_json TEXT NOT NULL DEFAULT '[]',
    goals_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_char_state_unique
    ON story_character_state(project_id, character_id, chapter_index);

  CREATE TABLE IF NOT EXISTS story_foreshadowing (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    foreshadowing_id TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    planted_chapter INTEGER NOT NULL,
    planted_method TEXT NOT NULL DEFAULT '',
    payoff_chapter INTEGER,
    resolved_chapter INTEGER,
    clues_json TEXT NOT NULL DEFAULT '[]',
    connections_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_foreshadowing_project_fid
    ON story_foreshadowing(project_id, foreshadowing_id);

  CREATE TABLE IF NOT EXISTS story_relationships (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    relationship_id TEXT NOT NULL,
    participant_a TEXT NOT NULL,
    participant_b TEXT NOT NULL,
    current_status TEXT NOT NULL,
    tension_points_json TEXT NOT NULL DEFAULT '[]',
    trajectory TEXT NOT NULL DEFAULT '',
    last_interaction_chapter INTEGER,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_relationships_project_rid
    ON story_relationships(project_id, relationship_id);

  CREATE TABLE IF NOT EXISTS story_timeline (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    story_date TEXT NOT NULL DEFAULT '',
    events_json TEXT NOT NULL DEFAULT '[]',
    world_state_changes_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_unique
    ON story_timeline(project_id, chapter_index);

  CREATE TABLE IF NOT EXISTS story_world_rules (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    rule_content TEXT NOT NULL,
    established_chapter INTEGER NOT NULL,
    exceptions_json TEXT NOT NULL DEFAULT '[]',
    must_comply INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_world_rules_project_rid
    ON story_world_rules(project_id, rule_id);

  CREATE TABLE IF NOT EXISTS story_countdown_clocks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    clock_id TEXT NOT NULL,
    event_description TEXT NOT NULL,
    deadline_chapter INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    urgency TEXT NOT NULL DEFAULT 'medium',
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS story_embeddings (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    chapter_index INTEGER,
    text_content TEXT NOT NULL,
    embedding BLOB NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_embeddings_project
    ON story_embeddings(project_id, source_type);

  CREATE TABLE IF NOT EXISTS embedding_metadata (
    key TEXT PRIMARY KEY,
    dimension INTEGER NOT NULL
  ) STRICT;
`

// ==================== Helpers ====================

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function now(): string {
  return new Date().toISOString()
}

// ==================== Store ====================

export function initStoryStateSchema(db: DatabaseSync): void {
  db.exec(STORY_STATE_SCHEMA)
}

export function getLatestCharacterStates(
  db: DatabaseSync,
  projectId: string,
  characterIds: string[]
): CharacterState[] {
  if (!characterIds.length) return []

  const placeholders = characterIds.map(() => '?').join(',')
  const stmt = db.prepare(`
    SELECT cs.* FROM story_character_state cs
    INNER JOIN (
      SELECT character_id, MAX(chapter_index) as max_ch
      FROM story_character_state
      WHERE project_id = ? AND character_id IN (${placeholders})
      GROUP BY character_id
    ) latest ON cs.character_id = latest.character_id AND cs.chapter_index = latest.max_ch
    WHERE cs.project_id = ?
  `)

  const rows = stmt.all(projectId, ...characterIds, projectId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    characterId: String(row.character_id),
    chapterIndex: Number(row.chapter_index),
    location: String(row.location ?? ''),
    physicalState: String(row.physical_state ?? '正常'),
    mentalState: String(row.mental_state ?? ''),
    arcStage: String(row.arc_stage ?? ''),
    powerLevel: String(row.power_level ?? ''),
    knowledge: parseJson<string[]>(row.knowledge_json, []),
    inventory: parseJson<string[]>(row.inventory_json, []),
    goals: parseJson<string[]>(row.goals_json, [])
  }))
}

export function getAllCharacterIds(db: DatabaseSync, projectId: string): string[] {
  const stmt = db.prepare(
    `SELECT DISTINCT character_id FROM story_character_state WHERE project_id = ?`
  )
  const rows = stmt.all(projectId) as Array<Record<string, unknown>>
  return rows.map((row) => String(row.character_id))
}

export function getActiveForeshadowing(
  db: DatabaseSync,
  projectId: string,
  limit = 30
): Foreshadowing[] {
  const stmt = db.prepare(`
    SELECT * FROM story_foreshadowing
    WHERE project_id = ? AND status IN ('active', 'advanced')
    ORDER BY planted_chapter ASC
    LIMIT ?
  `)
  const rows = stmt.all(projectId, limit) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    foreshadowingId: String(row.foreshadowing_id),
    type: String(row.type),
    description: String(row.description),
    status: String(row.status) as Foreshadowing['status'],
    plantedChapter: Number(row.planted_chapter),
    plantedMethod: String(row.planted_method ?? ''),
    payoffChapter: row.payoff_chapter != null ? Number(row.payoff_chapter) : null,
    resolvedChapter: row.resolved_chapter != null ? Number(row.resolved_chapter) : null,
    clues: parseJson<Foreshadowing['clues']>(row.clues_json, []),
    connections: parseJson<string[]>(row.connections_json, [])
  }))
}

export function getRelationships(
  db: DatabaseSync,
  projectId: string,
  characterIds?: string[]
): Relationship[] {
  let sql = `SELECT * FROM story_relationships WHERE project_id = ?`
  const params: (string | number | null)[] = [projectId]

  if (characterIds?.length) {
    const placeholders = characterIds.map(() => '?').join(',')
    sql += ` AND (participant_a IN (${placeholders}) OR participant_b IN (${placeholders}))`
    params.push(...characterIds, ...characterIds)
  }

  const stmt = db.prepare(sql)
  const rows = stmt.all(...params) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    relationshipId: String(row.relationship_id),
    participantA: String(row.participant_a),
    participantB: String(row.participant_b),
    currentStatus: String(row.current_status),
    tensionPoints: parseJson<string[]>(row.tension_points_json, []),
    trajectory: String(row.trajectory ?? ''),
    lastInteractionChapter: row.last_interaction_chapter != null ? Number(row.last_interaction_chapter) : null
  }))
}

export function getRecentTimeline(
  db: DatabaseSync,
  projectId: string,
  lastN = 5
): TimelineEntry[] {
  const stmt = db.prepare(`
    SELECT * FROM story_timeline
    WHERE project_id = ?
    ORDER BY chapter_index DESC
    LIMIT ?
  `)
  const rows = stmt.all(projectId, lastN) as Array<Record<string, unknown>>
  return rows.reverse().map((row) => ({
    chapterIndex: Number(row.chapter_index),
    storyDate: String(row.story_date ?? ''),
    events: parseJson<string[]>(row.events_json, []),
    worldStateChanges: parseJson<string[]>(row.world_state_changes_json, [])
  }))
}

export function getWorldRules(db: DatabaseSync, projectId: string): WorldRule[] {
  const stmt = db.prepare(`SELECT * FROM story_world_rules WHERE project_id = ? ORDER BY established_chapter ASC`)
  const rows = stmt.all(projectId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    ruleId: String(row.rule_id),
    ruleContent: String(row.rule_content),
    establishedChapter: Number(row.established_chapter),
    exceptions: parseJson<string[]>(row.exceptions_json, []),
    mustComply: Boolean(row.must_comply)
  }))
}

export function getActiveClocks(db: DatabaseSync, projectId: string): CountdownClock[] {
  const stmt = db.prepare(`SELECT * FROM story_countdown_clocks WHERE project_id = ? AND status = 'active'`)
  const rows = stmt.all(projectId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    clockId: String(row.clock_id),
    eventDescription: String(row.event_description),
    deadlineChapter: row.deadline_chapter != null ? Number(row.deadline_chapter) : null,
    status: String(row.status) as CountdownClock['status'],
    urgency: String(row.urgency ?? 'medium')
  }))
}

export function getForeshadowingHealth(
  db: DatabaseSync,
  projectId: string,
  currentChapter: number
): ForeshadowingHealthReport {
  const active = getActiveForeshadowing(db, projectId, 999)
  const overdue = active
    .filter((f) => f.payoffChapter != null && f.payoffChapter < currentChapter)
    .map((f) => ({
      id: f.foreshadowingId,
      plantedChapter: f.plantedChapter,
      expectedPayoff: f.payoffChapter!
    }))

  return {
    totalActive: active.length,
    overdue,
    densityWarning: active.length > currentChapter / 5,
    currentChapter
  }
}

// ==================== Write Operations ====================

export function applyStateDelta(
  db: DatabaseSync,
  projectId: string,
  chapterIndex: number,
  delta: StateDelta,
  options: { useTransaction?: boolean } = {}
): void {
  const useTransaction = options.useTransaction !== false
  if (useTransaction) {
    db.exec('BEGIN')
  }
  try {
  const timestamp = now()

  // Character state updates
  for (const charUpdate of delta.characters_updated) {
    const existing = getLatestCharacterStates(db, projectId, [charUpdate.character_id])
    const prev = existing[0]

    const id = uid()
    const location = charUpdate.changes.location?.to ?? prev?.location ?? ''
    const physicalState = charUpdate.changes.physical_state ?? prev?.physicalState ?? '正常'
    const mentalState = charUpdate.changes.mental_state ?? prev?.mentalState ?? ''
    const arcStage = charUpdate.changes.arc_progression ?? prev?.arcStage ?? ''
    const powerLevel = charUpdate.changes.power_level ?? prev?.powerLevel ?? ''

    let inventory = prev?.inventory ?? []
    if (charUpdate.changes.inventory_delta) {
      const { added = [], removed = [] } = charUpdate.changes.inventory_delta
      inventory = inventory.filter((item) => !removed.includes(item))
      inventory.push(...added)
    }
    const inventoryJson = JSON.stringify(inventory)

    let knowledge = prev?.knowledge ?? []
    if (charUpdate.changes.new_knowledge?.length) {
      knowledge = [...knowledge, ...charUpdate.changes.new_knowledge]
    }
    const knowledgeJson = JSON.stringify(knowledge)

    let goals = prev?.goals ?? []
    if (charUpdate.changes.goals_update) {
      const { completed = [], added = [] } = charUpdate.changes.goals_update
      goals = goals.filter((g) => !completed.includes(g))
      goals.push(...added)
    }
    const goalsJson = JSON.stringify(goals)

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO story_character_state
        (id, project_id, character_id, chapter_index, location, physical_state, mental_state,
         arc_stage, power_level, knowledge_json, inventory_json, goals_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      id, projectId, charUpdate.character_id, chapterIndex,
      location, physicalState, mentalState,
      arcStage, powerLevel,
      knowledgeJson, inventoryJson, goalsJson,
      timestamp
    )
  }

  // Relationship updates
  for (const relUpdate of delta.relationships_delta) {
    const existingStmt = db.prepare(
      `SELECT * FROM story_relationships WHERE project_id = ? AND relationship_id = ?`
    )
    const existingRow = existingStmt.get(projectId, relUpdate.relationship_id) as Record<string, unknown> | undefined

    if (existingRow) {
      const updates: string[] = []
      const params: (string | number | null)[] = []

      if (relUpdate.status_change) {
        updates.push('current_status = ?')
        params.push(relUpdate.status_change.to)
      }
      if (relUpdate.new_tension_points?.length) {
        const existing = parseJson<string[]>(existingRow.tension_points_json, [])
        updates.push('tension_points_json = ?')
        params.push(JSON.stringify([...existing, ...relUpdate.new_tension_points]))
      }
      updates.push('last_interaction_chapter = ?')
      params.push(chapterIndex)
      updates.push('updated_at = ?')
      params.push(timestamp)
      params.push(projectId, relUpdate.relationship_id)

      if (updates.length >= 2) {
        db.prepare(
          `UPDATE story_relationships SET ${updates.join(', ')} WHERE project_id = ? AND relationship_id = ?`
        ).run(...params)
      }
    } else if (relUpdate.participants) {
      db.prepare(`
        INSERT OR IGNORE INTO story_relationships
          (id, project_id, relationship_id, participant_a, participant_b, current_status,
           tension_points_json, trajectory, last_interaction_chapter, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uid(), projectId, relUpdate.relationship_id,
        relUpdate.participants[0], relUpdate.participants[1],
        relUpdate.status_change?.to ?? '初识',
        JSON.stringify(relUpdate.new_tension_points ?? []),
        '', chapterIndex, timestamp
      )
    }
  }

  // Foreshadowing updates
  if (delta.foreshadowing_delta) {
    for (const planted of delta.foreshadowing_delta.planted) {
      db.prepare(`
        INSERT OR IGNORE INTO story_foreshadowing
          (id, project_id, foreshadowing_id, type, description, status, planted_chapter,
           planted_method, payoff_chapter, clues_json, connections_json, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, '[]', '[]', ?)
      `).run(
        uid(), projectId, planted.id, planted.type, planted.description,
        chapterIndex, planted.method, planted.payoff_chapter ?? null, timestamp
      )
    }

    for (const advanced of delta.foreshadowing_delta.advanced) {
      const row = db.prepare(
        `SELECT clues_json FROM story_foreshadowing WHERE project_id = ? AND foreshadowing_id = ?`
      ).get(projectId, advanced.id) as Record<string, unknown> | undefined

      if (row) {
        const clues = parseJson<Foreshadowing['clues']>(row.clues_json, [])
        clues.push({ chapter: chapterIndex, clue: advanced.clue, method: advanced.method })
        db.prepare(`
          UPDATE story_foreshadowing
          SET clues_json = ?, status = 'advanced', updated_at = ?
          WHERE project_id = ? AND foreshadowing_id = ?
        `).run(JSON.stringify(clues), timestamp, projectId, advanced.id)
      }
    }

    for (const resolved of delta.foreshadowing_delta.resolved) {
      db.prepare(`
        UPDATE story_foreshadowing
        SET status = 'resolved', resolved_chapter = ?, updated_at = ?
        WHERE project_id = ? AND foreshadowing_id = ?
      `).run(chapterIndex, timestamp, projectId, resolved.id)
    }
  }

  // Timeline
  if (delta.timeline) {
    db.prepare(`
      INSERT OR REPLACE INTO story_timeline
        (id, project_id, chapter_index, story_date, events_json, world_state_changes_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uid(), projectId, chapterIndex,
      delta.timeline.current_story_date ?? '',
      JSON.stringify(delta.timeline.events ?? []),
      JSON.stringify(delta.timeline.world_state_changes ?? []),
      timestamp
    )
  }

  if (useTransaction) {
    db.exec('COMMIT')
  }
  } catch (error) {
    if (useTransaction) {
      db.exec('ROLLBACK')
    }
    throw error
  }
}

// ==================== Context Builder ====================

export function buildStoryStateContext(
  db: DatabaseSync,
  projectId: string,
  involvedCharacterIds: string[]
): StoryStateContext {
  const allCharIds = involvedCharacterIds.length
    ? involvedCharacterIds
    : getAllCharacterIds(db, projectId)

  return {
    characterStates: getLatestCharacterStates(db, projectId, allCharIds),
    activeForeshadowing: getActiveForeshadowing(db, projectId),
    relationships: getRelationships(db, projectId, allCharIds),
    recentTimeline: getRecentTimeline(db, projectId, 5),
    worldRules: getWorldRules(db, projectId),
    activeClocks: getActiveClocks(db, projectId)
  }
}

export function formatStoryStateForPrompt(ctx: StoryStateContext): string {
  const sections: string[] = []

  if (ctx.characterStates.length) {
    const lines = ctx.characterStates.map((c) => {
      const parts = [`${c.characterId}: 位置[${c.location || '未知'}]`]
      if (c.physicalState && c.physicalState !== '正常') parts.push(`身体[${c.physicalState}]`)
      if (c.mentalState) parts.push(`心理[${c.mentalState}]`)
      if (c.arcStage) parts.push(`阶段[${c.arcStage}]`)
      if (c.powerLevel) parts.push(`能力[${c.powerLevel}]`)
      if (c.inventory.length) parts.push(`持有[${c.inventory.join('、')}]`)
      if (c.goals.length) parts.push(`目标[${c.goals.join('、')}]`)
      return `- ${parts.join(', ')}`
    })
    sections.push(`### 角色当前状态\n${lines.join('\n')}`)
  }

  if (ctx.activeForeshadowing.length) {
    const lines = ctx.activeForeshadowing.slice(0, 15).map((f) => {
      const clueCount = f.clues.length
      const payoff = f.payoffChapter ? `预定第${f.payoffChapter}章揭示` : '揭示时间待定'
      return `- ${f.foreshadowingId}[${f.status}]: ${f.description} (第${f.plantedChapter}章埋设, 已释放${clueCount}条线索, ${payoff})`
    })
    sections.push(`### 活跃伏笔 (${ctx.activeForeshadowing.length}条)\n${lines.join('\n')}`)
  }

  if (ctx.relationships.length) {
    const lines = ctx.relationships.map((r) => {
      const tension = r.tensionPoints.length ? `, 矛盾[${r.tensionPoints.join('/')}]` : ''
      return `- ${r.participantA} ↔ ${r.participantB}: ${r.currentStatus}${tension}`
    })
    sections.push(`### 关系网络\n${lines.join('\n')}`)
  }

  if (ctx.recentTimeline.length) {
    const lines = ctx.recentTimeline.map((t) => {
      const date = t.storyDate ? `[${t.storyDate}]` : ''
      return `- 第${t.chapterIndex}章${date}: ${t.events.join('; ')}`
    })
    sections.push(`### 近期时间线\n${lines.join('\n')}`)
  }

  if (ctx.worldRules.length) {
    const lines = ctx.worldRules.map((r) => `- ${r.ruleContent} (第${r.establishedChapter}章确立)`)
    sections.push(`### 世界规则\n${lines.join('\n')}`)
  }

  if (ctx.activeClocks.length) {
    const lines = ctx.activeClocks.map((c) => {
      const deadline = c.deadlineChapter ? `截止第${c.deadlineChapter}章` : '无明确截止'
      return `- [${c.urgency}] ${c.eventDescription} (${deadline})`
    })
    sections.push(`### 倒计时事件\n${lines.join('\n')}`)
  }

  return sections.join('\n\n')
}
