import { randomUUID } from 'node:crypto'
import { ensureWorkspaceDb } from '../../../workspace-store'

export type ChapterData = {
  id: string
  projectId: string
  volumeId: string
  title: string
  summary: string
  status: string
  wordTarget: string
  content: string
  sortOrder: number
}

export type ChapterSummaryItem = {
  id: string
  title: string
  summary: string
  status: string
  wordCount: number
}

export type ChapterEdit = {
  operation: 'replace' | 'insert' | 'append'
  search?: string
  content: string
  position?: 'before' | 'after' | 'start' | 'end'
}

export type SearchResult = {
  entityType: string
  entityId: string
  type: string
  title: string
  content: string
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function countChars(html: string): number {
  return stripHtmlTags(html).replace(/\s/g, '').length
}

export function textToHtmlParagraphs(text: string): string {
  return text
    .split(/\n{2,}|\n/)
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`)
    .join('')
}

function mapPlainIndexToHtml(html: string, plainIdx: number): number {
  let charCount = 0
  let i = 0
  while (i < html.length) {
    if (html[i] === '<') {
      while (i < html.length && html[i] !== '>') i++
      i++
      continue
    }
    if (html[i] === '&') {
      const semiIdx = html.indexOf(';', i)
      if (semiIdx !== -1 && semiIdx - i < 10) {
        if (charCount === plainIdx) return i
        charCount++
        i = semiIdx + 1
        continue
      }
    }
    if (charCount === plainIdx) return i
    charCount++
    i++
  }
  return html.length
}

function replaceInHtml(html: string, search: string, replacement: string): string {
  const plain = stripHtmlTags(html)
  const plainStart = plain.indexOf(search)
  if (plainStart === -1) {
    throw new Error(`Could not find target text: "${search.slice(0, 50)}..."`)
  }
  const htmlStart = mapPlainIndexToHtml(html, plainStart)
  const htmlEnd = mapPlainIndexToHtml(html, plainStart + search.length)
  return html.slice(0, htmlStart) + textToHtmlParagraphs(replacement) + html.slice(htmlEnd)
}

function insertInHtml(html: string, search: string, insertionHtml: string, position: 'before' | 'after'): string {
  const plain = stripHtmlTags(html)
  const plainStart = plain.indexOf(search)
  if (plainStart === -1) {
    throw new Error(`Could not find anchor text: "${search.slice(0, 50)}..."`)
  }
  const anchorIdx = position === 'before'
    ? mapPlainIndexToHtml(html, plainStart)
    : mapPlainIndexToHtml(html, plainStart + search.length)
  return html.slice(0, anchorIdx) + insertionHtml + html.slice(anchorIdx)
}

function normalizeSearchScope(scope?: string[]): Set<string> | null {
  if (!scope?.length) {
    return null
  }
  return new Set(scope.map((item) => String(item).trim()).filter(Boolean))
}

function truncateSnippet(value: string, maxLength = 500): string {
  const normalized = value.trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function matchesQuery(query: string, ...fields: string[]): boolean {
  return fields.some((field) => field.toLowerCase().includes(query))
}

function readPublicReferenceWorkRows(db: Awaited<ReturnType<typeof ensureWorkspaceDb>>): Record<string, unknown>[] {
  return db.prepare('SELECT id, title, source, notes, file_name, analysis_json FROM reference_works ORDER BY created_at DESC, rowid DESC').all() as Record<string, unknown>[]
}

export async function readChapterFromDb(projectId: string, chapterId: string): Promise<ChapterData | null> {
  const db = await ensureWorkspaceDb()
  const row = db.prepare(
    'SELECT id, project_id, volume_id, title, summary, status, word_target, content, sort_order FROM chapters WHERE id = ? AND project_id = ?'
  ).get(chapterId, projectId) as Record<string, unknown> | undefined

  if (!row) return null

  return {
    id: String(row.id),
    projectId: String(row.project_id),
    volumeId: String(row.volume_id),
    title: String(row.title),
    summary: String(row.summary),
    status: String(row.status),
    wordTarget: String(row.word_target),
    content: String(row.content),
    sortOrder: Number(row.sort_order)
  }
}

export async function listProjectChapters(projectId: string): Promise<ChapterSummaryItem[]> {
  const db = await ensureWorkspaceDb()
  const rows = db.prepare(
    'SELECT id, title, summary, status, content FROM chapters WHERE project_id = ? ORDER BY sort_order'
  ).all(projectId) as Record<string, unknown>[]

  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    summary: String(row.summary),
    status: String(row.status),
    wordCount: countChars(String(row.content))
  }))
}

export async function applyChapterEdit(
  projectId: string,
  chapterId: string,
  edit: ChapterEdit
): Promise<{ versionId: string; preview: string }> {
  const db = await ensureWorkspaceDb()

  const row = db.prepare(
    'SELECT id, title, summary, status, word_target, content FROM chapters WHERE id = ? AND project_id = ?'
  ).get(chapterId, projectId) as Record<string, unknown> | undefined

  if (!row) {
    throw new Error(`Chapter not found: ${chapterId}`)
  }

  const oldContent = String(row.content)
  const plainOld = stripHtmlTags(oldContent)

  const versionId = randomUUID()
  db.prepare(`
    INSERT INTO chapter_versions (id, project_id, chapter_id, title, summary, status, word_target, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId,
    projectId,
    chapterId,
    String(row.title),
    String(row.summary),
    String(row.status),
    String(row.word_target),
    oldContent,
    new Date().toISOString()
  )

  let newContent: string
  let preview: string

  if (edit.operation === 'append') {
    const htmlToAppend = textToHtmlParagraphs(edit.content)
    newContent = oldContent + htmlToAppend
    preview = `Appended ${edit.content.length} chars`
  } else if (edit.operation === 'replace') {
    if (!edit.search) {
      throw new Error('replace requires search')
    }
    const searchText = edit.search.trim()
    if (!plainOld.includes(searchText)) {
      throw new Error(`Could not find target text: "${searchText.slice(0, 50)}..."`)
    }
    newContent = replaceInHtml(oldContent, searchText, edit.content)
    preview = `Replaced "${searchText.slice(0, 30)}..." -> "${edit.content.slice(0, 30)}..."`
  } else if (edit.operation === 'insert') {
    if (!edit.search && edit.position !== 'start' && edit.position !== 'end') {
      throw new Error('insert requires search or start/end position')
    }
    const htmlToInsert = textToHtmlParagraphs(edit.content)
    if (edit.position === 'start') {
      newContent = htmlToInsert + oldContent
    } else if (edit.position === 'end' || !edit.search) {
      newContent = oldContent + htmlToInsert
    } else {
      newContent = insertInHtml(oldContent, edit.search, htmlToInsert, edit.position ?? 'after')
    }
    preview = `Inserted ${edit.content.length} chars`
  } else {
    throw new Error(`Unsupported operation: ${edit.operation}`)
  }

  db.prepare('UPDATE chapters SET content = ? WHERE id = ? AND project_id = ?')
    .run(newContent, chapterId, projectId)

  return { versionId, preview }
}

export async function computeChapterEdit(
  projectId: string,
  chapterId: string,
  edit: ChapterEdit,
  overrideContent?: string
): Promise<{ oldContent: string; newContent: string; preview: string; chapterTitle: string }> {
  const db = await ensureWorkspaceDb()

  const row = db.prepare(
    'SELECT id, title, content FROM chapters WHERE id = ? AND project_id = ?'
  ).get(chapterId, projectId) as Record<string, unknown> | undefined

  if (!row) {
    throw new Error(`Chapter not found: ${chapterId}`)
  }

  const oldContent = overrideContent ?? String(row.content)
  const chapterTitle = String(row.title)
  const plainOld = stripHtmlTags(oldContent)

  let newContent: string
  let preview: string

  if (edit.operation === 'append') {
    const htmlToAppend = textToHtmlParagraphs(edit.content)
    newContent = oldContent + htmlToAppend
    preview = `Appended ${edit.content.length} chars`
  } else if (edit.operation === 'replace') {
    if (!edit.search) {
      throw new Error('replace requires search')
    }
    const searchText = edit.search.trim()
    if (!plainOld.includes(searchText)) {
      throw new Error(`Could not find target text: "${searchText.slice(0, 50)}..."`)
    }
    newContent = replaceInHtml(oldContent, searchText, edit.content)
    preview = `Replaced "${searchText.slice(0, 30)}..." -> "${edit.content.slice(0, 30)}..."`
  } else if (edit.operation === 'insert') {
    if (!edit.search && edit.position !== 'start' && edit.position !== 'end') {
      throw new Error('insert requires search or start/end position')
    }
    const htmlToInsert = textToHtmlParagraphs(edit.content)
    if (edit.position === 'start') {
      newContent = htmlToInsert + oldContent
    } else if (edit.position === 'end' || !edit.search) {
      newContent = oldContent + htmlToInsert
    } else {
      newContent = insertInHtml(oldContent, edit.search, htmlToInsert, edit.position ?? 'after')
    }
    preview = `Inserted ${edit.content.length} chars`
  } else {
    throw new Error(`Unsupported operation: ${edit.operation}`)
  }

  return { oldContent, newContent, preview, chapterTitle }
}

export async function commitChapterEdit(
  projectId: string,
  chapterId: string,
  oldContent: string,
  newContent: string
): Promise<{ versionId: string }> {
  const db = await ensureWorkspaceDb()

  const row = db.prepare(
    'SELECT title, summary, status, word_target FROM chapters WHERE id = ? AND project_id = ?'
  ).get(chapterId, projectId) as Record<string, unknown> | undefined

  if (!row) {
    throw new Error(`Chapter not found: ${chapterId}`)
  }

  const versionId = randomUUID()
  db.prepare(`
    INSERT INTO chapter_versions (id, project_id, chapter_id, title, summary, status, word_target, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId,
    projectId,
    chapterId,
    String(row.title),
    String(row.summary),
    String(row.status),
    String(row.word_target),
    oldContent,
    new Date().toISOString()
  )

  db.prepare('UPDATE chapters SET content = ? WHERE id = ? AND project_id = ?')
    .run(newContent, chapterId, projectId)

  return { versionId }
}

export async function searchProjectData(
  projectId: string,
  query: string,
  scope?: string[],
  maxResults = 10
): Promise<SearchResult[]> {
  const db = await ensureWorkspaceDb()
  const results: SearchResult[] = []
  const normalizedQuery = query.trim().toLowerCase()
  const scopeSet = normalizeSearchScope(scope)
  const shouldSearch = (name: string) => !scopeSet || scopeSet.has(name)

  const push = (result: SearchResult): void => {
    if (results.length < maxResults) {
      results.push(result)
    }
  }

  if (shouldSearch('worldview')) {
    const rows = db.prepare('SELECT id, title, content FROM worldview_entries WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const title = String(row.title)
      const content = String(row.content)
      if (matchesQuery(normalizedQuery, title, content)) {
        push({ entityType: 'worldview', entityId: id, type: 'worldview', title, content: truncateSnippet(content) })
      }
    }
  }

  if (shouldSearch('characters')) {
    const rows = db.prepare('SELECT id, name, role, description FROM characters WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const name = String(row.name)
      const role = String(row.role ?? '')
      const description = String(row.description ?? '')
      if (matchesQuery(normalizedQuery, name, role, description)) {
        push({
          entityType: 'characters',
          entityId: id,
          type: 'characters',
          title: role ? `${name} (${role})` : name,
          content: truncateSnippet(description)
        })
      }
    }
  }

  if (shouldSearch('organizations')) {
    const rows = db.prepare('SELECT id, name, type, description, motto FROM organizations WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const name = String(row.name)
      const type = String(row.type ?? '')
      const description = String(row.description ?? '')
      const motto = String(row.motto ?? '')
      if (matchesQuery(normalizedQuery, name, type, description, motto)) {
        push({
          entityType: 'organizations',
          entityId: id,
          type: 'organizations',
          title: type ? `${name} (${type})` : name,
          content: truncateSnippet([description, motto ? `Motto: ${motto}` : ''].filter(Boolean).join(' | '))
        })
      }
    }
  }

  if (shouldSearch('organization_memberships')) {
    const chars = db.prepare('SELECT id, name FROM characters WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
    const orgs = db.prepare('SELECT id, name FROM organizations WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
    const charMap = new Map(chars.map((item) => [String(item.id), String(item.name)]))
    const orgMap = new Map(orgs.map((item) => [String(item.id), String(item.name)]))
    const rows = db.prepare('SELECT id, character_id, organization_id, role, notes FROM organization_memberships WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const character = charMap.get(String(row.character_id)) ?? String(row.character_id)
      const organization = orgMap.get(String(row.organization_id)) ?? String(row.organization_id)
      const role = String(row.role ?? '')
      const notes = String(row.notes ?? '')
      const title = `${character} -> ${organization}${role ? ` (${role})` : ''}`
      if (matchesQuery(normalizedQuery, character, organization, role, notes)) {
        push({
          entityType: 'organization_memberships',
          entityId: id,
          type: 'organization_memberships',
          title,
          content: truncateSnippet(notes)
        })
      }
    }
  }

  if (shouldSearch('relationships')) {
    const rows = db.prepare('SELECT id, from_character_id, to_character_id, type, description FROM character_relationships WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const from = String(row.from_character_id)
      const to = String(row.to_character_id)
      const type = String(row.type ?? '')
      const description = String(row.description ?? '')
      const title = `${from} -> ${to}${type ? ` (${type})` : ''}`
      if (matchesQuery(normalizedQuery, title, description, type)) {
        push({
          entityType: 'relationships',
          entityId: id,
          type: 'relationships',
          title,
          content: truncateSnippet(description)
        })
      }
    }
  }

  if (shouldSearch('outline')) {
    const rows = db.prepare('SELECT id, title, summary, conflict FROM outline_items WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const title = String(row.title)
      const summary = String(row.summary ?? '')
      const conflict = String(row.conflict ?? '')
      if (matchesQuery(normalizedQuery, title, summary, conflict)) {
        push({
          entityType: 'outline',
          entityId: id,
          type: 'outline',
          title,
          content: truncateSnippet([summary, conflict].filter(Boolean).join(' | '))
        })
      }
    }
  }

  if (shouldSearch('chapters')) {
    const rows = db.prepare('SELECT id, title, summary, content FROM chapters WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const title = String(row.title)
      const summary = String(row.summary ?? '')
      const content = stripHtmlTags(String(row.content ?? ''))
      if (matchesQuery(normalizedQuery, title, summary, content)) {
        push({
          entityType: 'chapters',
          entityId: id,
          type: 'chapters',
          title,
          content: truncateSnippet(summary || content, 500)
        })
      }
    }
  }

  if (shouldSearch('knowledge')) {
    const rows = db.prepare('SELECT id, title, content, summary FROM knowledge_documents WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const title = String(row.title)
      const summary = String(row.summary ?? '')
      const content = String(row.content ?? '')
      if (matchesQuery(normalizedQuery, title, summary, content)) {
        push({
          entityType: 'knowledge',
          entityId: id,
          type: 'knowledge',
          title,
          content: truncateSnippet(summary || content)
        })
      }
    }
  }

  if (shouldSearch('deconstruction_library')) {
    const rows = db.prepare("SELECT id, title, content, summary, source_label FROM knowledge_documents WHERE project_id = '' OR project_id IS NULL").all() as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const title = String(row.title)
      const summary = String(row.summary ?? '')
      const content = String(row.content ?? '')
      const sourceLabel = String(row.source_label ?? '')
      if (matchesQuery(normalizedQuery, title, summary, content, sourceLabel)) {
        push({
          entityType: 'deconstruction_library',
          entityId: id,
          type: 'deconstruction_library',
          title,
          content: truncateSnippet(summary || content)
        })
      }
    }
  }

  if (shouldSearch('available_deconstructions')) {
    const rows = readPublicReferenceWorkRows(db)
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const title = String(row.title)
      const source = String(row.source ?? '')
      const notes = String(row.notes ?? '')
      const fileName = String(row.file_name ?? '')
      const analysis = String(row.analysis_json ?? '')
      if (matchesQuery(normalizedQuery, title, source, notes, fileName, analysis)) {
        push({
          entityType: 'available_deconstructions',
          entityId: id,
          type: 'available_deconstructions',
          title,
          content: truncateSnippet(notes || analysis)
        })
      }
    }
  }

  if (shouldSearch('reference_works')) {
    const rows = db.prepare('SELECT id, title, source, notes, file_name, analysis_json FROM reference_works').all() as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const title = String(row.title)
      const source = String(row.source ?? '')
      const notes = String(row.notes ?? '')
      const fileName = String(row.file_name ?? '')
      const analysis = String(row.analysis_json ?? '')
      if (matchesQuery(normalizedQuery, title, source, notes, fileName, analysis)) {
        push({
          entityType: 'reference_works',
          entityId: id,
          type: 'reference_works',
          title,
          content: truncateSnippet(notes || analysis)
        })
      }
    }
  }

  if (shouldSearch('inspiration')) {
    const rows = db.prepare('SELECT id, title, content, source FROM inspiration_entries WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const title = String(row.title)
      const content = String(row.content ?? '')
      const source = String(row.source ?? '')
      if (matchesQuery(normalizedQuery, title, content, source)) {
        push({
          entityType: 'inspiration',
          entityId: id,
          type: 'inspiration',
          title,
          content: truncateSnippet(content)
        })
      }
    }
  }

  if (shouldSearch('plot_threads')) {
    const rows = db.prepare('SELECT id, title, description FROM plot_threads WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const title = String(row.title)
      const description = String(row.description ?? '')
      if (matchesQuery(normalizedQuery, title, description)) {
        push({
          entityType: 'plot_threads',
          entityId: id,
          type: 'plot_threads',
          title,
          content: truncateSnippet(description)
        })
      }
    }
  }

  if (shouldSearch('workflow_documents')) {
    const rows = db.prepare('SELECT id, title, doc_key, content FROM workflow_documents WHERE project_id = ? ORDER BY sort_order').all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const title = String(row.title)
      const docKey = String(row.doc_key ?? '')
      const content = String(row.content ?? '')
      if (matchesQuery(normalizedQuery, title, docKey, content)) {
        push({
          entityType: 'workflow_documents',
          entityId: id,
          type: 'workflow_documents',
          title: docKey ? `${title} (${docKey})` : title,
          content: truncateSnippet(content)
        })
      }
    }
  }

  if (shouldSearch('project_constraints')) {
    const rows = db.prepare(`
      SELECT id, title, content, summary
      FROM knowledge_documents
      WHERE project_id = ? AND source_type = 'canon-fact' AND source_label = 'global-constraint'
      ORDER BY updated_at DESC
    `).all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const id = String(row.id)
      const title = String(row.title)
      const summary = String(row.summary ?? '')
      const content = String(row.content ?? '')
      if (matchesQuery(normalizedQuery, title, summary, content)) {
        push({
          entityType: 'project_constraints',
          entityId: id,
          type: 'project_constraints',
          title,
          content: truncateSnippet(summary || content)
        })
      }
    }
  }

  return results
}
