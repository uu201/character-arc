export type ChapterVersionDiffSegment = {
  text: string
  changed: boolean
}

export type ChapterVersionCompareRow = {
  id: string
  before: string
  after: string
  beforeSegments: ChapterVersionDiffSegment[]
  afterSegments: ChapterVersionDiffSegment[]
  state: 'same' | 'removed' | 'added' | 'modified'
}

type RawCompareRow = Pick<ChapterVersionCompareRow, 'id' | 'before' | 'after' | 'state'>
type DiffOperation = { type: 'same' | 'removed' | 'added'; text: string }

const MAX_INLINE_LCS_CELLS = 250_000

function splitParagraphs(content: string): string[] {
  return content
    .split(String.fromCharCode(10))
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function appendOperation(operations: DiffOperation[], type: DiffOperation['type'], text: string): void {
  if (!text) return
  const previous = operations[operations.length - 1]
  if (previous?.type === type) previous.text += text
  else operations.push({ type, text })
}

function buildFallbackOperations(before: string[], after: string[]): DiffOperation[] {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1
  const operations: DiffOperation[] = []
  appendOperation(operations, 'same', before.slice(0, prefix).join(''))
  appendOperation(operations, 'removed', before.slice(prefix, before.length - suffix).join(''))
  appendOperation(operations, 'added', after.slice(prefix, after.length - suffix).join(''))
  appendOperation(operations, 'same', before.slice(before.length - suffix).join(''))
  return operations
}

function buildInlineOperations(beforeText: string, afterText: string): DiffOperation[] {
  const before = Array.from(beforeText)
  const after = Array.from(afterText)
  if (before.length * after.length > MAX_INLINE_LCS_CELLS) return buildFallbackOperations(before, after)
  const lcs = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1))
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const operations: DiffOperation[] = []
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      appendOperation(operations, 'same', before[i])
      i += 1
      j += 1
    } else if (i < before.length && (j >= after.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      appendOperation(operations, 'removed', before[i])
      i += 1
    } else {
      appendOperation(operations, 'added', after[j])
      j += 1
    }
  }
  return operations
}

function buildInlineSegments(before: string, after: string): {
  beforeSegments: ChapterVersionDiffSegment[]
  afterSegments: ChapterVersionDiffSegment[]
} {
  const operations = buildInlineOperations(before, after)
  return {
    beforeSegments: operations
      .filter((operation) => operation.type !== 'added')
      .map((operation) => ({ text: operation.text, changed: operation.type === 'removed' })),
    afterSegments: operations
      .filter((operation) => operation.type !== 'removed')
      .map((operation) => ({ text: operation.text, changed: operation.type === 'added' }))
  }
}

function paragraphSimilarity(before: string, after: string): number {
  const beforeChars = Array.from(before)
  const afterChars = Array.from(after)
  if (!beforeChars.length || !afterChars.length) return 0
  const counts = new Map<string, number>()
  for (const character of beforeChars) counts.set(character, (counts.get(character) ?? 0) + 1)
  let common = 0
  for (const character of afterChars) {
    const count = counts.get(character) ?? 0
    if (count > 0) {
      common += 1
      counts.set(character, count - 1)
    }
  }
  return (2 * common) / (beforeChars.length + afterChars.length)
}

function createRow(
  id: string,
  before: string,
  after: string,
  state: ChapterVersionCompareRow['state']
): ChapterVersionCompareRow {
  if (state === 'modified') return { id, before, after, state, ...buildInlineSegments(before, after) }
  return {
    id,
    before,
    after,
    state,
    beforeSegments: before ? [{ text: before, changed: state === 'removed' }] : [],
    afterSegments: after ? [{ text: after, changed: state === 'added' }] : []
  }
}

function mergeModifiedRows(rows: RawCompareRow[]): ChapterVersionCompareRow[] {
  const merged: ChapterVersionCompareRow[] = []
  let index = 0
  while (index < rows.length) {
    if (rows[index].state === 'same') {
      const row = rows[index]
      merged.push(createRow(row.id, row.before, row.after, 'same'))
      index += 1
      continue
    }
    const block: RawCompareRow[] = []
    while (index < rows.length && rows[index].state !== 'same') {
      block.push(rows[index])
      index += 1
    }
    const removed = block.filter((row) => row.state === 'removed')
    const added = block.filter((row) => row.state === 'added')
    const paired = Math.min(removed.length, added.length)
    for (let pairIndex = 0; pairIndex < paired; pairIndex++) {
      const before = removed[pairIndex].before
      const after = added[pairIndex].after
      if (paragraphSimilarity(before, after) >= 0.35) {
        merged.push(createRow('modified-' + removed[pairIndex].id + '-' + added[pairIndex].id, before, after, 'modified'))
      } else {
        merged.push(createRow(removed[pairIndex].id, before, '', 'removed'))
        merged.push(createRow(added[pairIndex].id, '', after, 'added'))
      }
    }
    for (let remaining = paired; remaining < removed.length; remaining++) {
      const row = removed[remaining]
      merged.push(createRow(row.id, row.before, '', 'removed'))
    }
    for (let remaining = paired; remaining < added.length; remaining++) {
      const row = added[remaining]
      merged.push(createRow(row.id, '', row.after, 'added'))
    }
  }
  return merged
}

export function buildChapterVersionCompareRows(
  beforeContent: string,
  afterContent: string
): ChapterVersionCompareRow[] {
  const before = splitParagraphs(beforeContent)
  const after = splitParagraphs(afterContent)
  const lcs = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1))
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const rows: RawCompareRow[] = []
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      rows.push({ id: 'same-' + i + '-' + j, before: before[i], after: after[j], state: 'same' })
      i += 1
      j += 1
    } else if (i < before.length && (j >= after.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      rows.push({ id: 'removed-' + i + '-' + j, before: before[i], after: '', state: 'removed' })
      i += 1
    } else {
      rows.push({ id: 'added-' + i + '-' + j, before: '', after: after[j], state: 'added' })
      j += 1
    }
  }
  return mergeModifiedRows(rows)
}
