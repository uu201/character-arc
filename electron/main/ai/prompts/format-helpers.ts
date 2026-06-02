/**
 * 将组织数据格式化为可读文本，最多取前 6 条。
 *
 * @param source 组织数组数据
 * @returns 格式化后的组织信息字符串，无数据时返回空串
 */
export function formatOrganizations(source: unknown): string {
  return Array.isArray(source)
    ? source
        .slice(0, 6)
        .map((entry) => {
          const record = entry as Record<string, unknown>
          return `${String(record.name ?? '')} / ${String(record.type ?? '')}：${String(record.description ?? '')}${record.motto ? `（信条：${String(record.motto)}）` : ''}`
        })
        .join('\n')
    : ''
}

/**
 * 将角色关系数据格式化为可读文本，最多取前 8 条。
 *
 * @param source 角色关系数组数据
 * @param charactersSource 角色数组，用于将 ID 解析为角色名
 * @returns 格式化后的关系信息字符串，无数据时返回空串
 */
export function formatCharacterRelationships(source: unknown, charactersSource: unknown): string {
  if (!Array.isArray(source)) return ''
  const characterNameMap = new Map(
    Array.isArray(charactersSource)
      ? charactersSource.map((character) => {
          const record = character as Record<string, unknown>
          return [String(record.id ?? ''), String(record.name ?? '')]
        })
      : []
  )
  return source
    .slice(0, 8)
    .map((entry) => {
      const record = entry as Record<string, unknown>
      const fromName = characterNameMap.get(String(record.fromCharacterId ?? '')) || String(record.fromCharacterId ?? '')
      const toName = characterNameMap.get(String(record.toCharacterId ?? '')) || String(record.toCharacterId ?? '')
      return `${fromName} -> ${toName} / ${String(record.type ?? '')}：${String(record.description ?? '')}（强度 ${String(record.intensity ?? '')}）`
    })
    .join('\n')
}

/**
 * 将角色-组织归属关系格式化为可读文本，最多取前 8 条。
 *
 * @param membershipsSource 归属关系数组数据
 * @param organizationsSource 组织数组，用于将组织 ID 解析为名称
 * @param charactersSource 角色数组，用于将角色 ID 解析为名称
 * @returns 格式化后的归属信息字符串，无数据时返回空串
 */
export function formatOrganizationMemberships(membershipsSource: unknown, organizationsSource: unknown, charactersSource: unknown): string {
  if (!Array.isArray(membershipsSource)) return ''
  const organizationNameMap = new Map(
    Array.isArray(organizationsSource)
      ? organizationsSource.map((org) => {
          const record = org as Record<string, unknown>
          return [String(record.id ?? ''), String(record.name ?? '')]
        })
      : []
  )
  const characterNameMap = new Map(
    Array.isArray(charactersSource)
      ? charactersSource.map((character) => {
          const record = character as Record<string, unknown>
          return [String(record.id ?? ''), String(record.name ?? '')]
        })
      : []
  )
  return membershipsSource
    .slice(0, 8)
    .map((entry) => {
      const record = entry as Record<string, unknown>
      const characterName = characterNameMap.get(String(record.characterId ?? '')) || String(record.characterId ?? '')
      const organizationName = organizationNameMap.get(String(record.organizationId ?? '')) || String(record.organizationId ?? '')
      return `${characterName} 属于 ${organizationName} / 身份：${String(record.role ?? '')}${record.notes ? ` / 备注：${String(record.notes)}` : ''}`
    })
    .join('\n')
}

/**
 * 将世界观设定条目格式化为可读文本，最多取前 8 条。
 *
 * @param source 世界观条目数组数据
 * @returns 格式化后的设定信息字符串，无数据时返回空串
 */
export function formatWorldviewEntries(source: unknown): string {
  return Array.isArray(source)
    ? source
        .slice(0, 8)
        .map((entry) => `${String((entry as Record<string, unknown>).title ?? '')}：${String((entry as Record<string, unknown>).content ?? '')}`)
        .join('\n')
    : ''
}

/**
 * 将角色数据格式化为可读文本，最多取前 8 条。
 *
 * @param source 角色数组数据
 * @returns 格式化后的角色信息字符串，无数据时返回空串
 */
export function formatCharacters(source: unknown): string {
  return Array.isArray(source)
    ? source
        .slice(0, 8)
        .map((character) => `${String((character as Record<string, unknown>).name ?? '')} / ${String((character as Record<string, unknown>).role ?? '')}：${String((character as Record<string, unknown>).description ?? '')}`)
        .join('\n')
    : ''
}

/**
 * 将灵感卡片数据格式化为可读文本，最多取前 6 条。
 *
 * @param source 灵感条目数组数据
 * @returns 格式化后的灵感信息字符串，无数据时返回空串
 */
export function formatInspirationEntries(source: unknown): string {
  return Array.isArray(source)
    ? source
        .slice(0, 6)
        .map((entry) => {
          const record = entry as Record<string, unknown>
          const tags = Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)).join('、') : ''
          return `${String(record.type ?? '')} / ${String(record.title ?? '')}：${String(record.content ?? '')}${tags ? `（标签：${tags}）` : ''}`
        })
        .join('\n')
    : ''
}

/**
 * 将大纲条目格式化为可读文本，最多取前 6 条。
 *
 * @param source 大纲条目数组数据
 * @returns 格式化后的大纲信息字符串，无数据时返回空串
 */
export function formatOutlineItems(source: unknown): string {
  return Array.isArray(source)
    ? source
        .slice(0, 6)
        .map((item) => {
          const record = item as Record<string, unknown>
          const marker = record.isCurrent ? '【当前】' : ''
          const conflict = String(record.conflict ?? '').trim()
          return `${marker}${String(record.title ?? '')}${conflict ? ` / 冲突：${conflict}` : ''}：${String(record.summary ?? '')}`
        })
        .join('\n')
    : ''
}

/**
 * 将当前章节绑定的大纲节点格式化为写作边界。
 *
 * @param source 当前大纲节点数据
 * @returns 格式化后的当前大纲字符串，无数据时返回空串
 */
export function formatCurrentOutlineItem(source: unknown): string {
  if (!source || typeof source !== 'object') return ''
  const record = source as Record<string, unknown>
  const title = String(record.title ?? '').trim()
  const summary = String(record.summary ?? '').trim()
  const conflict = String(record.conflict ?? '').trim()
  const wordTarget = String(record.wordTarget ?? '').trim()
  if (!title && !summary && !conflict) return ''
  return [
    title ? `标题：${title}` : '',
    wordTarget ? `大纲预估：${wordTarget}` : '',
    conflict ? `核心冲突：${conflict}` : '',
    summary ? `剧情边界：${summary}` : ''
  ].filter(Boolean).join('\n')
}

/**
 * 将同一大纲拆章信息格式化，提醒模型续写当前拆分段落而非复写。
 *
 * @param source 拆章位置与前置同纲章节
 * @returns 格式化后的拆章说明，无数据时返回空串
 */
export function formatOutlineChapterSplit(source: unknown): string {
  if (!source || typeof source !== 'object') return ''
  const record = source as Record<string, unknown>
  const currentPart = Number(record.currentPart ?? 1)
  const totalParts = Number(record.totalParts ?? 1)
  const previousParts = Array.isArray(record.previousParts) ? record.previousParts : []
  const header = `当前是同一大纲下的第 ${Number.isFinite(currentPart) ? currentPart : 1} / ${Number.isFinite(totalParts) ? Math.max(totalParts, 1) : 1} 章。`
  if (previousParts.length === 0) {
    return `${header}\n前面还没有同纲章节；本章从该大纲节点的起点展开。`
  }
  const previous = previousParts
    .map((item, index) => {
      const part = item as Record<string, unknown>
      return `同纲前置章节${index + 1}：${String(part.title ?? '')}\n摘要：${String(part.summary ?? '') || '暂无摘要'}\n正文预览：${String(part.preview ?? '') || '暂无'}`
    })
    .join('\n\n')
  return `${header}\n本章必须承接以下同纲前置章节，避免重复已经写过的事件，只展开后续/剩余部分：\n${previous}`
}

/**
 * 将关联章节数据格式化为可读文本，最多取前 4 条。
 *
 * @param source 关联章节数组数据
 * @returns 格式化后的关联章节信息字符串，无数据时返回空串
 */
export function formatRelatedChapters(source: unknown): string {
  return Array.isArray(source)
    ? source
        .slice(0, 4)
        .map((item, index) => {
          const record = item as Record<string, unknown>
          return `关联章节${index + 1}：${String(record.title ?? '')}\n摘要：${String(record.summary ?? '')}\n正文预览：${String(record.preview ?? '')}`
        })
        .join('\n\n')
    : ''
}

/**
 * 将分卷下各章节摘要格式化为可读文本。
 *
 * @param source 章节数组数据，需包含 title 和 summary 字段
 * @returns 格式化后的章节摘要列表字符串，无数据时返回空串
 */
export function formatVolumeChapterSummaries(source: unknown): string {
  return Array.isArray(source)
    ? source
        .map((item, index) => {
          const record = item as Record<string, unknown>
          return `第${index + 1}节：${String(record.title ?? '')}\n  摘要：${String(record.summary ?? '') || '暂无摘要'}`
        })
        .join('\n\n')
    : ''
}

/**
 * 将小说开篇信息格式化为标题和摘要。
 *
 * @param source 包含 title 和 summary 的对象数据
 * @returns 格式化后的开篇摘要字符串，无数据时返回空串
 */
export function formatNovelOpenerSummary(source: unknown): string {
  if (!source) return ''
  const record = source as Record<string, unknown>
  return `标题：${String(record.title ?? '')}\n摘要：${String(record.summary ?? '') || '暂无摘要'}`
}

/**
 * 将状态为 open 的未关闭伏笔格式化为可读文本。
 *
 * @param source 伏笔/剧情线程数组数据
 * @returns 格式化后的未关闭伏笔信息字符串，无数据时返回空串
 */
export function formatOpenPlotThreads(source: unknown): string {
  return Array.isArray(source)
    ? source
        .filter((t) => (t as Record<string, unknown>).status === 'open')
        .map((t) => {
          const record = t as Record<string, unknown>
          return `- ${String(record.title ?? '')}：${String(record.description ?? '')}`
        })
        .join('\n')
    : ''
}

/**
 * 将最近的对话消息格式化为可读文本，最多取最后 4 条。
 *
 * @param source 消息数组数据，需包含 role 和 content 字段
 * @returns 格式化后的对话记录字符串，无数据时返回空串
 */
export function formatRecentMessages(source: unknown): string {
  return Array.isArray(source)
    ? source
        .slice(-4)
        .map((item) => {
          const record = item as Record<string, unknown>
          const role = String(record.role ?? '') === 'assistant' ? '助理' : '用户'
          return `${role}：${String(record.content ?? '')}`
        })
        .join('\n')
    : ''
}
