export const WORLDVIEW_TYPES = ['地理', '法则', '物种', '势力', '历史'] as const

const TYPE_ALIASES: Record<string, (typeof WORLDVIEW_TYPES)[number]> = {
  geography: '地理', geographical: '地理', location: '地理', region: '地理', environment: '地理',
  law: '法则', laws: '法则', rule: '法则', rules: '法则', principle: '法则',
  species: '物种', race: '物种', creature: '物种',
  faction: '势力', power: '势力', organization: '势力', organisation: '势力',
  history: '历史', historical: '历史', timeline: '历史'
}

/** 将模型可能返回的英文分类归一为世界观面板使用的中文分类。 */
export function normalizeWorldviewType(value: unknown, fallback: string = '地理'): string {
  const raw = String(value ?? '').trim()
  if (WORLDVIEW_TYPES.includes(raw as (typeof WORLDVIEW_TYPES)[number])) return raw

  const key = raw.toLowerCase().replace(/[\s_-]+/g, '')
  const alias = TYPE_ALIASES[key]
  if (alias) return alias

  for (const [name, type] of Object.entries(TYPE_ALIASES)) {
    if (key.includes(name)) return type
  }

  return WORLDVIEW_TYPES.includes(fallback as (typeof WORLDVIEW_TYPES)[number]) ? fallback : '地理'
}
