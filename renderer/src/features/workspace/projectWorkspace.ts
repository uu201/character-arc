import type {
  ChapterDraft,
  ChapterVersion,
  ChatMessage,
  CharacterRelationship,
  CharacterCard,
  InspirationEntry,
  OrganizationEntry,
  OrganizationMembership,
  OutlineItem,
  OutlineVolume,
  ProjectWorkspaceData,
  WorldviewEntry
} from '@/types/app'
import { cloneOutlineVolumes, createOutlineVolume, ensureVolumeCollections } from '@/features/workspace/outlineVolumes'

// 将日期字符串安全转为 ISO 时间戳，无效值回退到当前时间
function toIsoTimestamp(value?: string): string {
  const parsed = value ? new Date(value) : null
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }

  return new Date().toISOString()
}

// 校正世界观条目：按 sortOrder 排序并确保时间戳合法
function normalizeWorldviewEntries(worldviewEntries?: WorldviewEntry[]): WorldviewEntry[] {
  const sortedEntries = (worldviewEntries ?? [])
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => (left.entry.sortOrder ?? left.index) - (right.entry.sortOrder ?? right.index))

  return sortedEntries.map(({ entry }, index) => {
    const createdAt = toIsoTimestamp(entry.createdAt)
    const updatedAt = toIsoTimestamp(entry.updatedAt || entry.createdAt)

    return {
      ...entry,
      sortOrder: index,
      createdAt,
      updatedAt
    }
  })
}

// 校正大纲条目：按 sortOrder 排序并重新分配连续索引
function normalizeOutlineItems(outlineItems?: OutlineItem[]): OutlineItem[] {
  const sortedItems = (outlineItems ?? [])
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (left.item.sortOrder ?? left.index) - (right.item.sortOrder ?? right.index))

  return sortedItems.map(({ item }, index) => ({
    ...item,
    sortOrder: index
  }))
}

// 校正灵感条目：排序、清理标签、规范化来源类型并确保时间戳
function normalizeInspirationEntries(inspirationEntries?: InspirationEntry[]): InspirationEntry[] {
  const sortedEntries = (inspirationEntries ?? [])
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => (left.entry.sortOrder ?? left.index) - (right.entry.sortOrder ?? right.index))

  return sortedEntries.map(({ entry }, index) => ({
    ...entry,
    tags: entry.tags?.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 5) ?? [], // 最多保留5个标签
    source: entry.source === 'manual' ? 'manual' : 'ai', // 来源只允许 'manual' 或 'ai' 两种值
    sortOrder: index,
    createdAt: toIsoTimestamp(entry.createdAt),
    updatedAt: toIsoTimestamp(entry.updatedAt || entry.createdAt)
  }))
}

// 校正组织条目：按 sortOrder 排序并确保时间戳合法
function normalizeOrganizations(organizations?: OrganizationEntry[]): OrganizationEntry[] {
  const sortedEntries = (organizations ?? [])
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => (left.entry.sortOrder ?? left.index) - (right.entry.sortOrder ?? right.index))

  return sortedEntries.map(({ entry }, index) => ({
    ...entry,
    sortOrder: index,
    createdAt: toIsoTimestamp(entry.createdAt),
    updatedAt: toIsoTimestamp(entry.updatedAt || entry.createdAt)
  }))
}

// 校正角色关系：将强度值限制在 0-100 范围内，默认 50
function normalizeCharacterRelationships(relationships?: CharacterRelationship[]): CharacterRelationship[] {
  return (relationships ?? []).map((relationship) => ({
    ...relationship,
    intensity: Number.isFinite(relationship.intensity) ? Math.min(100, Math.max(0, relationship.intensity)) : 50,
    createdAt: toIsoTimestamp(relationship.createdAt),
    updatedAt: toIsoTimestamp(relationship.updatedAt || relationship.createdAt)
  }))
}

// 校正组织成员关系：确保每条记录都有合法的时间戳
function normalizeOrganizationMemberships(memberships?: OrganizationMembership[]): OrganizationMembership[] {
  return (memberships ?? []).map((membership) => ({
    ...membership,
    createdAt: toIsoTimestamp(membership.createdAt),
    updatedAt: toIsoTimestamp(membership.updatedAt || membership.createdAt)
  }))
}

// ==================== 演示数据 ====================

// 演示世界观条目：赛博朋克背景下的时代、规则与地理设定
const demoWorldview: WorldviewEntry[] = [
  {
    id: 'world-1',
    type: '地理',
    title: '时代背景',
    content:
      '2077年，第四次企业战争结束后，全球能源被三大寡头公司垄断。下层阶级只能生存在终日下着酸雨的贫民窟，依靠走私二手义体和黑市芯片维持生活。意识上传技术初现端倪，被称为"赛博飞升"。',
    sortOrder: 0,
    createdAt: '2026-04-28T08:00:00.000Z',
    updatedAt: '2026-04-28T08:00:00.000Z'
  },
  {
    id: 'world-2',
    type: '法则',
    title: '核心规则：义体排异',
    content:
      '过度植入机械义体会导致神经系统崩溃，引发赛博精神病。唯一能延缓排异反应的药物"神经阻断剂"被公司严格控制，成为比货币更硬通的资源。',
    sortOrder: 1,
    createdAt: '2026-04-28T08:05:00.000Z',
    updatedAt: '2026-04-28T08:05:00.000Z'
  },
  {
    id: 'world-3',
    type: '物种',
    title: '地理环境：夜城（Night City）',
    content:
      '建在填海造陆上的超级都市，分为上层的云端区和底层的霓虹区。云端区拥有人造阳光，霓虹区则充满全息广告、酸雨和九龙城寨式建筑群。',
    sortOrder: 2,
    createdAt: '2026-04-28T08:10:00.000Z',
    updatedAt: '2026-04-28T08:10:00.000Z'
  }
]

// 演示角色卡：包含主角李雷、核心NPC艾达和配角老鬼
const demoCharacters: CharacterCard[] = [
  {
    id: 'char-1',
    name: '李雷',
    role: '男主',
    avatar: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)',
    description:
      '常年在底层的义体回收站工作，性格谨慎冷漠，但内心存有底线。右臂是拼装的二手军用义体，隐藏着某种未知的黑客后门。',
    tags: [
      { label: '底层回收者' },
      { label: '机械右臂', tone: 'danger' }
    ]
  },
  {
    id: 'char-2',
    name: '艾达',
    role: 'Ada',
    avatar: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)',
    description:
      '荒坂科技前高级研究员，脑内植入了极其危险的记忆锁，掌握着意识上传的核心代码，目前正被全城通缉。',
    tags: [
      { label: '公司叛逃者' },
      { label: '携带机密', tone: 'success' }
    ]
  },
  {
    id: 'char-3',
    name: '"老鬼"',
    role: '',
    avatar: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    description:
      '经营着一家地下诊所，为帮派分子和边缘人提供廉价手术和阻断剂。他是李雷为数不多可以信任的熟人。',
    tags: [
      { label: '黑市医生' },
      { label: '中立', tone: 'warning' }
    ]
  }
]

// 演示分卷大纲
const demoVolumes: OutlineVolume[] = [
  createOutlineVolume({
    id: 'volume-1',
    title: '霓虹下的老鼠',
    wordTarget: '目标 5万字',
    summary: '李雷被迫卷入企业阴谋，从底层回收者走向无法回头的逃亡与觉醒。'
  })
]

// 演示大纲条目：前两章的剧情规划
const demoOutline: OutlineItem[] = [
  {
    id: 'outline-1',
    volumeId: 'volume-1',
    title: '第1章：义体回收站的雨夜',
    wordTarget: '3000字',
    conflict: '平凡生活被打破。',
    summary:
      '李雷在回收站关门时，救下了头部受重伤且被追杀的公司女高管艾达。发现她脑内的军用级接口，李雷面临交出她还是藏匿她的抉择。',
    sortOrder: 0
  },
  {
    id: 'outline-2',
    volumeId: 'volume-1',
    title: '第2章：走私芯片',
    wordTarget: '预估 3000字',
    conflict: '公司杀手搜查贫民窟。',
    summary:
      '李雷利用回收站的铅板密室躲避了第一波搜查，并请老鬼来为艾达稳定伤情。老鬼警告李雷惹上了大麻烦。',
    sortOrder: 1
  }
]

// 演示组织：底层互助会与企业势力
const demoOrganizations: OrganizationEntry[] = [
  {
    id: 'org-1',
    name: '灰巷互助会',
    type: '地下据点',
    description: '活跃在霓虹区底层的互助网络，表面做废料回收和医疗支援，实际承担情报交换与安全转移。',
    motto: '活下来，比体面更重要。',
    color: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)',
    sortOrder: 0,
    createdAt: '2026-04-28T08:12:00.000Z',
    updatedAt: '2026-04-28T08:12:00.000Z'
  },
  {
    id: 'org-2',
    name: '荒坂特研部',
    type: '企业势力',
    description: '负责意识上传和军用接口实验的封闭部门，对艾达掌握的机密拥有最高级别追捕权限。',
    motto: '技术即秩序。',
    color: 'linear-gradient(135deg, #e5e7eb 0%, #cbd5e1 100%)',
    sortOrder: 1,
    createdAt: '2026-04-28T08:14:00.000Z',
    updatedAt: '2026-04-28T08:14:00.000Z'
  }
]

// 演示角色关系：李雷与艾达的被迫结盟、李雷与老鬼的老熟人关系
const demoRelationships: CharacterRelationship[] = [
  {
    id: 'rel-1',
    fromCharacterId: 'char-1',
    toCharacterId: 'char-2',
    type: '被迫结盟',
    description: '李雷起初只想自保，但艾达掌握的秘密让两人不得不暂时绑定在一起。',
    intensity: 72,
    createdAt: '2026-04-28T08:22:00.000Z',
    updatedAt: '2026-04-28T08:22:00.000Z'
  },
  {
    id: 'rel-2',
    fromCharacterId: 'char-1',
    toCharacterId: 'char-3',
    type: '老熟人',
    description: '老鬼是李雷少数愿意主动求助的人，两人之间带着互相试探但真实存在的信任。',
    intensity: 81,
    createdAt: '2026-04-28T08:24:00.000Z',
    updatedAt: '2026-04-28T08:24:00.000Z'
  }
]

// 演示组织成员关系：老鬼属于互助会、艾达曾隶属荒坂特研部
const demoMemberships: OrganizationMembership[] = [
  {
    id: 'membership-1',
    characterId: 'char-3',
    organizationId: 'org-1',
    role: '联络医生',
    notes: '负责为互助会处理受伤成员和黑市药剂调配。',
    createdAt: '2026-04-28T08:26:00.000Z',
    updatedAt: '2026-04-28T08:26:00.000Z'
  },
  {
    id: 'membership-2',
    characterId: 'char-2',
    organizationId: 'org-2',
    role: '前研究员',
    notes: '叛逃前参与意识上传项目，是企业内部追捕的核心目标。',
    createdAt: '2026-04-28T08:28:00.000Z',
    updatedAt: '2026-04-28T08:28:00.000Z'
  }
]

// 演示灵感条目：包含 AI 生成和手动添加的创作灵感
const demoInspiration: InspirationEntry[] = [
  {
    id: 'inspiration-1',
    type: '开篇钩子',
    title: '让艾达带着"会说话"的损坏芯片醒来',
    content:
      '在李雷把艾达拖进回收站后，让她短暂苏醒，并从损坏芯片中听到一句带坐标的陌生语音。这会立刻把"救人"升级成"必须追查"的主线钩子。',
    tags: ['悬念', '开篇', '主线引爆'],
    source: 'ai',
    sortOrder: 0,
    createdAt: '2026-04-28T08:15:00.000Z',
    updatedAt: '2026-04-28T08:15:00.000Z'
  },
  {
    id: 'inspiration-2',
    type: '转折点',
    title: '老鬼其实提前认出了艾达的接口型号',
    content:
      '在第二章中埋下一个反常细节：老鬼看见接口后沉默太久，说明他知道这不是普通公司货。这能为后续老鬼与企业旧案的关系做铺垫。',
    tags: ['伏笔', '人物关系', '转折'],
    source: 'manual',
    sortOrder: 1,
    createdAt: '2026-04-28T08:20:00.000Z',
    updatedAt: '2026-04-28T08:20:00.000Z'
  }
]

// 演示章节草稿：前3章的初始内容（第1章有正文，其余为空）
const demoChapters: ChapterDraft[] = [
  {
    id: 'chapter-1',
    volumeId: 'volume-1',
    title: '第1章：义体回收站的雨夜',
    summary: '李雷在雨夜的义体回收站救下被追杀的艾达，平静生活由此被撕开缺口。',
    status: 'draft',
    wordTarget: '预估 3000字',
    content:
      '酸雨敲打在波纹铁皮屋顶上，发出令人烦躁的白噪音。\n\n李雷靠在生锈的工作台旁，机械右臂发出轻微的伺服电机嗡嗡声。今天晚上的收获糟透了，只有几个劣质的神经插槽，还有一条已经被格式化得干干净净的二手脊柱。\n\n就在他准备拉下卷帘门的时候，巷子尽头传来了一阵急促的脚步声。\n\n"救命……" 一个穿着高档公司制服的女人倒在了水洼里，她的后脑勺上，一个军用级的数据接口正在往外冒着蓝色的电火花。'
  },
  {
    id: 'chapter-2',
    volumeId: 'volume-1',
    title: '第2章：走私芯片',
    summary: '李雷藏起艾达并请老鬼救治，同时躲避公司杀手对贫民窟的搜查。',
    status: 'review',
    wordTarget: '预估 3000字',
    content: ''
  },
  {
    id: 'chapter-3',
    volumeId: 'volume-1',
    title: '第3章：公司狗的觉醒',
    summary: '李雷逐步意识到艾达带来的秘密不只是麻烦，也可能改变整座夜城。',
    status: 'draft',
    wordTarget: '预估 3200字',
    content: ''
  }
]

// ==================== 工厂函数与工具函数 ====================

// 创建聊天窗口的初始欢迎消息，AI 助理自我介绍并提示可用功能
export function createInitialMessages(): ChatMessage[] {
  return [
    {
      id: `msg-${Date.now()}-welcome`,
      role: 'assistant',
      content: '我是你的创作助理。已读取世界观和当前章节内容。需要我帮你润色段落，或者提供剧情建议吗？'
    }
  ]
}

// 浅拷贝消息列表，空列表时回退到初始欢迎消息
function cloneMessages(messages?: ChatMessage[]): ChatMessage[] {
  return messages?.length ? messages.map((message) => ({ ...message })) : createInitialMessages()
}

// 浅拷贝章节版本列表
function cloneChapterVersions(chapterVersions?: ChapterVersion[]): ChapterVersion[] {
  return chapterVersions?.length ? chapterVersions.map((version) => ({ ...version })) : []
}

// 浅拷贝章节草稿列表
function cloneChapters(chapters?: ChapterDraft[]): ChapterDraft[] {
  return chapters?.length ? chapters.map((chapter) => ({ ...chapter })) : []
}

// 拷贝大纲条目并校正排序索引
function cloneOutlineItems(outlineItems?: OutlineItem[]): OutlineItem[] {
  return normalizeOutlineItems(outlineItems)
}

// 浅拷贝角色卡列表（含内部标签数组的深拷贝）
function cloneCharacters(characters?: CharacterCard[]): CharacterCard[] {
  return characters?.length
    ? characters.map((character) => ({
        ...character,
        tags: character.tags.map((tag) => ({ ...tag }))
      }))
    : []
}

// 拷贝组织列表并校正排序与时间戳
function cloneOrganizations(organizations?: OrganizationEntry[]): OrganizationEntry[] {
  return normalizeOrganizations(organizations)
}

// 拷贝角色关系并校正强度值与时间戳
function cloneCharacterRelationships(relationships?: CharacterRelationship[]): CharacterRelationship[] {
  return normalizeCharacterRelationships(relationships)
}

// 拷贝组织成员关系并校正时间戳
function cloneOrganizationMemberships(memberships?: OrganizationMembership[]): OrganizationMembership[] {
  return normalizeOrganizationMemberships(memberships)
}

// 拷贝灵感条目并校正标签、来源与时间戳
function cloneInspirationEntries(inspirationEntries?: InspirationEntry[]): InspirationEntry[] {
  return normalizeInspirationEntries(inspirationEntries)
}

// 拷贝世界观条目并校正排序与时间戳
function cloneWorldviewEntries(worldviewEntries?: WorldviewEntry[]): WorldviewEntry[] {
  return normalizeWorldviewEntries(worldviewEntries)
}

// 创建空工作区：对所有集合做标准化处理，保证数据结构完整
// 可通过 overrides 传入部分数据覆盖默认值
export function createEmptyWorkspace(overrides?: Partial<ProjectWorkspaceData>): ProjectWorkspaceData {
  const volumeState = ensureVolumeCollections({
    outlineVolumes: overrides?.outlineVolumes,
    outlineItems: overrides?.outlineItems,
    chapters: overrides?.chapters
  })

  return {
    worldviewEntries: cloneWorldviewEntries(overrides?.worldviewEntries),
    characters: cloneCharacters(overrides?.characters),
    organizations: cloneOrganizations(overrides?.organizations),
    characterRelationships: cloneCharacterRelationships(overrides?.characterRelationships),
    organizationMemberships: cloneOrganizationMemberships(overrides?.organizationMemberships),
    inspirationEntries: cloneInspirationEntries(overrides?.inspirationEntries),
    outlineVolumes: cloneOutlineVolumes(volumeState.outlineVolumes),
    outlineItems: cloneOutlineItems(volumeState.outlineItems),
    chapters: cloneChapters(volumeState.chapters),
    chapterVersions: cloneChapterVersions(overrides?.chapterVersions),
    messages: cloneMessages(overrides?.messages)
  }
}

// 创建演示工作区：填充完整的赛博朋克主题示例数据，用于新用户首次体验
export function createDemoWorkspace(): ProjectWorkspaceData {
  return createEmptyWorkspace({
    worldviewEntries: demoWorldview,
    characters: demoCharacters,
    organizations: demoOrganizations,
    characterRelationships: demoRelationships,
    organizationMemberships: demoMemberships,
    inspirationEntries: demoInspiration,
    outlineVolumes: demoVolumes,
    outlineItems: demoOutline,
    chapters: demoChapters
  })
}

// 标准化工作区数据：校正所有集合的结构和字段值
// fallbackToDemo 为 true 且无数据时，回退到演示工作区
export function normalizeWorkspace(
  workspace?: Partial<ProjectWorkspaceData> | null,
  options?: { fallbackToDemo?: boolean }
): ProjectWorkspaceData {
  if (!workspace) {
    return options?.fallbackToDemo ? createDemoWorkspace() : createEmptyWorkspace()
  }

  const volumeState = ensureVolumeCollections({
    outlineVolumes: workspace.outlineVolumes,
    outlineItems: workspace.outlineItems,
    chapters: workspace.chapters
  })

  return {
    worldviewEntries: cloneWorldviewEntries(workspace.worldviewEntries),
    characters: cloneCharacters(workspace.characters),
    organizations: cloneOrganizations(workspace.organizations),
    characterRelationships: cloneCharacterRelationships(workspace.characterRelationships),
    organizationMemberships: cloneOrganizationMemberships(workspace.organizationMemberships),
    inspirationEntries: cloneInspirationEntries(workspace.inspirationEntries),
    outlineVolumes: cloneOutlineVolumes(volumeState.outlineVolumes),
    outlineItems: cloneOutlineItems(volumeState.outlineItems),
    chapters: cloneChapters(volumeState.chapters),
    chapterVersions: cloneChapterVersions(workspace.chapterVersions),
    messages: cloneMessages(workspace.messages)
  }
}
