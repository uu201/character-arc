type CandidateSkill = {
  id: string
  name: string
  manifest: { required?: boolean }
}

export type PrioritizedSkillCandidate = {
  skill: CandidateSkill
  breakdown: { total: number }
}

function normalizeMention(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[ \t]+/g, ' ').trim()
}

function resolveSkillMention(skill: Pick<CandidateSkill, 'id' | 'name'>, userPrompt: string): 'include' | 'exclude' | undefined {
  const prompt = normalizeMention(userPrompt)
  const mentions: Array<{ index: number; excluded: boolean }> = []
  for (const alias of new Set([skill.id, skill.name].map(normalizeMention).filter((value) => value.length >= 2))) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 英文 ID 必须完整命中，避免 story 匹配到 story-long-write。
    const before = /^[a-z0-9_-]/.test(alias) ? '(?<![a-z0-9_-])' : ''
    const after = /[a-z0-9_-]$/.test(alias) ? '(?![a-z0-9_-])' : ''
    for (const match of prompt.matchAll(new RegExp(`${before}${escaped}${after}`, 'g'))) {
      const prefix = prompt.slice(0, match.index).split(/[，,。；;！!？?\r\n]/).at(-1) ?? ''
      const directive = prefix.split(/(?:改用|而是(?:使用|用)?|但(?:是)?(?:请)?(?:使用|用)|but use|instead use)/).at(-1) ?? ''
      const excluded = /(?:不要|请勿|别|禁止|不再|无需|不必)(?:再)?(?:使用|调用|加载|启用|选用|选择|用)|不用|禁用|停用|排除|\b(?:without|avoid|(?:do not|don['’]t|never)\s+(?:use|load|enable))\b/.test(directive)
        || /(?:不要|别选|不选)\s*[`'"“”‘’]*$/.test(directive)
      mentions.push({ index: match.index, excluded })
    }
  }
  const last = mentions.sort((a, b) => a.index - b.index).at(-1)
  return last ? (last.excluded ? 'exclude' : 'include') : undefined
}

/** 用户点名时识别完整 ID/名称，并尊重同一请求中的否定与后续改口。 */
export function isSkillExplicitlyMentioned(skill: Pick<CandidateSkill, 'id' | 'name'>, userPrompt: string): boolean {
  return resolveSkillMention(skill, userPrompt) === 'include'
}

export function isSkillExplicitlyExcluded(skill: Pick<CandidateSkill, 'id' | 'name'>, userPrompt: string): boolean {
  return resolveSkillMention(skill, userPrompt) === 'exclude'
}

/**
 * 自动模式候选选择：required 与用户点名项优先保留，剩余名额再按评分填充。
 * 点名项不受普通候选数量上限挤压；若点名/必选项本身超过上限，则全部保留。
 */
export function selectSkillCandidates<T extends PrioritizedSkillCandidate>(
  entries: T[],
  userPrompt: string,
  maxSkills: number,
  compare: (a: T, b: T) => number
): T[] {
  const decorated = entries.filter((entry) => !isSkillExplicitlyExcluded(entry.skill, userPrompt)).map((entry) => ({
    entry,
    pinned: entry.skill.manifest.required === true || isSkillExplicitlyMentioned(entry.skill, userPrompt)
  }))
  const eligible = decorated.filter(({ entry, pinned }) => entry.breakdown.total > 0 || pinned)
  const pinned = eligible.filter((item) => item.pinned).map((item) => item.entry).sort(compare)
  const optional = eligible.filter((item) => !item.pinned).map((item) => item.entry).sort(compare)
  return [...pinned, ...optional.slice(0, Math.max(0, maxSkills - pinned.length))]
}
