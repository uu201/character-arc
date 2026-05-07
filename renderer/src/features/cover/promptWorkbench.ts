import type { KnowledgeDocument, ProjectSummary, ReferenceWorkItem } from '@/types/app'

type CoverPlatformStyle = {
  platformLabel: string
  styleKeywords: string
}

type CoverGenreStyle = {
  visualKeywords: string
  titleStyle: string
  authorStyle: string
  palette: string
  characterDirection: string
  backgroundDirection: string
}

export type CoverPromptWorkbenchInput = {
  project: ProjectSummary
  authorName: string
  extraNotes: string
}

export type CoverPromptWorkbenchResult = {
  title: string
  summary: string
  prompt: string
  keywords: string[]
}

const PLATFORM_STYLE_MAP: Record<string, CoverPlatformStyle> = {
  '番茄': {
    platformLabel: '番茄小说',
    styleKeywords: 'vibrant saturated colors, eye-catching, bold contrast, popular mass-market style'
  },
  '起点': {
    platformLabel: '起点中文网',
    styleKeywords: 'polished refined style, detailed illustration, epic cinematic composition'
  },
  '晋江': {
    platformLabel: '晋江文学城',
    styleKeywords: 'dreamy ethereal aesthetic, soft pastel tones, elegant romantic style'
  },
  '盐言': {
    platformLabel: '知乎盐言',
    styleKeywords: 'minimalist literary style, subtle atmosphere, clean composition with negative space'
  },
  '知乎': {
    platformLabel: '知乎盐言',
    styleKeywords: 'minimalist literary style, subtle atmosphere, clean composition with negative space'
  },
  '七猫': {
    platformLabel: '七猫小说',
    styleKeywords: 'striking high-impact, vivid dramatic colors, attention-grabbing'
  },
  '刺猬猫': {
    platformLabel: '刺猬猫',
    styleKeywords: 'anime illustration style, vibrant colorful, detailed character art'
  }
}

function resolvePlatformStyle(targetPlatform: string): CoverPlatformStyle {
  const matchedEntry = Object.entries(PLATFORM_STYLE_MAP).find(([keyword]) => targetPlatform.includes(keyword))
  return matchedEntry?.[1] ?? {
    platformLabel: targetPlatform.trim() || '通用中文网文平台',
    styleKeywords: 'polished commercial web novel cover, dramatic focal point, readable typography, strong genre signal'
  }
}

function resolveGenreStyle(genre: string): CoverGenreStyle {
  if (/科幻|赛博|机甲|未来|末世/i.test(genre)) {
    return {
      visualKeywords: 'futuristic neon cityscape, cinematic sci-fi atmosphere, high-tech details',
      titleStyle: 'neon glowing futuristic font in electric blue',
      authorStyle: 'small crisp white monospace text with subtle cyan scanline overlay, flanked by small geometric brackets',
      palette: 'electric blue, cyan, black steel, cold silver',
      characterDirection: 'a determined protagonist in futuristic gear, dynamic pose, sharp silhouette',
      backgroundDirection: 'towering skyline, holographic interfaces, glowing rain, layered depth'
    }
  }

  if (/仙侠|玄幻|修仙|东方玄幻|奇幻/i.test(genre)) {
    return {
      visualKeywords: 'epic xianxia fantasy illustration, mystical energy, grand cinematic scale',
      titleStyle: 'bold golden brush calligraphy with metallic glow and sharp strokes',
      authorStyle: 'small refined white serif text with faint golden glow, flanked by delicate cloud-scroll ornaments on both sides, resting on a thin horizontal gold line',
      palette: 'gold, deep blue, crimson, jade mist',
      characterDirection: 'heroic figure in flowing robes with weapon or talisman, commanding presence',
      backgroundDirection: 'mountains, ancient palaces, divine light, cloud sea and magical aura'
    }
  }

  if (/都市|现实|职场|商战/i.test(genre)) {
    return {
      visualKeywords: 'modern urban drama poster, sleek composition, commercial high-end finish',
      titleStyle: 'modern bold sans-serif with metallic silver finish',
      authorStyle: 'small clean white modern text with subtle drop shadow, positioned above a thin silver horizontal divider line',
      palette: 'silver, charcoal, amber city lights, midnight blue',
      characterDirection: 'stylish protagonist in contemporary fashion, poised and confident',
      backgroundDirection: 'city skyline, glass reflections, traffic light trails, architectural depth'
    }
  }

  if (/言情|甜宠|婚恋|宫斗|古言|现言/i.test(genre)) {
    return {
      visualKeywords: 'romantic Chinese web novel cover, dreamy mood, emotional focal point',
      titleStyle: 'elegant golden traditional Kai script with ornate decoration',
      authorStyle: 'small elegant dark red traditional text inside a thin golden rectangular border frame with corner decorations',
      palette: 'rose gold, ivory, crimson, misty peach',
      characterDirection: 'graceful heroine with expressive emotion, elegant costume or modern romantic styling',
      backgroundDirection: 'soft bloom lighting, floral or palace motifs, layered atmosphere'
    }
  }

  if (/悬疑|推理|惊悚|恐怖|灵异/i.test(genre)) {
    return {
      visualKeywords: 'dark suspense thriller cover, oppressive atmosphere, high visual tension',
      titleStyle: 'distorted bold cracked letters in blood red',
      authorStyle: 'small pale grey text with slight blur effect, almost hidden in the shadows, a thin cracked line underneath',
      palette: 'blood red, graphite black, sickly green, dim grey',
      characterDirection: 'isolated figure, uneasy posture, strong silhouette against danger',
      backgroundDirection: 'fog, narrow corridor or city alley, dramatic shadows, ominous distance'
    }
  }

  return {
    visualKeywords: 'professional Chinese web novel cover, dramatic composition, strong story atmosphere',
    titleStyle: 'bold cinematic lettering with metallic texture and subtle glow',
    authorStyle: 'small refined white text with a neat decorative line and subtle light effect',
    palette: 'gold, teal, charcoal, warm highlight',
    characterDirection: 'compelling lead character with clear genre identity and memorable silhouette',
    backgroundDirection: 'layered scene with cinematic light, atmospheric depth and readable focal hierarchy'
  }
}

function collectReferenceSignals(referenceWorks: ReferenceWorkItem[]): string {
  const analyzedWorks = referenceWorks.filter((work) => work.analysis)
  if (!analyzedWorks.length) {
    return 'No direct benchmark references provided; build a commercially readable cover with strong genre clarity.'
  }

  const styleRules = analyzedWorks
    .flatMap((work) => work.analysis?.styleRules ?? [])
    .map((rule) => rule.trim())
    .filter(Boolean)
    .slice(0, 4)

  const titles = analyzedWorks.map((work) => work.title.trim()).filter(Boolean).slice(0, 3)
  const signals = [
    titles.length ? `Benchmark inspirations: ${titles.join(', ')}.` : '',
    styleRules.length ? `Visual translation hints from references: ${styleRules.join('; ')}.` : ''
  ].filter(Boolean)

  return signals.join(' ')
}

function normalizeAuthorName(value: string): string {
  return value.trim() || '作者名待定'
}

export function buildCoverPromptWorkbenchResult(input: CoverPromptWorkbenchInput): CoverPromptWorkbenchResult {
  const projectTitle = input.project.title.trim() || '未命名作品'
  const genre = input.project.genre.trim() || '通用网文'
  const authorName = normalizeAuthorName(input.authorName)
  const targetPlatform = input.project.targetPlatform.trim()
  const platformStyle = resolvePlatformStyle(targetPlatform)
  const genreStyle = resolveGenreStyle(genre)
  const referenceSignal = collectReferenceSignals(input.project.referenceWorks)
  const extraNotes = input.extraNotes.trim()

  const prompt = [
    `Chinese web novel cover design for "${projectTitle}".`,
    `${platformStyle.styleKeywords}.`,
    `${genreStyle.visualKeywords}.`,
    `Title text "${projectTitle}" at top center in ${genreStyle.titleStyle}.`,
    `Author name "${authorName}" at bottom center in ${genreStyle.authorStyle}.`,
    `Color palette: ${genreStyle.palette}.`,
    `Character direction: ${genreStyle.characterDirection}.`,
    `Background direction: ${genreStyle.backgroundDirection}.`,
    referenceSignal,
    extraNotes ? `Additional art direction: ${extraNotes}.` : '',
    'Professional book cover, high detail digital painting, portrait 2:3 ratio, strong readability, no watermark.'
  ].filter(Boolean).join(' ')

  const summary = [
    `平台：${platformStyle.platformLabel}`,
    `题材：${genre}`,
    `封面重心：${genreStyle.characterDirection}`,
    extraNotes ? `补充要求：${extraNotes}` : ''
  ].filter(Boolean).join('｜')

  return {
    title: `${projectTitle}｜封面提示词`,
    summary,
    prompt,
    keywords: [projectTitle, genre, platformStyle.platformLabel, '封面提示词', 'story-cover']
      .map((item) => item.trim())
      .filter(Boolean)
  }
}

export function buildCoverPromptKnowledgeDocument(
  projectId: string,
  input: CoverPromptWorkbenchInput
): KnowledgeDocument {
  const result = buildCoverPromptWorkbenchResult(input)
  const now = new Date().toISOString()

  return {
    id: `knowledge-cover-prompt-${Date.now()}`,
    projectId,
    title: result.title,
    sourceType: 'canon-fact',
    sourceLabel: 'cover-prompt-workbench',
    content: result.prompt,
    summary: result.summary,
    keywords: result.keywords,
    metadata: {
      sourceTitle: result.title,
      authorName: normalizeAuthorName(input.authorName),
      targetPlatform: input.project.targetPlatform,
      referenceTitles: input.project.referenceWorks.map((work) => work.title).slice(0, 5),
      extraNotes: input.extraNotes.trim()
    },
    createdAt: now,
    updatedAt: now
  }
}
