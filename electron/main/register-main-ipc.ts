import { BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import * as XLSX from 'xlsx'

import type { AiTaskPayload, ReferenceStyleAnalysisResult, ReferenceStyleChunkResult } from './ai/shared-types'
import { runAiTask } from './ai/runtime'
import { indexReferenceNovel } from './ai/knowledge-retrieval'
import { refreshRegistry as refreshSkillRegistry, toScanEntries as skillScanEntries, toContextEntries as skillContextEntries } from './ai/skills'
import { getProjectSkillsDirPath as getSkillsDirPath } from './ai/skills/discovery'
import { extractReferenceNovelContext, type ReferenceNovelLocalContext } from './referenceAnalysis'
import { fetchWithCache } from './github-mirror'
import { fetchFanqieTrends } from './fanqie-trends'
import { getWorkspaceDirPath } from './workspace-store'
import {
  exportProjectArchive,
  getProjectArchiveDefaultName,
  importProjectArchiveInWorker,
  inspectProjectArchive,
  type ProjectArchiveImportProgressPayload,
  type ProjectArchiveImportMode,
  type ProjectArchiveModule
} from './archive/project-archive'
import type { WorkspacePayload } from './workspace-types'
import type { WindowManager } from './window-manager'

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
  bookId?: string
  bookIndex?: number
  bookTotal?: number
  status?: 'queued' | 'running' | 'success' | 'error' | 'canceled'
  chunkIndex?: number
  chunkTotal?: number
  chunkLabel?: string
}

let activeBatchBookControllers: Map<string, AbortController> | null = null

const OUTLINE_SPREADSHEET_HEADERS = ['分卷名称', '分卷目标字数', '分卷摘要', '章节序号', '章节标题', '目标字数', '核心冲突', '剧情摘要', '状态']

function normalizeOutlineHeader(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').trim()
}

function scoreOutlineSheet(rows: string[][]): number {
  if (rows.length === 0) return 0
  const headers = rows[0].map(normalizeOutlineHeader)
  const headerScore = OUTLINE_SPREADSHEET_HEADERS.reduce((score, header) => score + (headers.includes(header) ? 10 : 0), 0)
  const dataScore = Math.min(rows.slice(1).filter((row) => row.some(Boolean)).length, 20)
  return headerScore + dataScore
}

function readOutlineSheetRows(sheet: XLSX.WorkSheet): string[][] {
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false
  })
  return rawRows
    .slice(0, 5001)
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
    .filter((row) => row.some(Boolean))
}

function formatOutlineStatusLabel(status: unknown): string {
  switch (String(status ?? '').trim()) {
    case 'idea':
      return '点子'
    case 'drafting':
      return '写作中'
    case 'done':
      return '已完成'
    case 'planned':
    default:
      return '已规划'
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

type RegisterMainIpcHandlersDeps = {
  windowManager: WindowManager
  setLatestWorkspaceSnapshot: (payload: unknown) => void
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

type ProjectArchiveImportRequest = {
  filePath?: string
  mode?: ProjectArchiveImportMode
  targetProjectId?: string
  modules?: ProjectArchiveModule[]
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

  ipcMain.handle('characterarc:export-project-archive', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload ?? {}) as { projectId?: string; projectTitle?: string }
    const projectId = String(request.projectId ?? '').trim()
    if (!projectId) {
      return { success: false, canceled: false, error: '缺少要导出的项目 ID。' }
    }

    const result = await dialog.showSaveDialog(window, {
      title: '导出项目归档包',
      defaultPath: getProjectArchiveDefaultName(String(request.projectTitle ?? 'CharacterArc 项目')),
      filters: [{ name: 'CharacterArc 项目归档', extensions: ['carc'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    try {
      const db = await deps.ensureWorkspaceDb()
      await exportProjectArchive({
        db,
        filePath: result.filePath,
        projectId,
        readWorkspaceSnapshot: deps.readWorkspaceSnapshot as (db: DatabaseSync) => WorkspacePayload | null
      })
      return { success: true, canceled: false, filePath: result.filePath }
    } catch (error) {
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '导出项目归档失败'
      }
    }
  })

  ipcMain.handle('characterarc:inspect-project-archive', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const result = await dialog.showOpenDialog(window, {
      title: '选择项目归档包',
      properties: ['openFile'],
      filters: [{ name: 'CharacterArc 项目归档', extensions: ['carc'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    try {
      const preview = await inspectProjectArchive(result.filePaths[0])
      return { success: true, canceled: false, filePath: result.filePaths[0], preview }
    } catch (error) {
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '无法读取项目归档包'
      }
    }
  })

  ipcMain.handle('characterarc:import-project-archive', async (_event, payload: unknown) => {
    const request = (payload ?? {}) as ProjectArchiveImportRequest
    const filePath = String(request.filePath ?? '').trim()
    const sendProgress = (progress: ProjectArchiveImportProgressPayload): void => {
      _event.sender.send('characterarc:project-archive-import-progress', progress)
    }
    if (!filePath) {
      return { success: false, canceled: false, error: '缺少要导入的项目归档文件。' }
    }

    try {
      sendProgress({ phase: 'preparing', message: '正在准备导入任务...', percent: 2 })
      await deps.ensureWorkspaceDb()
      const result = await importProjectArchiveInWorker({
        filePath,
        mode: request.mode ?? 'new-project',
        targetProjectId: request.targetProjectId,
        modules: request.modules,
        onProgress: sendProgress
      })
      sendProgress({ phase: 'syncing', message: '正在刷新工作区数据...', percent: 96 })
      const db = await deps.ensureWorkspaceDb()
      const workspace = deps.readWorkspaceSnapshot(db)
      if (workspace) {
        deps.setLatestWorkspaceSnapshot(workspace)
        deps.windowManager.broadcastWindowEvent('characterarc:workspace-sync-event', workspace)
      }
      sendProgress({ phase: 'done', message: '导入完成', percent: 100 })
      return { success: true, canceled: false, selectedProjectId: result.selectedProjectId }
    } catch (error) {
      sendProgress({
        phase: 'error',
        message: error instanceof Error ? error.message : '导入项目归档失败',
        percent: 100
      })
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '导入项目归档失败'
      }
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

  ipcMain.handle('characterarc:import-outline-spreadsheet', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true }

    const result = await dialog.showOpenDialog(window, {
      title: '导入剧情大纲',
      properties: ['openFile'],
      filters: [{ name: 'Excel 或 CSV', extensions: ['xlsx', 'xls', 'csv'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    try {
      const filePath = result.filePaths[0]
      const workbook = XLSX.read(await readFile(filePath), { type: 'buffer' })
      const candidates = workbook.SheetNames
        .map((name) => {
          const rows = workbook.Sheets[name] ? readOutlineSheetRows(workbook.Sheets[name]) : []
          return {
            sheetName: name,
            rows,
            score: scoreOutlineSheet(rows)
          }
        })
        .sort((left, right) => right.score - left.score)
      const selectedSheet = candidates[0]
      if (!selectedSheet) throw new Error('文件中没有可读取的工作表。')
      const { sheetName, rows } = selectedSheet
      if (rows.length < 2) throw new Error(`工作表「${sheetName}」没有可导入的数据行。`)
      return { success: true, canceled: false, fileName: basename(filePath), sheetName, rows }
    } catch (error) {
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '无法读取大纲文件。'
      }
    }
  })

  ipcMain.handle('characterarc:export-outline-template', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true }
    const result = await dialog.showSaveDialog(window, {
      title: '下载大纲 Excel 模板',
      defaultPath: 'CharacterArc-大纲导入模板.xlsx',
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }

    const headers = OUTLINE_SPREADSHEET_HEADERS
    const workbook = XLSX.utils.book_new()
    const templateSheet = XLSX.utils.aoa_to_sheet([headers, ['', '', '', '', '', '', '', '', '']])
    const exampleSheet = XLSX.utils.aoa_to_sheet([
      headers,
      ['第一卷：暗潮', '50000', '主角发现城中粮道失控的真正原因。', '1', '第1章：雨夜来客', '3200', '陌生人的求助可能是一场试探。', '主角在雨夜接下密信，并第一次接触南驿账簿。', '已规划'],
      ['', '', '', '2', '第2章：失踪账簿', '3500', '调查越深入，身边人的立场越可疑。', '账簿失踪，主角必须在官差封锁前找到经手人。', '点子']
    ])
    const descriptionSheet = XLSX.utils.aoa_to_sheet([
      ['字段', '是否必填', '说明'],
      ['分卷名称', '否', '每个分卷第一行填写即可，后续空白行自动沿用上一行分卷。不存在的分卷会在确认导入时新建。'],
      ['分卷目标字数', '否', '仅需在分卷第一行填写。'],
      ['分卷摘要', '否', '仅需在分卷第一行填写。'],
      ['章节序号', '否', '同一插入位置下的顺序，数字越小越靠前。'],
      ['章节标题', '是', '大纲节点标题。'],
      ['目标字数', '否', '章节预计字数。'],
      ['核心冲突', '否', '本章最主要的矛盾或阻力。'],
      ['剧情摘要', '否', '本章剧情推进内容。'],
      ['状态', '否', '可填：点子、已规划、写作中、已完成；不填默认已规划。']
    ])
    templateSheet['!cols'] = headers.map((header) => ({ wch: Math.max(12, header.length + 4) }))
    exampleSheet['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 36 }, { wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 36 }, { wch: 52 }, { wch: 12 }]
    descriptionSheet['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 72 }]
    templateSheet['!autofilter'] = { ref: 'A1:I1' }
    exampleSheet['!autofilter'] = { ref: 'A1:I1' }
    XLSX.utils.book_append_sheet(workbook, templateSheet, '大纲模板')
    XLSX.utils.book_append_sheet(workbook, exampleSheet, '填写示例')
    XLSX.utils.book_append_sheet(workbook, descriptionSheet, '字段说明')
    await writeFile(result.filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
    return { success: true, canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('characterarc:export-outline-spreadsheet', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true }
    const request = (payload ?? {}) as {
      projectTitle?: string
      volumes?: Array<{ id?: string; title?: string; wordTarget?: string; summary?: string }>
      items?: Array<{ volumeId?: string; title?: string; wordTarget?: string; conflict?: string; summary?: string; status?: string; sortOrder?: number }>
    }
    const safeProjectTitle = String(request.projectTitle ?? 'CharacterArc').replace(/[\\/:*?"<>|]/g, '-').trim() || 'CharacterArc'
    const result = await dialog.showSaveDialog(window, {
      title: '导出剧情大纲 Excel',
      defaultPath: `${safeProjectTitle}-剧情大纲.xlsx`,
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }

    const volumes = request.volumes ?? []
    const volumeMap = new Map(volumes.map((volume) => [volume.id ?? '', volume]))
    const volumeOrderMap = new Map(volumes.map((volume, index) => [volume.id ?? '', index]))
    const volumeSequence = new Map<string, number>()
    let previousVolumeId = ''
    const rows = [...(request.items ?? [])]
      .sort((left, right) => {
        const leftVolumeOrder = volumeOrderMap.get(left.volumeId ?? '') ?? Number.MAX_SAFE_INTEGER
        const rightVolumeOrder = volumeOrderMap.get(right.volumeId ?? '') ?? Number.MAX_SAFE_INTEGER
        return leftVolumeOrder - rightVolumeOrder || (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
      })
      .map((item) => {
      const volumeId = item.volumeId ?? ''
      const sequence = (volumeSequence.get(volumeId) ?? 0) + 1
      volumeSequence.set(volumeId, sequence)
      const volume = volumeMap.get(volumeId)
      const shouldPrintVolume = volumeId !== previousVolumeId
      previousVolumeId = volumeId
      return {
        分卷名称: shouldPrintVolume ? volume?.title ?? '' : '',
        分卷目标字数: shouldPrintVolume ? volume?.wordTarget ?? '' : '',
        分卷摘要: shouldPrintVolume ? volume?.summary ?? '' : '',
        章节序号: sequence,
        章节标题: item.title ?? '',
        目标字数: item.wordTarget ?? '',
        核心冲突: item.conflict ?? '',
        剧情摘要: item.summary ?? '',
        状态: formatOutlineStatusLabel(item.status)
      }
    })
    const workbook = XLSX.utils.book_new()
    const outlineSheet = XLSX.utils.json_to_sheet(rows, { header: OUTLINE_SPREADSHEET_HEADERS })
    outlineSheet['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 36 }, { wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 36 }, { wch: 52 }, { wch: 12 }]
    outlineSheet['!autofilter'] = { ref: 'A1:I1' }
    XLSX.utils.book_append_sheet(workbook, outlineSheet, '剧情大纲')
    await writeFile(result.filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
    return { success: true, canceled: false, filePath: result.filePath }
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

  // ── 选择参考小说文件（不立即开始拆书） ──
  ipcMain.handle('characterarc:pick-reference-novel-files', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const result = await dialog.showOpenDialog(window, {
      title: '选择参考小说',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '小说文本', extensions: ['txt', 'md', 'docx'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const files: Array<{ filePath: string; fileName: string; size: number }> = []
    for (const filePath of result.filePaths) {
      try {
        const stats = await stat(filePath)
        files.push({ filePath, fileName: basename(filePath), size: stats.size })
      } catch {
        files.push({ filePath, fileName: basename(filePath), size: 0 })
      }
    }
    return { success: true, canceled: false, files }
  })

  // ── 批量导入参考小说（支持多选、并发控制） ──
  ipcMain.handle('characterarc:import-reference-novel-batch', async (_event, payload: ReferenceNovelImportRequest & { filePaths?: string[]; concurrency?: number }) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload ?? {}) as ReferenceNovelImportRequest & { filePaths?: string[]; concurrency?: number }
    let filePaths = Array.isArray(request.filePaths) ? request.filePaths.filter((p): p is string => typeof p === 'string' && p.length > 0) : []

    // 兼容旧调用：如果未提供 filePaths，则回退到弹原生对话框
    if (filePaths.length === 0) {
      const result = await dialog.showOpenDialog(window, {
        title: '批量导入参考小说',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '小说文本', extensions: ['txt', 'md', 'docx'] }]
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }
      filePaths = result.filePaths
    }

    const bookTotal = filePaths.length
    const MAX_CONCURRENCY = Math.max(1, Math.min(8, Math.floor(request.concurrency ?? 3)))

    type BookResult = {
      bookId: string
      success: boolean
      result?: {
        referenceWork: unknown
        suggestedWritingStylePrompt: string
        knowledgeDocuments: unknown[]
      }
      error?: string
      fileName: string
    }

    const results: BookResult[] = []
    let completedCount = 0

    // 每本书一个 AbortController，支持单本停止
    const bookControllers = new Map<string, AbortController>()
    activeBatchBookControllers = bookControllers

    async function processOneBook(filePath: string, bookIndex: number, bookId: string): Promise<BookResult> {
      const fileName = basename(filePath)
      const controller = new AbortController()
      bookControllers.set(bookId, controller)

      const emit = (patch: Partial<ReferenceImportProgressPayload> & { phase: ReferenceImportProgressPayload['phase'] }) => {
        deps.emitReferenceImportProgress(window!, {
          message: '',
          current: 0,
          total: 1,
          percent: 0,
          sourceTitle: fileName,
          bookId,
          bookIndex,
          bookTotal,
          status: 'running',
          ...patch
        })
      }

      try {
        if (controller.signal.aborted) throw new Error('已取消')

        emit({ phase: 'extracting', message: '正在读取文件并提取基础信息…', percent: 5 })
        const localContext = await extractReferenceNovelContext(filePath)
        if (controller.signal.aborted) throw new Error('已取消')
        const resolvedTitle = request.preferredTitle?.trim() || localContext.title
        const resolvedSource = request.preferredSource?.trim() || localContext.fileType.toUpperCase()

        emit({
          phase: 'chunking',
          message: `已切分 ${localContext.analysisChunks.length} 个分块`,
          sourceTitle: resolvedTitle,
          percent: 16,
          chunkTotal: localContext.analysisChunks.length
        })

        const chunkResults: Array<{ label: string; characterCount: number; result: ReferenceStyleChunkResult }> = []
        const chunkTotal = localContext.analysisChunks.length
        for (const [index, chunk] of localContext.analysisChunks.entries()) {
          if (controller.signal.aborted) throw new Error('已取消')
          emit({
            phase: 'chunk-analysis',
            message: `分析分块 ${index + 1}/${chunkTotal}：${chunk.label}`,
            sourceTitle: resolvedTitle,
            percent: Math.min(82, 16 + Math.round(((index + 1) / Math.max(chunkTotal, 1)) * 58)),
            chunkIndex: index + 1,
            chunkTotal,
            chunkLabel: chunk.label
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
                chunkTotal,
                chunkCharacterCount: chunk.characterCount,
                chunkMetrics: chunk.metrics,
                chunkKeywords: chunk.topKeywords,
                chunkText: chunk.text
              }
            })).result as ReferenceStyleChunkResult
          })
        }

        if (controller.signal.aborted) throw new Error('已取消')
        emit({
          phase: 'aggregating',
          message: '正在汇总所有分块结论…',
          sourceTitle: resolvedTitle,
          percent: 90,
          chunkIndex: chunkTotal,
          chunkTotal
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

        if (controller.signal.aborted) throw new Error('已取消')
        emit({
          phase: 'saving',
          message: '正在归档到知识库…',
          sourceTitle: resolvedTitle,
          percent: 96
        })

        const importedAt = new Date().toISOString()
        const knowledgeDocuments = deps.buildImportedReferenceKnowledgeDocuments(resolvedTitle, localContext, analysis, chunkResults, importedAt)

        const refId = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const novelStorageDir = join(getWorkspaceDirPath(), 'reference-novels')
        await mkdir(novelStorageDir, { recursive: true })
        const rawNovelText = await readFile(filePath, 'utf-8')
        await writeFile(join(novelStorageDir, `${refId}.txt`), rawNovelText, 'utf-8')

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

        completedCount++
        emit({
          phase: 'done',
          message: `已归档 ${knowledgeDocuments.length} 篇知识文档 · 风格规则 ${analysis.styleRules?.length ?? 0} 条`,
          sourceTitle: resolvedTitle,
          percent: 100,
          status: 'success'
        })

        return {
          bookId,
          success: true,
          result: {
            referenceWork,
            suggestedWritingStylePrompt: deps.buildImportedReferenceStylePrompt(resolvedTitle, analysis),
            knowledgeDocuments
          },
          fileName
        }
      } catch (error) {
        completedCount++
        const message = error instanceof Error ? error.message : '拆书失败'
        const isCanceled = controller.signal.aborted || message.includes('已取消')
        emit({
          phase: 'done',
          message: isCanceled ? '已取消' : message,
          percent: 0,
          status: isCanceled ? 'canceled' : 'error'
        })
        return {
          bookId,
          success: false,
          error: isCanceled ? '已取消' : message,
          fileName
        }
      } finally {
        bookControllers.delete(bookId)
      }
    }

    const queue = filePaths.map((fp, i) => ({
      filePath: fp,
      bookIndex: i + 1,
      bookId: `book-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`
    }))

    // 上报排队态，让前端可以一次性渲染所有书的初始卡片
    for (const item of queue) {
      deps.emitReferenceImportProgress(window!, {
        phase: 'extracting',
        message: '排队中…',
        current: 0,
        total: 1,
        percent: 0,
        sourceTitle: basename(item.filePath),
        bookId: item.bookId,
        bookIndex: item.bookIndex,
        bookTotal,
        status: 'queued'
      })
    }

    const executing = new Set<Promise<void>>()
    for (const item of queue) {
      const p = processOneBook(item.filePath, item.bookIndex, item.bookId).then((r) => {
        results.push(r)
      })
      const wrapped = p.then(() => { executing.delete(wrapped) })
      executing.add(wrapped)
      if (executing.size >= MAX_CONCURRENCY) {
        await Promise.race(executing)
      }
    }
    await Promise.all(executing)

    activeBatchBookControllers = null

    results.sort((a, b) => {
      const ai = queue.findIndex((q) => q.bookId === a.bookId)
      const bi = queue.findIndex((q) => q.bookId === b.bookId)
      return ai - bi
    })

    return { success: true, canceled: false, results }
  })

  // ── 取消单本/全部批量拆书任务 ──
  ipcMain.handle('characterarc:cancel-reference-novel-book', async (_event, bookId: unknown) => {
    if (!activeBatchBookControllers) return { success: false, error: '没有正在进行的批量任务' }
    if (typeof bookId === 'string' && bookId) {
      const ctl = activeBatchBookControllers.get(bookId)
      if (!ctl) return { success: false, error: '未找到该任务' }
      ctl.abort()
      return { success: true }
    }
    // 不传 bookId 则全部取消
    for (const ctl of activeBatchBookControllers.values()) ctl.abort()
    return { success: true }
  })

  ipcMain.handle('characterarc:workspace-sync-publish', (event, payload: unknown) => {
    if (payload && typeof payload === 'object') {
      deps.setLatestWorkspaceSnapshot(deps.normalizeWorkspacePayload(payload))
    }
    deps.windowManager.broadcastWindowEvent('characterarc:workspace-sync-event', payload, event.sender.id)
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

  ipcMain.handle('characterarc:set-titlebar-overlay', (_event, options: unknown) => {
    const value = options as { color?: unknown; symbolColor?: unknown } | null
    const colors = value && typeof value.color === 'string' && typeof value.symbolColor === 'string'
      ? { color: value.color, symbolColor: value.symbolColor }
      : undefined
    deps.windowManager.updateTitleBarOverlayColors(colors)
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
      const resolvedProjectId = String(projectId ?? '').trim() || undefined
      await refreshSkillRegistry(resolvedProjectId)
      return { success: true, skills: skillScanEntries(resolvedProjectId) }
    } catch {
      return { success: true, skills: [] }
    }
  })

  ipcMain.handle('characterarc:project-skills-import', async (_event, projectId: unknown) => {
    try {
      const resolvedProjectId = String(projectId ?? '').trim() || undefined

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

  // ── 提交章节编辑提案 ──
  ipcMain.handle('characterarc:commit-chapter-edit', async (_event, payload: unknown) => {
    try {
      const { projectId, chapterId, oldContent, newContent } = payload as {
        projectId: string
        chapterId: string
        oldContent: string
        newContent: string
      }
      const { commitChapterEdit } = await import('./ai/agent/tools/chapter-data-access')
      const result = await commitChapterEdit(projectId, chapterId, oldContent, newContent)
      return { success: true, versionId: result.versionId }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '写回失败' }
    }
  })

  // ── 检查更新（GitHub Release API） ──
  ipcMain.handle('characterarc:check-update', async () => {
    try {
      const { app } = await import('electron')
      const currentVersion = app.getVersion()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      const response = await fetch('https://api.github.com/repos/uu201/character-arc/releases/latest', {
        headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'CharacterArc-Desktop' },
        signal: controller.signal
      })
      clearTimeout(timer)
      if (!response.ok) {
        return { success: false, error: `GitHub API 请求失败 (${response.status})` }
      }
      const release = await response.json() as {
        tag_name?: string
        name?: string
        body?: string
        html_url?: string
        published_at?: string
        assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>
      }
      const latestTag = (release.tag_name ?? '').replace(/^v\.?/, '')
      const hasUpdate = latestTag && latestTag !== currentVersion && compareVersions(latestTag, currentVersion) > 0
      return {
        success: true,
        result: {
          hasUpdate,
          currentVersion,
          latestVersion: latestTag,
          releaseTitle: release.name ?? '',
          releaseNotes: release.body ?? '',
          releaseUrl: release.html_url ?? '',
          publishedAt: release.published_at ?? '',
          assets: (release.assets ?? []).map(a => ({
            name: a.name ?? '',
            downloadUrl: a.browser_download_url ?? '',
            size: a.size ?? 0
          }))
        }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '检查更新失败' }
    }
  })

  ipcMain.handle('characterarc:fetch-announcements', async () => {
    return fetchWithCache({
      repo: 'uu201/character-arc',
      branch: 'main',
      filePath: 'announcements.json',
      cacheDir: 'announcements-cache',
      ttlMs: 0,
      timeoutMs: 8000,
      preferActiveMirror: false,
      allowStaleFallback: false,
    })
  })

  ipcMain.handle('characterarc:open-external-url', (_event, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url)
    }
  })

  // ── 番茄风向标：抓取榜单数据（主进程缓存，避免每次请求） ──
  ipcMain.handle('characterarc:fanqie-trends-fetch', async (_event, payload: { path?: string; force?: boolean }) => {
    const remotePath = typeof payload?.path === 'string' ? payload.path : ''
    const force = payload?.force === true
    return fetchFanqieTrends(remotePath, force)
  })

  // ── AI 助手会话持久化 ──

  ipcMain.handle('characterarc:session-list', async (_event, projectId: string) => {
    try {
      const db = await deps.ensureWorkspaceDb()
      const rows = db.prepare(
        'SELECT id, title, created_at, updated_at FROM assistant_sessions WHERE project_id = ? ORDER BY updated_at DESC'
      ).all(projectId) as Array<{ id: string; title: string; created_at: string; updated_at: string }>
      return { success: true, result: rows }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '获取会话列表失败' }
    }
  })

  ipcMain.handle('characterarc:session-load', async (_event, sessionId: string) => {
    try {
      const db = await deps.ensureWorkspaceDb()
      const row = db.prepare(
        'SELECT id, project_id, title, messages_json, created_at, updated_at FROM assistant_sessions WHERE id = ?'
      ).get(sessionId) as { id: string; project_id: string; title: string; messages_json: string; created_at: string; updated_at: string } | undefined
      if (!row) return { success: false, error: '会话不存在' }
      const parsed = JSON.parse(row.messages_json)
      const messages = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.messages) ? parsed.messages : []
      return { success: true, result: { ...row, ...(!Array.isArray(parsed) && parsed && typeof parsed === 'object' ? parsed : {}), messages } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '加载会话失败' }
    }
  })

  ipcMain.handle('characterarc:session-save', async (_event, payload: {
    id: string
    projectId: string
    title: string
    messages: unknown[]
    proposal?: unknown | null
    lastProposalPrompt?: string
    lastAssistantReply?: string
  }) => {
    try {
      const db = await deps.ensureWorkspaceDb()
      const now = new Date().toISOString()
      const messagesJson = JSON.stringify({
        messages: payload.messages,
        proposal: payload.proposal ?? null,
        lastProposalPrompt: payload.lastProposalPrompt ?? '',
        lastAssistantReply: payload.lastAssistantReply ?? ''
      })
      db.prepare(
        `INSERT INTO assistant_sessions (id, project_id, title, messages_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, messages_json = excluded.messages_json, updated_at = excluded.updated_at`
      ).run(payload.id, payload.projectId, payload.title, messagesJson, now, now)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '保存会话失败' }
    }
  })

  ipcMain.handle('characterarc:session-delete', async (_event, sessionId: string) => {
    try {
      const db = await deps.ensureWorkspaceDb()
      db.prepare('DELETE FROM assistant_sessions WHERE id = ?').run(sessionId)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '删除会话失败' }
    }
  })
}
