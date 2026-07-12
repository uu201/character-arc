import { parentPort, workerData } from 'node:worker_threads'

import { ensureWorkspaceDb, readWorkspaceSnapshot, writeWorkspaceSnapshot } from '../workspace-store'
import { importProjectArchive, type ProjectArchiveImportMode, type ProjectArchiveModule } from './project-archive'

type ImportProjectArchiveWorkerRequest = {
  filePath: string
  mode: ProjectArchiveImportMode
  targetProjectId?: string
  modules?: ProjectArchiveModule[]
  workspaceDir: string
}

async function run(): Promise<void> {
  const request = workerData as ImportProjectArchiveWorkerRequest
  try {
    if (request.workspaceDir) {
      process.env.CHARACTERARC_WORKSPACE_DIR = request.workspaceDir
    }
    const db = await ensureWorkspaceDb()
    const result = await importProjectArchive({
      db,
      filePath: request.filePath,
      mode: request.mode,
      targetProjectId: request.targetProjectId,
      modules: request.modules,
      readWorkspaceSnapshot,
      writeWorkspaceSnapshot
    })
    parentPort?.postMessage({ success: true, selectedProjectId: result.selectedProjectId })
  } catch (error) {
    parentPort?.postMessage({
      success: false,
      error: error instanceof Error ? error.message : '导入项目归档失败'
    })
  }
}

void run()
