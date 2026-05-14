import { BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import type { AiTaskPayload, ReferenceStyleAnalysisResult, ReferenceStyleChunkResult } from './ai/shared-types'
import { runAiTask } from './ai/runtime'
import { indexReferenceNovel } from './ai/knowledge-retrieval'
import { refreshRegistry as refreshSkillRegistry, toScanEntries as skillScanEntries, toContextEntries as skillContextEntries } from './ai/skills'
import { getProjectSkillsDirPath as getSkillsDirPath } from './ai/skills/discovery'
import { extractReferenceNovelContext, type ReferenceNovelLocalContext } from './referenceAnalysis'
import { getWorkspaceDirPath } from './workspace-store'
import type { AssistantPromptPayload, WindowManager } from './window-manager'

type ReferenceNovelImportRequest = {
  settings: AiTaskPayload['settings']
  projectId?: string
  projectTitle?: string
  projectGenre?: string
  projectPlatform?: string
  preferredTitle?: string
  preferredSource?: string
  projectSkills?: Array<{
    id: string
    name: string
    description: string
    content: string
  }>
}

type ReferenceImportProgressPayload = {
  phase: 'extracting' | 'chunking' | 'chunk-analysis' | 'aggregating' | 'saving' | 'done'
  message: string
  current: number
  total: number
  percent: number
  sourceTitle?: string
}

type RegisterMainIpcHandlersDeps = {
  windowManager: WindowManager
  setLatestWorkspaceSnapshot: (payload: unknown) => void
  getLatestAssistantContext: () => unknown
  setLatestAssistantContext: (payload: unknown) => void
  getLatestAssistantPrompt: () => AssistantPromptPayload | null
  setLatestAssistantPrompt: (payload: AssistantPromptPayload | null) => void
  normalizeWorkspacePayload: (payload: unknown) => unknown
  ensureWorkspaceDb: () => Promise<DatabaseSync>
  readWorkspaceSnapshot: (db: DatabaseSync) => unknown
  writeWorkspaceSnapshot: (db: DatabaseSync, payload: unknown) => void
  writeAppSettingsRow: (
    db: DatabaseSync,
    settings: unknown,
    metadata: { theme: string; selectedProjectId: string }
  ) => void
  validateImportedPayload: (payload: unknown) => { valid: true; payload: unknown; meta: unknown } | { valid: false; message: string }
  resolveImageMime: (filePath: string) => string
  emitReferenceImportProgress: (window: BrowserWindow, payload: ReferenceImportProgressPayload) => void
  buildImportedReferenceKnowledgeDocuments: (
    title: string,
    localContext: ReferenceNovelLocalContext,
    analysis: ReferenceStyleAnalysisResult,
    chunkResults: Array<{ label: string; characterCount: number; result: ReferenceStyleChunkResult }>,
    importedAt: string
  ) => unknown[]
  buildImportedReferenceStylePrompt: (title: string, analysis: ReferenceStyleAnalysisResult) => string
  formatReferenceChunkSummaries: (
    chunkResults: Array<{ label: string; characterCount: number; result: ReferenceStyleChunkResult }>
  ) => string
}

type ExportRequest = {
  data: unknown
  title?: string
  defaultPath?: string
}

async function cleanupOrphanReferenceNovelFiles(payload: unknown): Promise<void> {
  const activeIds = new Set<string>()
  const works = (payload as { referenceWorks?: Array<{ id?: unknown }> })?.referenceWorks ?? []
  for (const work of works) {
    const id = String(work?.id ?? '').trim()
    if (id) activeIds.add(id)
  }

  const novelStorageDir = join(getWorkspaceDirPath(), 'reference-novels')
  if (!existsSync(novelStorageDir)) return

  const files = await readdir(novelStorageDir)
  for (const file of files) {
    if (!file.endsWith('.txt')) continue
    const id = file.slice(0, -4)
    if (!activeIds.has(id)) {
      await unlink(join(novelStorageDir, file)).catch(() => {})
    }
  }
}

export function registerMainIpcHandlers(deps: RegisterMainIpcHandlersDeps): void {
  ipcMain.handle('characterarc:export-json', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)
      ? payload
      : {
          data: payload
        }) as ExportRequest

    const result = await dialog.showSaveDialog(window, {
      title: request.title ?? '导出项目数据',
      defaultPath: request.defaultPath ?? 'characterarc-export.json',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    await writeFile(result.filePath, JSON.stringify(request.data, null, 2), 'utf-8')
    return {
      success: true,
      canceled: false,
      filePath: result.filePath
    }
  })

  ipcMain.handle('characterarc:export-text', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)
      ? payload
      : {
          data: payload
        }) as ExportRequest

    const result = await dialog.showSaveDialog(window, {
      title: request.title ?? '导出章节文本',
      defaultPath: request.defaultPath ?? 'characterarc-export.txt',
      filters: [{ name: '文本文档', extensions: ['txt'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    const data = request.data as {
      project?: { title?: string } | null
      outlineVolumes?: Array<{ id?: string; title?: string }>
      chapters?: Array<{ volumeId?: string; title?: string; content?: string }>
    }
    const volumeTitleMap = new Map((data.outlineVolumes ?? []).map((volume) => [volume.id ?? '', volume.title?.trim() || '未命名分卷']))
    let activeVolumeId = ''

    const text = [
      data.project?.title ? `# ${data.project.title}` : '# CharacterArc 导出',
      '',
      ...(data.chapters ?? []).flatMap((chapter, index) => {
        const shouldPrintVolume = chapter.volumeId && chapter.volumeId !== activeVolumeId
        if (chapter.volumeId) {
          activeVolumeId = chapter.volumeId
        }

        return [
          ...(shouldPrintVolume ? [`## ${volumeTitleMap.get(chapter.volumeId ?? '') || '未命名分卷'}`, ''] : []),
          `第${index + 1}章 ${chapter.title ?? '未命名章节'}`,
          '',
          chapter.content?.trim() || '（暂无正文内容）',
          '',
          ''.padEnd(48, '-'),
          ''
        ]
      })
    ].join('\n')

    await writeFile(result.filePath, text, 'utf-8')
    return {
      success: true,
      canceled: false,
      filePath: result.filePath
    }
  })

  ipcMain.handle('characterarc:export-chapter-txt', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload ?? {}) as {
      title?: string
      content?: string
      defaultFileName?: string
    }

    const result = await dialog.showSaveDialog(window, {
      title: '导出章节为 TXT',
      defaultPath: request.defaultFileName?.trim() || 'chapter.txt',
      filters: [{ name: '文本文档', extensions: ['txt'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    const text = [request.title?.trim() || '未命名章节', '', request.content ?? ''].join('\n')
    await writeFile(result.filePath, text, 'utf-8')
    return { success: true, canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('characterarc:export-chapter-docx', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload ?? {}) as {
      title?: string
      content?: string
      defaultFileName?: string
    }

    const result = await dialog.showSaveDialog(window, {
      title: '导出章节为 DOCX',
      defaultPath: request.defaultFileName?.trim() || 'chapter.docx',
      filters: [{ name: 'Word 文档', extensions: ['docx'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import('docx')
    const titleText = request.title?.trim() || '未命名章节'
    const paragraphs = (request.content ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())

    const docParagraphs = [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: titleText, bold: true, size: 36 })]
      }),
      ...paragraphs.map((line) =>
        new Paragraph({
          spacing: { line: 360 },
          children: [new TextRun({ text: line, size: 24 })]
        })
      )
    ]

    const doc = new Document({
      creator: 'CharacterArc',
      title: titleText,
      sections: [{ children: docParagraphs }]
    })

    const buffer = await Packer.toBuffer(doc)
    await writeFile(result.filePath, buffer)
    return { success: true, canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('characterarc:import-json', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const result = await dialog.showOpenDialog(window, {
      title: '导入项目 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const raw = await readFile(result.filePaths[0], 'utf-8')
    let parsed: unknown

    try {
      parsed = JSON.parse(raw)
    } catch {
      return {
        success: false,
        canceled: false,
        error: '文件不是有效的 JSON 格式。'
      }
    }

    const validation = deps.validateImportedPayload(parsed)
    if (!validation.valid) {
      return {
        success: false,
        canceled: false,
        error: validation.message
      }
    }

    return {
      success: true,
      canceled: false,
      payload: validation.payload,
      meta: validation.meta
    }
  })

  ipcMain.handle('characterarc:pick-cover-image', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const result = await dialog.showOpenDialog(window, {
      title: '选择项目封面',
      properties: ['openFile'],
      filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const filePath = result.filePaths[0]
    const bytes = await readFile(filePath)
    const mime = deps.resolveImageMime(filePath)
    return {
      success: true,
      canceled: false,
      filePath,
      dataUrl: `data:${mime};base64,${bytes.toString('base64')}`
    }
  })

  ipcMain.handle('characterarc:save-cover-image', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = payload as { dataUrl?: string; defaultFileName?: string }
    const dataUrl = String(request?.dataUrl ?? '').trim()
    if (!dataUrl) {
      return { success: false, error: '没有可保存的封面图片。' }
    }

    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
    if (!match) {
      return { success: false, error: '封面数据格式无效，无法保存。' }
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
    const base64Data = match[2]
    const defaultName = request?.defaultFileName?.trim() || `cover-${Date.now()}.${ext}`

    const result = await dialog.showSaveDialog(window, {
      title: '保存封面图片',
      defaultPath: defaultName,
      filters: [{ name: '图片文件', extensions: [ext, 'png', 'jpg', 'webp'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    await writeFile(result.filePath, Buffer.from(base64Data, 'base64'))
    return {
      success: true,
      canceled: false,
      filePath: result.filePath
    }
  })

  ipcMain.handle('characterarc:read-reference-novel-text', async (_event, refId: string) => {
    if (!refId) return { success: false, error: '缺少参考作品 ID' }
    const novelPath = join(getWorkspaceDirPath(), 'reference-novels', `${refId}.txt`)
    try {
      const content = await readFile(novelPath, 'utf-8')
      return { success: true, content }
    } catch {
      return { success: false, error: '未找到该参考作品的原文存档，可能是旧版本导入的作品' }
    }
  })

  ipcMain.handle('characterarc:import-reference-novel-analysis', async (_event, payload: ReferenceNovelImportRequest) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const result = await dialog.showOpenDialog(window, {
      title: '导入参考小说',
      properties: ['openFile'],
      filters: [{ name: '小说文本', extensions: ['txt', 'md', 'docx'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    try {
      const request = (payload ?? {}) as ReferenceNovelImportRequest
      deps.emitReferenceImportProgress(window, {
        phase: 'extracting',
        message: '正在读取小说正文并提取基础统计...',
        current: 0,
        total: 1,
        percent: 8
      })
      const importedFilePath = result.filePaths[0]
      const localContext = await extractReferenceNovelContext(importedFilePath)
      const resolvedTitle = request.preferredTitle?.trim() || localContext.title
      const resolvedSource = request.preferredSource?.trim() || localContext.fileType.toUpperCase()
      deps.emitReferenceImportProgress(window, {
        phase: 'chunking',
        message: `已拆出 ${localContext.analysisChunks.length} 个分析分块，准备逐块提炼风格...`,
        current: 0,
        total: Math.max(localContext.analysisChunks.length, 1),
        percent: 16,
        sourceTitle: resolvedTitle
      })
      const chunkResults: Array<{ label: string; characterCount: number; result: ReferenceStyleChunkResult }> = []
      for (const [index, chunk] of localContext.analysisChunks.entries()) {
        deps.emitReferenceImportProgress(window, {
          phase: 'chunk-analysis',
          message: `正在分析第 ${index + 1} / ${localContext.analysisChunks.length} 个分块：${chunk.label}`,
          current: index + 1,
          total: localContext.analysisChunks.length,
          percent: Math.min(82, 16 + Math.round(((index + 1) / Math.max(localContext.analysisChunks.length, 1)) * 58)),
          sourceTitle: resolvedTitle
        })
        chunkResults.push({
          label: chunk.label,
          characterCount: chunk.characterCount,
          result: (await runAiTask({
            task: 'reference-style-chunk',
            settings: request.settings,
            context: {
              projectId: request.projectId ?? '',
              projectTitle: request.projectTitle ?? '',
              projectGenre: request.projectGenre ?? '',
              projectPlatform: request.projectPlatform ?? '',
              projectSkills: request.projectSkills ?? [],
              sourceTitle: resolvedTitle,
              chunkLabel: chunk.label,
              chunkIndex: index + 1,
              chunkTotal: localContext.analysisChunks.length,
              chunkCharacterCount: chunk.characterCount,
              chunkMetrics: chunk.metrics,
              chunkKeywords: chunk.topKeywords,
              chunkText: chunk.text
            }
          })).result as ReferenceStyleChunkResult
        })
      }
      deps.emitReferenceImportProgress(window, {
        phase: 'aggregating',
        message: '正在汇总所有分块结论，生成可复用仿写模板...',
        current: chunkResults.length,
        total: chunkResults.length,
        percent: 90,
        sourceTitle: resolvedTitle
      })
      const analysis = (await runAiTask({
        task: 'reference-style-analysis',
        settings: request.settings,
        context: {
          projectId: request.projectId ?? '',
          projectTitle: request.projectTitle ?? '',
          projectGenre: request.projectGenre ?? '',
          projectPlatform: request.projectPlatform ?? '',
          projectSkills: request.projectSkills ?? [],
          sourceTitle: resolvedTitle,
          sourceFileType: localContext.fileType,
          sourceCharacterCount: localContext.characterCount,
          sourceChapterCount: localContext.chapterCount,
          styleMetrics: localContext.metrics,
          topKeywords: localContext.topKeywords,
          sourceExcerpt: localContext.excerpt,
          analysisSample: localContext.analysisSample,
          chunkSummaries: deps.formatReferenceChunkSummaries(chunkResults)
        }
      })).result as ReferenceStyleAnalysisResult

      const importedAt = new Date().toISOString()
      const knowledgeDocuments = deps.buildImportedReferenceKnowledgeDocuments(resolvedTitle, localContext, analysis, chunkResults, importedAt)
      deps.emitReferenceImportProgress(window, {
        phase: 'saving',
        message: '正在整理结果并归档到拆书知识库...',
        current: 1,
        total: 1,
        percent: 96,
        sourceTitle: resolvedTitle
      })
      const refId = `ref-${Date.now()}`

      // 保存原文到本地，供后续风格指纹提取等功能直接读取
      const novelStorageDir = join(getWorkspaceDirPath(), 'reference-novels')
      await mkdir(novelStorageDir, { recursive: true })
      const rawNovelText = await readFile(importedFilePath, 'utf-8')
      await writeFile(join(novelStorageDir, `${refId}.txt`), rawNovelText, 'utf-8')

      // 异步为原文建立向量索引（不阻塞导入流程）
      if (request.projectId) {
        indexReferenceNovel(request.settings, request.projectId, refId, rawNovelText).catch(() => {})
      }

      const referenceWork = {
        id: refId,
        title: resolvedTitle,
        source: resolvedSource,
        notes: analysis.overview,
        fileName: localContext.fileName,
        analysis: {
          createdAt: importedAt,
          fileName: localContext.fileName,
          fileType: localContext.fileType,
          characterCount: localContext.characterCount,
          chapterCount: localContext.chapterCount,
          excerpt: localContext.excerpt,
          topKeywords: localContext.topKeywords,
          metrics: [
            ...localContext.metrics,
            { label: '分析分块数', value: `${localContext.analysisChunks.length} 块` }
          ],
          overview: analysis.overview,
          sentenceStyle: analysis.sentenceStyle,
          dialogueRatio: analysis.dialogueRatio,
          pacingControl: analysis.pacingControl,
          emotionExpression: analysis.emotionExpression,
          narrativePerspective: analysis.narrativePerspective,
          styleRules: analysis.styleRules,
          plotOutline: analysis.plotOutline,
          reusableStylePrompt: analysis.reusableStylePrompt,
          avoidRules: analysis.avoidRules
        }
      }
      deps.emitReferenceImportProgress(window, {
        phase: 'done',
        message: `《${resolvedTitle}》拆书完成，结果已归档到拆书知识库。`,
        current: 1,
        total: 1,
        percent: 100,
        sourceTitle: resolvedTitle
      })

      return {
        success: true,
        canceled: false,
        result: {
          referenceWork,
          suggestedWritingStylePrompt: deps.buildImportedReferenceStylePrompt(resolvedTitle, analysis),
          knowledgeDocuments
        }
      }
    } catch (error) {
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '参考作品拆书失败'
      }
    }
  })

  ipcMain.handle('characterarc:assistant-window-open', async () => {
    try {
      deps.windowManager.createAssistantWindow()
      return { success: true, visible: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'AI 助手窗口打开失败'
      }
    }
  })

  ipcMain.handle('characterarc:assistant-window-close', async () => {
    try {
      deps.windowManager.closeAssistantWindow()
      return { success: true, visible: false }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'AI 助手窗口关闭失败'
      }
    }
  })

  ipcMain.handle('characterarc:assistant-window-state', () => ({
    success: true,
    visible: deps.windowManager.isAssistantWindowVisible()
  }))

  ipcMain.handle('characterarc:assistant-context-publish', (_event, payload: unknown) => {
    const nextPayload = payload && typeof payload === 'object' ? payload : {}
    deps.setLatestAssistantContext(nextPayload)
    deps.windowManager.sendWindowEvent(deps.windowManager.getAssistantWindow(), 'characterarc:assistant-context', nextPayload)
    return { success: true }
  })

  ipcMain.handle('characterarc:assistant-context-get', () => ({
    success: true,
    payload: deps.getLatestAssistantContext()
  }))

  ipcMain.handle('characterarc:assistant-prompt-publish', (_event, payload: unknown) => {
    const nextPayload = payload && typeof payload === 'object' ? (payload as AssistantPromptPayload) : null
    deps.setLatestAssistantPrompt(nextPayload)
    deps.windowManager.sendWindowEvent(deps.windowManager.getAssistantWindow(), 'characterarc:assistant-prompt', nextPayload)
    return { success: true }
  })

  ipcMain.handle('characterarc:assistant-prompt-get', () => ({
    success: true,
    payload: deps.getLatestAssistantPrompt()
  }))

  ipcMain.handle('characterarc:assistant-prompt-clear', (_event, promptId: unknown) => {
    if (typeof promptId === 'string' && deps.getLatestAssistantPrompt()?.id === promptId) {
      deps.setLatestAssistantPrompt(null)
    }

    return { success: true }
  })

  ipcMain.handle('characterarc:workspace-sync-publish', (event, payload: unknown) => {
    if (payload && typeof payload === 'object') {
      deps.setLatestWorkspaceSnapshot(deps.normalizeWorkspacePayload(payload))
    }
    deps.windowManager.broadcastWindowEvent('characterarc:workspace-sync-event', payload, event.sender.id)
    return { success: true }
  })

  ipcMain.handle('characterarc:assistant-message-publish', (_event, payload: unknown) => {
    deps.windowManager.sendWindowEvent(deps.windowManager.getMainWindow(), 'characterarc:assistant-message', payload)
    return { success: true }
  })

  ipcMain.handle('characterarc:assistant-command-publish', (_event, payload: unknown) => {
    deps.windowManager.sendWindowEvent(deps.windowManager.getMainWindow(), 'characterarc:assistant-command', payload)
    return { success: true }
  })

  ipcMain.handle('characterarc:assistant-proposal-approve', () => {
    deps.windowManager.sendWindowEvent(deps.windowManager.getMainWindow(), 'characterarc:assistant-proposal-approve', null)
    return { success: true }
  })

  ipcMain.handle('characterarc:assistant-proposal-reject', () => {
    deps.windowManager.sendWindowEvent(deps.windowManager.getMainWindow(), 'characterarc:assistant-proposal-reject', null)
    return { success: true }
  })

  ipcMain.handle('characterarc:assistant-proposal-clear', () => {
    deps.windowManager.sendWindowEvent(deps.windowManager.getMainWindow(), 'characterarc:assistant-proposal-clear', null)
    return { success: true }
  })

  ipcMain.handle('characterarc:load-workspace', async () => {
    try {
      const db = await deps.ensureWorkspaceDb()
      const workspace = deps.readWorkspaceSnapshot(db)

      if (!workspace) {
        return { success: false, payload: null }
      }

      deps.setLatestWorkspaceSnapshot(workspace)
      nativeTheme.themeSource = (workspace as { appSettings?: { darkMode?: boolean } }).appSettings?.darkMode ? 'dark' : 'light'

      return {
        success: true,
        payload: workspace
      }
    } catch (error) {
      console.error('[workspace] loadWorkspace failed:', error)
      return {
        success: false,
        payload: null,
        error: error instanceof Error ? error.message : 'Unknown workspace load error'
      }
    }
  })

  ipcMain.handle('characterarc:get-zoom-factor', () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return {
        success: false,
        error: 'No active window'
      }
    }

    return {
      success: true,
      factor: window.webContents.getZoomFactor()
    }
  })

  ipcMain.handle('characterarc:set-zoom-factor', (_event, factor: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return {
        success: false,
        error: 'No active window'
      }
    }

    const numericFactor = typeof factor === 'number' ? factor : Number(factor)
    const nextFactor = Number.isFinite(numericFactor) ? Math.min(1.75, Math.max(0.75, numericFactor)) : 1
    window.webContents.setZoomFactor(nextFactor)

    return {
      success: true,
      factor: nextFactor
    }
  })

  ipcMain.handle('characterarc:set-titlebar-overlay', (_event, options: { color: string; symbolColor: string }) => {
    deps.windowManager.setTitleBarOverlay(options)
  })

  ipcMain.handle('characterarc:save-workspace', async (_event, payload: unknown) => {
    try {
      const db = await deps.ensureWorkspaceDb()
      const normalized = deps.normalizeWorkspacePayload(payload)
      deps.writeWorkspaceSnapshot(db, normalized)
      deps.setLatestWorkspaceSnapshot(normalized)
      nativeTheme.themeSource = (normalized as { appSettings?: { darkMode?: boolean } }).appSettings?.darkMode ? 'dark' : 'light'

      cleanupOrphanReferenceNovelFiles(normalized).catch((error) => {
        console.warn('[workspace] reference-novels cleanup failed:', error)
      })

      return { success: true }
    } catch (error) {
      console.error('[workspace] saveWorkspace failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown workspace save error'
      }
    }
  })

  ipcMain.handle('characterarc:save-app-settings', async (_event, payload: unknown) => {
    try {
      const db = await deps.ensureWorkspaceDb()
      const record = (payload ?? {}) as {
        theme?: unknown
        selectedProjectId?: unknown
        appSettings?: unknown
      }
      const theme = typeof record.theme === 'string' ? record.theme : 'ocean'
      const selectedProjectId = typeof record.selectedProjectId === 'string' ? record.selectedProjectId : ''
      deps.writeAppSettingsRow(db, record.appSettings, { theme, selectedProjectId })
      nativeTheme.themeSource = (record.appSettings as { darkMode?: boolean } | undefined)?.darkMode ? 'dark' : 'light'
      return { success: true }
    } catch (error) {
      console.error('[workspace] saveAppSettings failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown app settings save error'
      }
    }
  })

  ipcMain.handle('characterarc:project-skills-scan', async (_event, projectId: unknown) => {
    try {
      const resolvedProjectId = String(projectId ?? '').trim()
      if (!resolvedProjectId) {
        return { success: true, skills: [] }
      }

      await refreshSkillRegistry(resolvedProjectId)
      return { success: true, skills: skillScanEntries(resolvedProjectId) }
    } catch {
      return { success: true, skills: [] }
    }
  })

  ipcMain.handle('characterarc:project-skills-import', async (_event, projectId: unknown) => {
    try {
      const resolvedProjectId = String(projectId ?? '').trim()
      if (!resolvedProjectId) {
        return { success: false, canceled: false, error: '缺少项目 ID，无法导入项目技能。' }
      }

      const dialogOptions: Electron.OpenDialogOptions = {
        title: '选择要导入的 Skill 包目录',
        properties: ['openDirectory']
      }
      const ownerWindow = deps.windowManager.getMainWindow() ?? BrowserWindow.getFocusedWindow()
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      if (result.canceled || !result.filePaths[0]) {
        return { success: true, canceled: true, importedSkillIds: [] }
      }

      const selectedPath = result.filePaths[0]
      const skillsRoot = getSkillsDirPath(resolvedProjectId)
      await mkdir(skillsRoot, { recursive: true })

      const findSkillDirs = async (root: string): Promise<string[]> => {
        if (existsSync(join(root, 'SKILL.md'))) return [root]
        if (!existsSync(root)) return []
        const nestedRoot = join(root, 'skills')
        const searchRoot = existsSync(nestedRoot) ? nestedRoot : root
        const entries = await readdir(searchRoot, { withFileTypes: true })
        return entries
          .filter((entry) => entry.isDirectory() && existsSync(join(searchRoot, entry.name, 'SKILL.md')))
          .map((entry) => join(searchRoot, entry.name))
      }

      const sourceDirs = await findSkillDirs(selectedPath)
      if (!sourceDirs.length) {
        return { success: false, canceled: false, error: '所选目录中没有识别到可导入的 SKILL.md。' }
      }

      const importedSkillIds: string[] = []
      for (const sourceDir of sourceDirs) {
        const targetDir = join(skillsRoot, basename(sourceDir))
        await cp(sourceDir, targetDir, { recursive: true, force: true })
        importedSkillIds.push(basename(sourceDir))
      }

      await refreshSkillRegistry(resolvedProjectId)
      return {
        success: true,
        canceled: false,
        importedSkillIds: importedSkillIds.sort((a, b) => a.localeCompare(b, 'zh-CN'))
      }
    } catch (error) {
      return { success: false, canceled: false, error: error instanceof Error ? error.message : '项目技能导入失败' }
    }
  })

  ipcMain.handle('characterarc:project-skills-context', async (_event, projectId: unknown) => {
    try {
      const resolvedProjectId = String(projectId ?? '').trim()
      if (!resolvedProjectId) {
        return { success: true, skills: [] }
      }

      await refreshSkillRegistry(resolvedProjectId)
      return { success: true, skills: skillContextEntries(resolvedProjectId) }
    } catch {
      return { success: true, skills: [] }
    }
  })
}
