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

function buildWhitespaceInsensitiveIndex(text: string): { value: string; indexMap: number[] } {
  let value = ''
  const indexMap: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    if (/\s/.test(text[i])) continue
    value += text[i]
    indexMap.push(i)
  }
  return { value, indexMap }
}

function findPlainTextRange(plain: string, search: string): { start: number; end: number } | null {
  const target = search.trim()
  if (!target) return null

  const exactStart = plain.indexOf(target)
  if (exactStart !== -1) {
    return { start: exactStart, end: exactStart + target.length }
  }

  const compactTarget = target.replace(/\s+/g, '')
  if (!compactTarget) return null

  const compactPlain = buildWhitespaceInsensitiveIndex(plain)
  const compactStart = compactPlain.value.indexOf(compactTarget)
  if (compactStart === -1) return null

  const compactEnd = compactStart + compactTarget.length - 1
  return {
    start: compactPlain.indexMap[compactStart],
    end: compactPlain.indexMap[compactEnd] + 1
  }
}

function replaceInHtml(html: string, search: string, replacement: string): string {
  const plain = stripHtmlTags(html)
  const range = findPlainTextRange(plain, search)
  if (!range) {
    throw new Error(`Could not find target text: "${search.slice(0, 50)}..."`)
  }
  const htmlStart = mapPlainIndexToHtml(html, range.start)
  const htmlEnd = mapPlainIndexToHtml(html, range.end)
  return html.slice(0, htmlStart) + textToHtmlParagraphs(replacement) + html.slice(htmlEnd)
}

function insertInHtml(html: string, search: string, insertionHtml: string, position: 'before' | 'after'): string {
  const plain = stripHtmlTags(html)
  const range = findPlainTextRange(plain, search)
  if (!range) {
    throw new Error(`Could not find anchor text: "${search.slice(0, 50)}..."`)
  }
  const anchorIdx = position === 'before'
    ? mapPlainIndexToHtml(html, range.start)
    : mapPlainIndexToHtml(html, range.end)
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

/** 将章节 ID、标题、序号或“第一章”一类自然引用解析为当前项目的章节 ID。 */
export async function resolveProjectChapterId(projectId: string, ref: string): Promise<string> {
  const rawRef = ref.trim()
  if (!rawRef) return ''

  const direct = await readChapterFromDb(projectId, rawRef)
  if (direct) return direct.id

  const chapters = await listProjectChapters(projectId)
  const normalizedRef = normalizeNaturalRef(rawRef)
  const ordinal = parseOrdinalRef(rawRef)
  if (ordinal !== null && ordinal >= 1 && ordinal <= chapters.length) {
    return chapters[ordinal - 1].id
  }

  const exactTitle = chapters.find((chapter) => normalizeNaturalRef(chapter.title) === normalizedRef)
  if (exactTitle) return exactTitle.id

  const titleContains = chapters.filter((chapter) => normalizeNaturalRef(chapter.title).includes(normalizedRef))
  if (titleContains.length === 1) return titleContains[0].id

  if (!chapters.length) throw new Error('当前项目还没有章节。')
  const options = chapters
    .slice(0, 20)
    .map((chapter, index) => `${index + 1}. ${chapter.title}`)
    .join('\n')
  throw new Error(`无法定位章节“${rawRef}”。请根据章节列表自行选择最可能的目标，必要时再询问用户：\n${options}`)
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
    if (!searchText) {
      throw new Error('replace requires search')
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
      newContent = insertInHtml(oldContent, edit.search.trim(), htmlToInsert, edit.position ?? 'after')
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
): Promise<{ oldContent: string; newContent: string; preview: string; chapterTitle: string; beforeFragment: string; afterFragment: string }> {
  const db = await ensureWorkspaceDb()

  const row = db.prepare(
    'SELECT id, title, content FROM chapters WHERE id = ? AND project_id = ?'
  ).get(chapterId, projectId) as Record<string, unknown> | undefined

  if (!row) {
    throw new Error(`Chapter not found: ${chapterId}`)
  }

  const oldContent = overrideContent ?? String(row.content)
  const chapterTitle = String(row.title)

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
    if (!searchText) {
      throw new Error('replace requires search')
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
      newContent = insertInHtml(oldContent, edit.search.trim(), htmlToInsert, edit.position ?? 'after')
    }
    preview = `Inserted ${edit.content.length} chars`
  } else {
    throw new Error(`Unsupported operation: ${edit.operation}`)
  }

  return {
    oldContent,
    newContent,
    preview,
    chapterTitle,
    // 只包含变更片段，用于 diff 展示（不是整章）
    beforeFragment: edit.operation === 'replace' ? (edit.search?.trim() ?? '') : '',
    afterFragment: edit.content
  }
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
    const rows = db.prepare('SELECT id, title, summary, conflict FROM outline_items WHERE project_id = ? ORDER BY sort_order').all(projectId) as Record<string, unknown>[]
    const ordinal = parseOrdinalRef(query)
    if (ordinal !== null && ordinal >= 1 && ordinal <= rows.length) {
      const row = rows[ordinal - 1]
      const id = String(row.id)
      const title = String(row.title)
      const summary = String(row.summary ?? '')
      const conflict = String(row.conflict ?? '')
      push({
        entityType: 'outline',
        entityId: id,
        type: 'outline',
        title: `${ordinal}. ${title}`,
        content: truncateSnippet([summary, conflict].filter(Boolean).join(' | '))
      })
    }
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
