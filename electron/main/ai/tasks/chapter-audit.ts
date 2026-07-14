import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, ChapterAuditResult } from '../shared-types'
import { formatProjectSkillsContext } from '../prompts/shared'

const VALID_SEVERITIES = new Set(['critical', 'warning', 'hint'])
const CHAPTER_AUDIT_MAX_TOKENS = 26000

function normalizeChinesePunctuation(value: string): string {
  return value
    .replace(/「\s+/g, '「')
    .replace(/\s+」/g, '」')
    .replace(/『\s+/g, '『')
    .replace(/\s+』/g, '』')
    .replace(/\s+([，。！？；：、])/g, '$1')
    .replace(/([（【《])\s+/g, '$1')
    .replace(/\s+([）】》])/g, '$1')
    .trim()
}

const handler: TaskHandler = {
  name: 'chapter-audit',
  outputType: 'json',
  defaultCapabilities: ['settings', 'chapters', 'analysis'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock } = input
    const draftText = String(context.draftText ?? '').trim()
    const memo = context.chapterMemo as Record<string, unknown> | undefined
    const targetWordCount = String(context.targetWordCount ?? '').trim()
    const projectSkillsBlock = formatProjectSkillsContext(context.projectSkills)
    const effectiveSkillsBlock = [projectSkillsBlock, skillsBlock].filter(Boolean).join('\n\n')
    const extraAuditRules = [
      effectiveSkillsBlock ? `本步骤启用 skills：\n${effectiveSkillsBlock}` : '',
      String(context.userPrompt ?? '').trim() ? `本步骤补充审计要求：${String(context.userPrompt).trim()}` : ''
    ].filter(Boolean).join('\n\n')

    const memoBlock = formatMemoForAudit(memo)

    return {
      system: `${capabilityPreamble.system}\n\n你是小说章节审计师。审计 Writer 刚生成的初稿是否在正文里真的兑现了写作备忘里的硬契约。只返回 JSON，不要 markdown。

审计维度（按这个顺序逐项检查）：
1. payoffs 兑现：备忘 payoffs 列表里的每一条，是否在正文里有可定位的具体动作 / 物件 / 对话兑现段（不能只是侧面提一嘴或内心提及）
2. endingChanges 落地：备忘 endingChanges 的每一条改变，是否真的在章末发生（信息变化 / 关系变化 / 物理变化 / 权力变化）
3. holds 守住：备忘 holds 的底牌是否被压住没掀
4. doNotDo 红线：是否触碰了备忘的红线
5. 开头钩子：前 100 字是否有具体动作 / 对话 / 反差 / 信息冲击 / 未完成动作
6. 章末钩子：是否有未完成动作或新信息把读者拉向下章（不是总结式收尾、鸡汤升华、廉价预告）
7. 字数：实际字数是否在目标 ±20% 内
8. 硬规则：是否出现破折号（——）、高疲劳词（冷笑/瞳孔骤缩/轰然炸裂/倒吸一口凉气/蝼蚁等）、章节内分隔符（---、#）

issue 格式：
- severity: "critical"（payoff 漏兑现 / endingChange 未发生 / 触碰红线）/"warning"（钩子弱 / 字数偏离）/"hint"（高疲劳词 / 句式单一）
- category: "payoff" / "ending-change" / "hold" / "do-not-do" / "opening-hook" / "ending-hook" / "word-count" / "hard-rule"
- ref: 备忘里对应的条目原文（payoff 类）或正文片段（其他类）
- hint: 一句话改进建议

返回格式：{"audit":{"pass":true|false,"wordCount":0,"issues":[{"severity":"","category":"","ref":"","hint":""}]}}

pass 判定：所有 critical issue 数 == 0 且 warning issue 数 <= 2 即 pass。`,
      user: `${capabilityPreamble.user}\n\n请审计以下章节初稿。\n\n${memoBlock}\n\n目标字数：${targetWordCount}${extraAuditRules ? `\n\n${extraAuditRules}` : ''}\n\n## 章节正文\n\n${draftText}\n\n返回审计 JSON。`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as { audit?: Partial<ChapterAuditResult['audit']> }
    const auditRaw = parsed.audit ?? {}
    const issuesRaw = Array.isArray(auditRaw.issues) ? auditRaw.issues : []
    const issues = issuesRaw
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const r = item as Record<string, unknown>
        const severity = String(r.severity ?? '').trim()
        if (!VALID_SEVERITIES.has(severity)) return null
        return {
          severity: severity as 'critical' | 'warning' | 'hint',
          category: normalizeChinesePunctuation(String(r.category ?? '')),
          ref: normalizeChinesePunctuation(String(r.ref ?? '')),
          hint: normalizeChinesePunctuation(String(r.hint ?? ''))
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    const wordCount = Number(auditRaw.wordCount ?? 0)
    return {
      audit: {
        pass: Boolean(auditRaw.pass),
        wordCount: Number.isFinite(wordCount) ? wordCount : 0,
        issues
      }
    } as ChapterAuditResult
  },
  validate(result: AiTaskResult): boolean {
    return Boolean((result as ChapterAuditResult).audit)
  },
  resolveMaxTokens(): number {
    return CHAPTER_AUDIT_MAX_TOKENS
  }
}

function formatMemoForAudit(memo: Record<string, unknown> | undefined): string {
  if (!memo) return '## 写作备忘\n\n（本章无写作备忘）'
  const list = (key: string): string => {
    const arr = memo[key]
    return Array.isArray(arr) && arr.length > 0
      ? arr.map((s) => `  - ${String(s)}`).join('\n')
      : '  - 无'
  }
  return [
    '## 写作备忘（审计基准）',
    `当前任务：${String(memo.currentTask ?? '未指定')}`,
    `读者期待：${String(memo.readerExpectation ?? '未指定')}`,
    '该兑现的（payoffs）：',
    list('payoffs'),
    '暂不掀的（holds）：',
    list('holds'),
    '章尾必须发生的改变（endingChanges）：',
    list('endingChanges'),
    '本章红线（doNotDo）：',
    list('doNotDo')
  ].join('\n')
}

export default handler
