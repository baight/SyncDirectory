import { computed, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { ComputedRef, Ref, ShallowRef } from 'vue'
import type {
  JobStatus,
  LayoutMode,
  PlanRequest,
  SyncConfigItem,
  SyncConfigsFile,
  SyncMode,
  SyncPlan,
  SyncProgress,
  SyncResult
} from '@shared/sync-types'

/** 同步设置表单状态 */
export interface SyncForm {
  sourceDir: string
  targetDir: string
  layoutMode: LayoutMode
  syncMode: SyncMode
  useTrash: boolean
}

/** useSync 返回的同步功能状态仓库 */
interface SyncStore {
  configs: Ref<SyncConfigItem[]>
  selectedId: Ref<string>
  selectedConfig: ComputedRef<SyncConfigItem | null>
  form: SyncForm
  saving: Ref<boolean>
  plan: ShallowRef<SyncPlan | null>
  planning: Ref<boolean>
  canStart: ComputedRef<boolean>
  syncing: Ref<boolean>
  progress: SyncProgress
  result: ShallowRef<SyncResult | null>
  refreshConfigs(): Promise<void>
  applyConfig(item: SyncConfigItem): void
  saveConfig(): Promise<void>
  renameConfig(id: string, name: string): Promise<void>
  deleteConfig(id: string): Promise<void>
  pickDirectory(field: 'sourceDir' | 'targetDir'): Promise<void>
  generatePlan(): Promise<void>
  startSync(): Promise<void>
  cancelSync(): Promise<void>
  restoreRunningJob(): Promise<void>
}

function emptyForm(): SyncForm {
  return {
    sourceDir: '',
    targetDir: '',
    layoutMode: 'original',
    syncMode: 'incremental',
    useTrash: false
  }
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i === -1 ? p : p.slice(i + 1)
}

function errMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

/** 渲染进程同步功能状态编排：配置列表、表单、计划预览、进度与结果 */
export function useSync(): SyncStore {
  const configs = ref<SyncConfigItem[]>([])
  const selectedId = ref('')
  const selectedConfig = computed<SyncConfigItem | null>(
    () => configs.value.find((c) => c.id === selectedId.value) ?? null
  )

  const form = reactive<SyncForm>(emptyForm())
  const saving = ref(false)

  const plan = shallowRef<SyncPlan | null>(null)
  const planning = ref(false)
  /** 已生成预览且有需要复制/删除的内容时才允许开始同步 */
  const canStart = computed<boolean>(() => {
    const p = plan.value
    return !!p && (p.copy.length > 0 || p.delete.length > 0)
  })

  const syncing = ref(false)
  const progress = reactive<SyncProgress>({
    phase: 'copying',
    current: 0,
    total: 0,
    currentPath: ''
  })
  const result = shallowRef<SyncResult | null>(null)

  // 目录或模式变化后旧预览失效，需重新生成
  watch(
    () => [form.sourceDir, form.targetDir, form.layoutMode, form.syncMode, form.useTrash],
    () => {
      plan.value = null
    }
  )

  async function refreshConfigs(): Promise<void> {
    try {
      const file: SyncConfigsFile = await window.api.loadConfigs()
      configs.value = file.items
    } catch (err) {
      ElMessage.error(errMessage(err))
    }
  }

  function applyConfig(item: SyncConfigItem): void {
    selectedId.value = item.id
    Object.assign(form, {
      sourceDir: item.sourceDir,
      targetDir: item.targetDir,
      layoutMode: item.layoutMode,
      syncMode: item.syncMode,
      useTrash: item.useTrash
    })
    plan.value = null
    result.value = null
  }

  /** 保存当前表单为新配置，配置名自动取“源目录名-目标目录名” */
  async function saveConfig(): Promise<void> {
    if (!form.sourceDir || !form.targetDir) {
      ElMessage.warning('请先选择源目录和目标目录')
      return
    }
    saving.value = true
    try {
      const newItem: SyncConfigItem = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        name: `${baseName(form.sourceDir)}-${baseName(form.targetDir)}`,
        sourceDir: form.sourceDir,
        targetDir: form.targetDir,
        layoutMode: form.layoutMode,
        syncMode: form.syncMode,
        useTrash: form.useTrash
      }
      const items = [...configs.value, newItem]
      await window.api.saveConfigs({ version: 1, items })
      configs.value = items
      selectedId.value = newItem.id
      ElMessage.success('配置已保存')
    } catch (err) {
      ElMessage.error(errMessage(err))
    } finally {
      saving.value = false
    }
  }

  async function renameConfig(id: string, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const items = configs.value.map((c) => (c.id === id ? { ...c, name: trimmed } : c))
      await window.api.saveConfigs({ version: 1, items })
      configs.value = items
    } catch (err) {
      ElMessage.error(errMessage(err))
    }
  }

  async function deleteConfig(id: string): Promise<void> {
    try {
      const items = configs.value.filter((c) => c.id !== id)
      await window.api.saveConfigs({ version: 1, items })
      configs.value = items
      if (selectedId.value === id) {
        selectedId.value = ''
        Object.assign(form, emptyForm())
        plan.value = null
        result.value = null
      }
    } catch (err) {
      ElMessage.error(errMessage(err))
    }
  }

  async function pickDirectory(field: 'sourceDir' | 'targetDir'): Promise<void> {
    try {
      const dir = await window.api.pickDirectory(
        field === 'sourceDir' ? '选择源目录' : '选择目标目录'
      )
      if (dir) {
        form[field] = dir
      }
    } catch (err) {
      ElMessage.error(errMessage(err))
    }
  }

  async function generatePlan(): Promise<void> {
    if (!form.sourceDir || !form.targetDir) {
      ElMessage.warning('请先选择源目录和目标目录')
      return
    }
    planning.value = true
    try {
      const req: PlanRequest = {
        sourceDir: form.sourceDir,
        targetDir: form.targetDir,
        layoutMode: form.layoutMode,
        syncMode: form.syncMode,
        useTrash: form.useTrash
      }
      plan.value = await window.api.planSync(req)
      // 重新生成预览后，关闭上次同步结果的显示
      result.value = null
    } catch (err) {
      ElMessage.error(errMessage(err))
    } finally {
      planning.value = false
    }
  }

  async function startSync(): Promise<void> {
    const current = plan.value
    if (!current) {
      return
    }
    syncing.value = true
    result.value = null
    Object.assign(progress, { phase: 'copying', current: 0, total: 0, currentPath: '' })
    try {
      result.value = await window.api.startSync(current.planId)
    } catch (err) {
      ElMessage.error(errMessage(err))
    } finally {
      syncing.value = false
      plan.value = null
    }
  }

  async function cancelSync(): Promise<void> {
    try {
      await window.api.cancelSync()
      ElMessage.info('正在取消，将在当前文件处理完成后停止')
    } catch (err) {
      ElMessage.error(errMessage(err))
    }
  }

  /** HMR/重连后恢复进行中任务的进度显示 */
  async function restoreRunningJob(): Promise<void> {
    try {
      const status: JobStatus | null = await window.api.getSyncStatus()
      if (status && status.running) {
        syncing.value = true
        Object.assign(progress, {
          phase: status.phase ?? 'copying',
          current: status.current,
          total: status.total,
          currentPath: ''
        })
      }
    } catch {
      // ignore
    }
  }

  const unlisten = window.api.onSyncProgress((p) => Object.assign(progress, p))
  onScopeDispose(unlisten)

  return {
    configs,
    selectedId,
    selectedConfig,
    form,
    saving,
    plan,
    planning,
    canStart,
    syncing,
    progress,
    result,
    refreshConfigs,
    applyConfig,
    saveConfig,
    renameConfig,
    deleteConfig,
    pickDirectory,
    generatePlan,
    startSync,
    cancelSync,
    restoreRunningJob
  }
}
