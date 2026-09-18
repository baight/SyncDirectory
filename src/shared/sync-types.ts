// 跨进程共享类型（主进程 / preload / 渲染进程唯一类型源）

/** 目录结构模式：平铺 / 原始 */
export type LayoutMode = 'flat' | 'original'

/** 同步模式：增量 / 完全 */
export type SyncMode = 'incremental' | 'full'

/** 一条已保存的同步配置 */
export interface SyncConfigItem {
  id: string
  name: string
  sourceDir: string
  targetDir: string
  layoutMode: LayoutMode
  syncMode: SyncMode
  /** 删除时移入回收站（而非永久删除） */
  useTrash: boolean
  createdAt: string
}

/** 配置文件结构 */
export interface SyncConfigsFile {
  version: 1
  items: SyncConfigItem[]
}

/** 生成同步计划的请求 */
export interface PlanRequest {
  sourceDir: string
  targetDir: string
  layoutMode: LayoutMode
  syncMode: SyncMode
  useTrash: boolean
}

/** 待复制的文件 */
export interface CopyItem {
  sourcePath: string
  targetPath: string
  /** 相对源根目录（展示用） */
  sourceRelPath: string
  /** 相对目标根目录（平铺模式下为映射后的文件名） */
  targetRelPath: string
  size: number
  /** true = 完全同步下同名不同大小的覆盖复制 */
  overwrite: boolean
}

/** 待删除的目标项 */
export interface DeleteItem {
  targetPath: string
  targetRelPath: string
  isDirectory: boolean
  /** extra = 多余项；type-mismatch = 目标文件与源目录类型冲突 */
  reason: 'extra' | 'type-mismatch'
}

/** 被跳过的源文件（含原因） */
export interface SkipItem {
  sourceRelPath: string
  targetRelPath: string
  sourceSize: number
  targetSize: number
  reason: 'size-mismatch' | 'type-mismatch'
}

/** 同步计划（预览即所执行） */
export interface SyncPlan {
  planId: string
  sourceDir: string
  targetDir: string
  layoutMode: LayoutMode
  syncMode: SyncMode
  useTrash: boolean
  copy: CopyItem[]
  delete: DeleteItem[]
  skip: SkipItem[]
  /** 需要创建的目录（原始模式，含空目录镜像） */
  createDirs: string[]
  totalCopyBytes: number
  warnings: string[]
}

/** 同步进度事件 */
export interface SyncProgress {
  phase: 'copying' | 'deleting'
  current: number
  total: number
  currentPath: string
}

/** 同步执行结果 */
export interface SyncResult {
  copiedCount: number
  deletedCount: number
  skipped: SkipItem[]
  errors: { path: string; message: string }[]
  warnings: string[]
  canceled: boolean
  durationMs: number
}

/** 执行器状态（用于 HMR/重连后恢复进度显示） */
export interface JobStatus {
  running: boolean
  phase: SyncProgress['phase'] | null
  current: number
  total: number
}

/** preload 暴露给渲染进程的 API */
export interface SyncApi {
  pickDirectory(title?: string): Promise<string | null>
  loadConfigs(): Promise<SyncConfigsFile>
  saveConfigs(file: SyncConfigsFile): Promise<void>
  planSync(req: PlanRequest): Promise<SyncPlan>
  startSync(planId: string): Promise<SyncResult>
  cancelSync(): Promise<{ canceled: boolean }>
  getSyncStatus(): Promise<JobStatus | null>
  /** 监听同步进度事件，返回解绑函数 */
  onSyncProgress(cb: (p: SyncProgress) => void): () => void
}
