/**
 * 叙事功能到 Skill 参考文件的映射表。
 * 用于在 matcher 中根据章节的叙事功能（从大纲/摘要推断）增加相关 skill 的匹配分数。
 */

type NarrativeFunctionEntry = {
  keywords: string[]
  skillPatterns: string[]
}

const NARRATIVE_FUNCTION_MAP: NarrativeFunctionEntry[] = [
  {
    keywords: ['背叛', '反转', '真相', '揭露', '欺骗', '阴谋', '暴露'],
    skillPatterns: ['reversal', 'hooks']
  },
  {
    keywords: ['战斗', '打斗', '交手', '对决', '围攻', '厮杀', '追杀'],
    skillPatterns: ['combat', 'style-combat']
  },
  {
    keywords: ['告白', '表白', '感情', '心动', '暧昧', '分手', '重逢'],
    skillPatterns: ['emotional', 'emotion']
  },
  {
    keywords: ['升级', '突破', '觉醒', '进化', '获得', '传承'],
    skillPatterns: ['genre', 'commercial']
  },
  {
    keywords: ['对话', '谈判', '审讯', '说服', '争吵', '辩论'],
    skillPatterns: ['dialogue']
  },
  {
    keywords: ['开篇', '第一章', '开头', '序章', '引子'],
    skillPatterns: ['opening', 'hooks']
  },
  {
    keywords: ['布局', '铺垫', '伏笔', '暗线', '悬念'],
    skillPatterns: ['hooks', 'plot']
  },
  {
    keywords: ['高潮', '决战', '最终', '终极', '生死'],
    skillPatterns: ['plot', 'emotional', 'reversal']
  },
  {
    keywords: ['日常', '过渡', '休息', '恢复', '准备'],
    skillPatterns: ['craft', 'writing-craft']
  },
  {
    keywords: ['世界', '设定', '规则', '体系', '势力'],
    skillPatterns: ['genre', 'worldbuild']
  }
]

/**
 * 根据叙事上下文文本（章节摘要、大纲冲突等）判断哪些 skill ID 模式应该获得加分。
 * @returns 匹配到的 skill ID 子串模式列表
 */
export function matchNarrativeFunction(narrativeText: string): string[] {
  if (!narrativeText.trim()) return []

  const matched = new Set<string>()
  const lower = narrativeText.toLowerCase()

  for (const entry of NARRATIVE_FUNCTION_MAP) {
    const hits = entry.keywords.filter((kw) => lower.includes(kw))
    if (hits.length > 0) {
      for (const pattern of entry.skillPatterns) {
        matched.add(pattern)
      }
    }
  }

  return Array.from(matched)
}
