import { dirname } from 'path'
import { copyFile, mkdir, rm, unlink } from 'fs/promises'
import type {
  CopyItem,
  DeleteItem,
  JobStatus,
  SyncPlan,
  SyncProgress,
  SyncResult
} from '@shared/sync-types'

interface PhaseReport {
  succeeded: number
  errors: { path: string; message: string }[]
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isEnoent(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || errMessage(err).includes('ENOENT')
}

/**
 * 同步计划执行器：按 删除 → 建目录 → 复制 的固定顺序执行计划。
 * 单项失败记录后继续；取消在当前单项完成后生效。
 */
export class SyncExecutor {
  readonly #plan: SyncPlan
  readonly #onProgress: (p: SyncProgress) => void
  #canceled = false
  #running = false
  #status: JobStatus = { running: false, phase: null, current: 0, total: 0 }

  constructor(plan: SyncPlan, onProgress: (p: SyncProgress) => void) {
    this.#plan = plan
    this.#onProgress = onProgress
  }

  get running(): boolean {
    return this.#running
  }

  get status(): JobStatus {
    return { ...this.#status }
  }

  cancel(): void {
    this.#canceled = true
  }

  async run(): Promise<SyncResult> {
    if (this.#running) {
      throw new Error('同步任务已在执行中')
    }
    this.#running = true
    this.#canceled = false
    const started = Date.now()
    const result: SyncResult = {
      copiedCount: 0,
      deletedCount: 0,
      skipped: this.#plan.skip,
      errors: [],
      warnings: this.#plan.warnings,
      canceled: false,
      durationMs: 0
    }
    try {
      const delReport = await this.#runPhase('deleting', this.#plan.delete, (item) =>
        this.#removeEntry(item)
      )
      result.deletedCount = delReport.succeeded
      result.errors.push(...delReport.errors)
      if (this.#canceled) {
        result.canceled = true
        return result
      }

      for (const dir of this.#plan.createDirs) {
        if (this.#canceled) {
          result.canceled = true
          return result
        }
        try {
          await mkdir(dir, { recursive: true })
        } catch (err) {
          result.errors.push({ path: dir, message: errMessage(err) })
        }
      }
      if (this.#canceled) {
        result.canceled = true
        return result
      }

      const copyReport = await this.#runPhase('copying', this.#plan.copy, (item) =>
        this.#copyItem(item)
      )
      result.copiedCount = copyReport.succeeded
      result.errors.push(...copyReport.errors)
      if (this.#canceled) {
        result.canceled = true
      }
      return result
    } finally {
      this.#running = false
      this.#status = { running: false, phase: null, current: 0, total: 0 }
      result.durationMs = Date.now() - started
    }
  }

  async #runPhase<T extends { targetPath: string; targetRelPath: string }>(
    phase: SyncProgress['phase'],
    items: T[],
    op: (item: T) => Promise<void>
  ): Promise<PhaseReport> {
    this.#status = { running: true, phase, current: 0, total: items.length }
    const report: PhaseReport = { succeeded: 0, errors: [] }
    for (const item of items) {
      if (this.#canceled) {
        break
      }
      try {
        await op(item)
        report.succeeded += 1
      } catch (err) {
        report.errors.push({ path: item.targetPath, message: errMessage(err) })
      }
      this.#status = {
        running: true,
        phase,
        current: report.succeeded + report.errors.length,
        total: items.length
      }
      this.#onProgress({
        phase,
        current: report.succeeded + report.errors.length,
        total: items.length,
        currentPath: item.targetRelPath
      })
    }
    return report
  }

  async #copyItem(item: CopyItem): Promise<void> {
    await mkdir(dirname(item.targetPath), { recursive: true })
    await copyFile(item.sourcePath, item.targetPath)
  }

  async #removeEntry(item: DeleteItem): Promise<void> {
    try {
      if (this.#plan.useTrash) {
        // 动态引入，避免在纯 Node 环境（如测试脚本）中加载 electron
        const { shell } = await import('electron')
        await shell.trashItem(item.targetPath)
      } else if (item.isDirectory) {
        await rm(item.targetPath, { recursive: true, force: true })
      } else {
        await unlink(item.targetPath)
      }
    } catch (err) {
      // 已被删除视为成功（对脏目录状态保持鲁棒）
      if (isEnoent(err)) {
        return
      }
      throw err
    }
  }
}
