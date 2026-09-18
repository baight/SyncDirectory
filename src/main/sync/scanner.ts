import { readdir, stat } from 'fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { CopyItem, DeleteItem, PlanRequest, SkipItem, SyncPlan } from '@shared/sync-types'

/** 文件系统条目（扫描结果） */
export interface FsEntry {
  relPath: string
  absPath: string
  size: number
  isDir: boolean
}

export interface ScanResult {
  files: FsEntry[]
  dirs: FsEntry[]
  warnings: string[]
}

function stripSep(p: string): string {
  return p.endsWith(sep) ? p.slice(0, -sep.length) : p
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 判断 child 是否位于 parent 内部（传入前需先 resolve 并小写化） */
function isInside(parentLc: string, childLc: string): boolean {
  const rel = relative(parentLc, childLc)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** 校验源/目标目录合法性：存在性、类型、包含关系。不合法时抛出中文错误 */
export async function validatePathPair(sourceDir: string, targetDir: string): Promise<void> {
  const s = stripSep(resolve(sourceDir))
  const t = stripSep(resolve(targetDir))

  const sStat = await stat(s).catch(() => null)
  if (!sStat || !sStat.isDirectory()) {
    throw new Error(`源目录不存在或不是目录：${s}`)
  }
  const tStat = await stat(t).catch(() => null)
  if (tStat && !tStat.isDirectory()) {
    throw new Error(`目标路径已存在但不是目录：${t}`)
  }

  const ls = s.toLowerCase()
  const lt = t.toLowerCase()
  if (ls === lt) {
    throw new Error('源目录与目标目录不能相同')
  }
  if (isInside(ls, lt)) {
    throw new Error('目标目录位于源目录内部，禁止同步（防止误删源目录）')
  }
  if (isInside(lt, ls)) {
    throw new Error('源目录位于目标目录内部，禁止同步')
  }
}

/** 递归扫描目录，收集文件与子目录。跳过符号链接并记录警告 */
export async function scanTree(root: string): Promise<ScanResult> {
  const files: FsEntry[] = []
  const dirs: FsEntry[] = []
  const warnings: string[] = []
  const rootAbs = stripSep(resolve(root))

  async function walk(absDir: string, relDir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch (err) {
      warnings.push(`无法读取目录 ${relDir || '(根目录)'}：${errMessage(err)}`)
      return
    }
    for (const entry of entries) {
      const abs = join(absDir, entry.name)
      const rel = relDir ? `${relDir}${sep}${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        warnings.push(`已跳过符号链接：${rel}`)
        continue
      }
      if (entry.isDirectory()) {
        dirs.push({ relPath: rel, absPath: abs, size: 0, isDir: true })
        await walk(abs, rel)
      } else if (entry.isFile()) {
        const st = await stat(abs).catch(() => null)
        if (!st) {
          warnings.push(`无法获取文件信息，已跳过：${rel}`)
          continue
        }
        files.push({ relPath: rel, absPath: abs, size: st.size, isDir: false })
      } else {
        warnings.push(`已跳过非常规文件：${rel}`)
      }
    }
  }

  await walk(rootAbs, '')
  return { files, dirs, warnings }
}

/** 平铺名映射：relPath → 目标根目录下的文件名。确定性且幂等，冲突时在扩展名前加序号 */
export function buildFlatNameMap(files: FsEntry[]): {
  map: Map<string, string>
  warnings: string[]
} {
  const map = new Map<string, string>()
  const warnings: string[] = []
  const occupied = new Set<string>() // 存小写形式，Windows 文件名不区分大小写

  // 按码点序排序保证结果确定：路径分隔符(0x5C)小于下划线(0x5F)
  const sorted = [...files].sort((a, b) =>
    a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0
  )

  for (const f of sorted) {
    const natural = f.relPath.split(/[\\/]+/).join('_')
    let name = natural
    if (occupied.has(name.toLowerCase())) {
      let k = 1
      do {
        name = withIndexSuffix(natural, k)
        k += 1
      } while (occupied.has(name.toLowerCase()))
      warnings.push(`平铺重命名：${f.relPath} → ${name}`)
    }
    occupied.add(name.toLowerCase())
    map.set(f.relPath, name)
  }
  return { map, warnings }
}

function withIndexSuffix(name: string, k: number): string {
  const ext = extname(name)
  const base = ext ? name.slice(0, -ext.length) : name
  return `${base}_${k}${ext}`
}

/** 生成同步计划（纯读取，不做任何写操作） */
export async function buildPlan(req: PlanRequest): Promise<Omit<SyncPlan, 'planId'>> {
  await validatePathPair(req.sourceDir, req.targetDir)

  const sourceDir = stripSep(resolve(req.sourceDir))
  const targetDir = stripSep(resolve(req.targetDir))
  const tStat = await stat(targetDir).catch(() => null)
  const targetExists = tStat !== null

  const src = await scanTree(sourceDir)
  const tgt = targetExists ? await scanTree(targetDir) : { files: [], dirs: [], warnings: [] }
  const warnings: string[] = [...src.warnings, ...tgt.warnings]

  const copy: CopyItem[] = []
  const del: DeleteItem[] = []
  const skip: SkipItem[] = []
  const createDirs: string[] = []

  if (req.layoutMode === 'flat') {
    buildFlatPlan(req, src, tgt, targetDir, copy, del, skip, warnings)
  } else {
    buildOriginalPlan(req, src, tgt, targetDir, copy, del, skip, createDirs, warnings)
  }

  copy.sort((a, b) =>
    a.targetRelPath < b.targetRelPath ? -1 : a.targetRelPath > b.targetRelPath ? 1 : 0
  )
  const totalCopyBytes = copy.reduce((sum, c) => sum + c.size, 0)

  return {
    sourceDir,
    targetDir,
    layoutMode: req.layoutMode,
    syncMode: req.syncMode,
    useTrash: req.useTrash,
    copy,
    delete: del,
    skip,
    createDirs,
    totalCopyBytes,
    warnings
  }
}

/** 排序：父目录排在子目录前（relPath 前缀性质） */
function byRelPath(a: FsEntry, b: FsEntry): number {
  return a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0
}

/** 原始结构模式：目标保持与源一致的目录结构 */
function buildOriginalPlan(
  req: PlanRequest,
  src: ScanResult,
  tgt: ScanResult,
  targetDir: string,
  copy: CopyItem[],
  del: DeleteItem[],
  skip: SkipItem[],
  createDirs: string[],
  warnings: string[]
): void {
  const full = req.syncMode === 'full'
  const srcFiles = new Map(src.files.map((f) => [f.relPath, f]))
  const srcDirs = new Set(src.dirs.map((d) => d.relPath))
  const tgtFiles = new Map(tgt.files.map((f) => [f.relPath, f]))
  const tgtDirs = new Set(tgt.dirs.map((d) => d.relPath))

  // ---- 删除列表（仅完全同步）----
  const markedDirs = new Set<string>() // 小写绝对路径
  const markedAll = new Set<string>()
  const pushDelete = (item: DeleteItem): void => {
    del.push(item)
    markedAll.add(item.targetPath.toLowerCase())
    if (item.isDirectory) {
      markedDirs.add(item.targetPath.toLowerCase())
    }
  }
  const coveredByMarkedDir = (p: string): boolean => {
    const lc = p.toLowerCase()
    for (const d of markedDirs) {
      if (lc.startsWith(d + sep)) {
        return true
      }
    }
    return false
  }

  // A1. 目标中多余的目录（源中无对应目录）；源中该位置是文件则为类型冲突
  if (full) {
    for (const td of [...tgt.dirs].sort(byRelPath)) {
      if (srcDirs.has(td.relPath) || coveredByMarkedDir(td.absPath)) {
        continue
      }
      pushDelete({
        targetPath: td.absPath,
        targetRelPath: td.relPath,
        isDirectory: true,
        reason: srcFiles.has(td.relPath) ? 'type-mismatch' : 'extra'
      })
    }
  }

  // A2. 源目录建立受阻的情况：目标该位置是文件
  const blockedDirRels = new Set<string>()
  for (const sd of [...src.dirs].sort(byRelPath)) {
    const parentRel = dirname(sd.relPath)
    const parentBlocked = parentRel !== '' && blockedDirRels.has(parentRel)
    const tgtFile = tgtFiles.get(sd.relPath)
    if (tgtFile) {
      if (full) {
        pushDelete({
          targetPath: tgtFile.absPath,
          targetRelPath: sd.relPath,
          isDirectory: false,
          reason: 'type-mismatch'
        })
        createDirs.push(join(targetDir, sd.relPath))
      } else {
        blockedDirRels.add(sd.relPath)
        warnings.push(`目标中已存在同名文件，无法创建目录（其内容已跳过）：${sd.relPath}`)
      }
    } else if (parentBlocked) {
      blockedDirRels.add(sd.relPath)
    } else if (!tgtDirs.has(sd.relPath)) {
      createDirs.push(join(targetDir, sd.relPath))
    }
  }

  // A3. 目标中多余的文件
  if (full) {
    for (const tf of tgt.files) {
      if (srcFiles.has(tf.relPath) || srcDirs.has(tf.relPath)) {
        continue
      }
      if (coveredByMarkedDir(tf.absPath) || markedAll.has(tf.absPath.toLowerCase())) {
        continue
      }
      pushDelete({
        targetPath: tf.absPath,
        targetRelPath: tf.relPath,
        isDirectory: false,
        reason: 'extra'
      })
    }
  }

  // ---- 复制列表（增量与完全同步共用）----
  for (const sf of src.files) {
    const parentRel = dirname(sf.relPath)
    if (blockedDirRels.has(parentRel)) {
      skip.push({
        sourceRelPath: sf.relPath,
        targetRelPath: sf.relPath,
        sourceSize: sf.size,
        targetSize: 0,
        reason: 'type-mismatch'
      })
      continue
    }
    const tf = tgtFiles.get(sf.relPath)
    if (tf) {
      if (tf.size === sf.size) {
        continue // 名称+大小相同，视为同一文件，跳过
      }
      if (full) {
        copy.push(mkCopy(sf, sf.relPath, targetDir, true))
      } else {
        skip.push({
          sourceRelPath: sf.relPath,
          targetRelPath: sf.relPath,
          sourceSize: sf.size,
          targetSize: tf.size,
          reason: 'size-mismatch'
        })
      }
    } else if (tgtDirs.has(sf.relPath)) {
      // 目标该位置是目录而源是文件：完全同步时 A1 已将其列入删除，此处直接复制
      if (!full) {
        skip.push({
          sourceRelPath: sf.relPath,
          targetRelPath: sf.relPath,
          sourceSize: sf.size,
          targetSize: 0,
          reason: 'type-mismatch'
        })
        warnings.push(`目标中存在同名目录，无法复制文件：${sf.relPath}`)
      } else {
        copy.push(mkCopy(sf, sf.relPath, targetDir, true))
      }
    } else {
      copy.push(mkCopy(sf, sf.relPath, targetDir, false))
    }
  }
}

function mkCopy(
  f: FsEntry,
  targetRelPath: string,
  targetDir: string,
  overwrite: boolean
): CopyItem {
  return {
    sourcePath: f.absPath,
    targetPath: join(targetDir, targetRelPath),
    sourceRelPath: f.relPath,
    targetRelPath,
    size: f.size,
    overwrite
  }
}

/** 平铺模式：忽略源目录结构，所有文件平铺存到目标根目录 */
function buildFlatPlan(
  req: PlanRequest,
  src: ScanResult,
  tgt: ScanResult,
  targetDir: string,
  copy: CopyItem[],
  del: DeleteItem[],
  skip: SkipItem[],
  warnings: string[]
): void {
  const full = req.syncMode === 'full'
  const { map: flatMap, warnings: renames } = buildFlatNameMap(src.files)
  warnings.push(...renames)

  // 目标根目录下的文件（平铺模式只比较根目录文件）
  const tgtRootFiles = new Map<string, FsEntry>()
  for (const f of tgt.files) {
    if (!f.relPath.includes(sep) && !f.relPath.includes('/')) {
      tgtRootFiles.set(f.relPath.toLowerCase(), f)
    }
  }

  // 目标中的子目录：完全同步全部视为多余删除；增量同步整体忽略
  if (tgt.dirs.length > 0) {
    if (full) {
      const markedDirs = new Set<string>()
      for (const td of [...tgt.dirs].sort(byRelPath)) {
        const lc = td.absPath.toLowerCase()
        let covered = false
        for (const d of markedDirs) {
          if (lc.startsWith(d + sep)) {
            covered = true
            break
          }
        }
        if (covered) {
          continue
        }
        markedDirs.add(lc)
        del.push({
          targetPath: td.absPath,
          targetRelPath: td.relPath,
          isDirectory: true,
          reason: 'extra'
        })
      }
    } else {
      warnings.push(
        `目标目录中存在 ${tgt.dirs.length} 个子目录（含其中的文件），增量同步不会改动它们`
      )
    }
  }

  // 完全同步：目标根目录下不属于源文件集合（按平铺名）的文件删除
  if (full) {
    const flatLower = new Set([...flatMap.values()].map((s) => s.toLowerCase()))
    for (const tf of tgtRootFiles.values()) {
      if (!flatLower.has(tf.relPath.toLowerCase())) {
        del.push({
          targetPath: tf.absPath,
          targetRelPath: tf.relPath,
          isDirectory: false,
          reason: 'extra'
        })
      }
    }
  }

  for (const sf of src.files) {
    const flat = flatMap.get(sf.relPath) as string
    const tf = tgtRootFiles.get(flat.toLowerCase())
    if (!tf) {
      copy.push(mkCopy(sf, flat, targetDir, false))
    } else if (tf.size === sf.size) {
      continue
    } else if (full) {
      copy.push(mkCopy(sf, flat, targetDir, true))
    } else {
      skip.push({
        sourceRelPath: sf.relPath,
        targetRelPath: tf.relPath,
        sourceSize: sf.size,
        targetSize: tf.size,
        reason: 'size-mismatch'
      })
    }
  }
}
