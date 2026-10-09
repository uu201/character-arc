/** 旧版向导将简介写入“故事开端”的分卷摘要；独立字段（包括主动清空）优先。 */
export function resolveProjectPremise(
  project: { premise?: string | null } | null | undefined,
  volumes: ReadonlyArray<{ title: string; summary: string }> = []
): string | undefined {
  if (typeof project?.premise === 'string') return project.premise.trim()

  const premiseVolume = volumes.find((volume) => volume.title === '故事开端')
  if (!premiseVolume) return undefined
  const summary = premiseVolume.summary.trim()
  const placeholders = [
    '用于集中推进故事主冲突，并在较短篇幅内完成完整闭环。',
    '用于承接作品最初的主线冲突、角色出场和后续长线铺垫。'
  ]
  return !summary || placeholders.includes(summary) ? undefined : summary
}
