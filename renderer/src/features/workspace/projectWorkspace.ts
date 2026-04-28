import type {
  ChapterDraft,
  ChapterVersion,
  ChatMessage,
  CharacterCard,
  OutlineItem,
  OutlineVolume,
  ProjectWorkspaceData,
  WorldviewEntry
} from '@/types/app'
import { cloneOutlineVolumes, createOutlineVolume, ensureVolumeCollections } from '@/features/workspace/outlineVolumes'

const demoWorldview: WorldviewEntry[] = [
  {
    id: 'world-1',
    type: '地理',
    title: '时代背景',
    content:
      '2077年，第四次企业战争结束后，全球能源被三大寡头公司垄断。下层阶级只能生存在终日下着酸雨的贫民窟，依靠走私二手义体和黑市芯片维持生活。意识上传技术初现端倪，被称为“赛博飞升”。'
  },
  {
    id: 'world-2',
    type: '法则',
    title: '核心规则：义体排异',
    content:
      '过度植入机械义体会导致神经系统崩溃，引发赛博精神病。唯一能延缓排异反应的药物“神经阻断剂”被公司严格控制，成为比货币更硬通的资源。'
  },
  {
    id: 'world-3',
    type: '物种',
    title: '地理环境：夜城（Night City）',
    content:
      '建在填海造陆上的超级都市，分为上层的云端区和底层的霓虹区。云端区拥有人造阳光，霓虹区则充满全息广告、酸雨和九龙城寨式建筑群。'
  }
]

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
    name: '“老鬼”',
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

const demoVolumes: OutlineVolume[] = [
  createOutlineVolume({
    id: 'volume-1',
    title: '霓虹下的老鼠',
    wordTarget: '目标 5万字',
    summary: '李雷被迫卷入企业阴谋，从底层回收者走向无法回头的逃亡与觉醒。'
  })
]

const demoOutline: OutlineItem[] = [
  {
    id: 'outline-1',
    volumeId: 'volume-1',
    title: '第1章：义体回收站的雨夜',
    wordTarget: '3000字',
    conflict: '平凡生活被打破。',
    summary:
      '李雷在回收站关门时，救下了头部受重伤且被追杀的公司女高管艾达。发现她脑内的军用级接口，李雷面临交出她还是藏匿她的抉择。'
  },
  {
    id: 'outline-2',
    volumeId: 'volume-1',
    title: '第2章：走私芯片',
    wordTarget: '预估 3000字',
    conflict: '公司杀手搜查贫民窟。',
    summary:
      '李雷利用回收站的铅板密室躲避了第一波搜查，并请老鬼来为艾达稳定伤情。老鬼警告李雷惹上了大麻烦。'
  }
]

const demoChapters: ChapterDraft[] = [
  {
    id: 'chapter-1',
    volumeId: 'volume-1',
    title: '第1章：义体回收站的雨夜',
    summary: '李雷在雨夜的义体回收站救下被追杀的艾达，平静生活由此被撕开缺口。',
    status: 'draft',
    wordTarget: '预估 3000字',
    content:
      '酸雨敲打在波纹铁皮屋顶上，发出令人烦躁的白噪音。\n\n李雷靠在生锈的工作台旁，机械右臂发出轻微的伺服电机嗡嗡声。今天晚上的收获糟透了，只有几个劣质的神经插槽，还有一条已经被格式化得干干净净的二手脊柱。\n\n就在他准备拉下卷帘门的时候，巷子尽头传来了一阵急促的脚步声。\n\n“救命……” 一个穿着高档公司制服的女人倒在了水洼里，她的后脑勺上，一个军用级的数据接口正在往外冒着蓝色的电火花。'
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

export function createInitialMessages(): ChatMessage[] {
  return [
    {
      id: `msg-${Date.now()}-welcome`,
      role: 'assistant',
      content: '我是你的创作助理。已读取世界观和当前章节内容。需要我帮你润色段落，或者提供剧情建议吗？'
    }
  ]
}

function cloneMessages(messages?: ChatMessage[]): ChatMessage[] {
  return messages?.length ? messages.map((message) => ({ ...message })) : createInitialMessages()
}

function cloneChapterVersions(chapterVersions?: ChapterVersion[]): ChapterVersion[] {
  return chapterVersions?.length ? chapterVersions.map((version) => ({ ...version })) : []
}

function cloneChapters(chapters?: ChapterDraft[]): ChapterDraft[] {
  return chapters?.length ? chapters.map((chapter) => ({ ...chapter })) : []
}

function cloneOutlineItems(outlineItems?: OutlineItem[]): OutlineItem[] {
  return outlineItems?.length ? outlineItems.map((item) => ({ ...item })) : []
}

function cloneCharacters(characters?: CharacterCard[]): CharacterCard[] {
  return characters?.length
    ? characters.map((character) => ({
        ...character,
        tags: character.tags.map((tag) => ({ ...tag }))
      }))
    : []
}

function cloneWorldviewEntries(worldviewEntries?: WorldviewEntry[]): WorldviewEntry[] {
  return worldviewEntries?.length ? worldviewEntries.map((entry) => ({ ...entry })) : []
}

export function createEmptyWorkspace(overrides?: Partial<ProjectWorkspaceData>): ProjectWorkspaceData {
  const volumeState = ensureVolumeCollections({
    outlineVolumes: overrides?.outlineVolumes,
    outlineItems: overrides?.outlineItems,
    chapters: overrides?.chapters
  })

  return {
    worldviewEntries: cloneWorldviewEntries(overrides?.worldviewEntries),
    characters: cloneCharacters(overrides?.characters),
    outlineVolumes: cloneOutlineVolumes(volumeState.outlineVolumes),
    outlineItems: cloneOutlineItems(volumeState.outlineItems),
    chapters: cloneChapters(volumeState.chapters),
    chapterVersions: cloneChapterVersions(overrides?.chapterVersions),
    messages: cloneMessages(overrides?.messages)
  }
}

export function createDemoWorkspace(): ProjectWorkspaceData {
  return createEmptyWorkspace({
    worldviewEntries: demoWorldview,
    characters: demoCharacters,
    outlineVolumes: demoVolumes,
    outlineItems: demoOutline,
    chapters: demoChapters
  })
}

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
    outlineVolumes: cloneOutlineVolumes(volumeState.outlineVolumes),
    outlineItems: cloneOutlineItems(volumeState.outlineItems),
    chapters: cloneChapters(volumeState.chapters),
    chapterVersions: cloneChapterVersions(workspace.chapterVersions),
    messages: cloneMessages(workspace.messages)
  }
}
