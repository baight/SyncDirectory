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

/** "名称(大小)"后缀：b.txt + 1024 字节 → b(1024).txt */
function withSizeSuffix(name: string, size: number): string {
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  return `${stem}(${size})${ext}`
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
    buildFlatPlan(req, src, tgt, targetDir, copy, del, warnings)
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
      skip.push(mkSkip(sf, sf.relPath, 0, targetDir, 'type-mismatch'))
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
        skip.push(mkSkip(sf, sf.relPath, tf.size, targetDir, 'size-mismatch'))
      }
    } else if (tgtDirs.has(sf.relPath)) {
      // 目标该位置是目录而源是文件：完全同步时 A1 已将其列入删除，此处直接复制
      if (!full) {
        skip.push(mkSkip(sf, sf.relPath, 0, targetDir, 'type-mismatch'))
        warnings.push(`目标中存在同名目录，无法复制文件：${sf.relPath}`)
      } else {
        copy.push(mkCopy(sf, sf.relPath, targetDir, true))
      }
    } else {
      copy.push(mkCopy(sf, sf.relPath, targetDir, false))
    }
  }
}

function mkSkip(
  f: FsEntry,
  targetRelPath: string,
  targetSize: number,
  targetDir: string,
  reason: SkipItem['reason']
): SkipItem {
  return {
    sourcePath: f.absPath,
    targetPath: join(targetDir, targetRelPath),
    sourceRelPath: f.relPath,
    targetRelPath,
    sourceSize: f.size,
    targetSize,
    reason
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

/** 平铺模式：忽略源目录结构，所有文件平铺存到目标根目录。
 * 命名规则：保留原始文件名；同名冲突（源内多文件同名、或与目标同名但大小不同）时
 * 用"名称(字节数)"区分，如 b.txt 与 b(1024).txt。
 * 已同步判定：目标根目录存在同名同大小文件，或存在"名称(大小)"文件 */
function buildFlatPlan(
  req: PlanRequest,
  src: ScanResult,
  tgt: ScanResult,
  targetDir: string,
  copy: CopyItem[],
  del: DeleteItem[],
  warnings: string[]
): void {
  const full = req.syncMode === 'full'

  // 目标根目录下的文件（平铺模式只比较根目录文件），键为小写文件名
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

  // 源文件按文件名分组（小写键，Windows 文件名不区分大小写）
  const groups = new Map<string, FsEntry[]>()
  for (const f of src.files) {
    const base = f.relPath.split(/[\\/]/).pop() as string
    const key = base.toLowerCase()
    const arr = groups.get(key)
    if (arr) {
      arr.push(f)
    } else {
      groups.set(key, [f])
    }
  }

  const plannedNames = new Set<string>() // 本次计划占用的目标名（小写）
  const keptNames = new Set<string>() // 完全同步下"已一致"而保留的目标名（小写）

  for (const key of [...groups.keys()].sort()) {
    const files = groups.get(key)!.sort(byRelPath)
    const base = files[0].relPath.split(/[\\/]/).pop() as string

    // 源内同名同大小视为同一文件：每个大小只取路径序首个为代表，其余不再复制
    const reps: FsEntry[] = []
    const seenSizes = new Set<number>()
    for (const f of files) {
      if (!seenSizes.has(f.size)) {
        seenSizes.add(f.size)
        reps.push(f)
      }
    }

    // 原始名归属：目标已有同名且其大小存在于源中 → 该大小沿用原名；
    // 目标无同名文件，或完全同步（可覆盖）→ 首个大小用原名；
    // 否则（增量且目标同名文件大小不在源中）→ 不占用原名，避免覆盖目标已有文件
    const t = tgtRootFiles.get(key)
    const plainSize = t && seenSizes.has(t.size) ? t.size : !t || full ? reps[0].size : null

    for (const rep of reps) {
      // 已同步判定 1：目标根目录存在同名同大小文件
      if (t && t.size === rep.size) {
        keptNames.add(key)
        continue
      }
      // 已同步判定 2：目标根目录存在"名称(大小)"文件（此前以冲突名同步过）
      const suffixed = withSizeSuffix(base, rep.size)
      const suffixedLc = suffixed.toLowerCase()
      const ts = tgtRootFiles.get(suffixedLc)
      if (!plannedNames.has(suffixedLc) && ts && ts.size === rep.size) {
        keptNames.add(suffixedLc)
        continue
      }

      // 需要复制：确定目标名；增量下不与目标根中现有文件重名（防覆盖）
      let name = rep.size === plainSize ? base : suffixed
      const blocked = (candidate: string): boolean =>
        plannedNames.has(candidate) || (!full && tgtRootFiles.has(candidate))
      if (blocked(name.toLowerCase())) {
        let k = 1
        do {
          name = withIndexSuffix(name, k)
          k += 1
        } while (blocked(name.toLowerCase()))
        warnings.push(`平铺重命名：${rep.relPath} → ${name}`)
      }
      plannedNames.add(name.toLowerCase())
      copy.push(mkCopy(rep, name, targetDir, full && tgtRootFiles.has(name.toLowerCase())))
    }
  }

  // 完全同步：目标根目录下既不属计划写入、也非已一致保留的文件视为多余删除
  if (full) {
    for (const tf of tgtRootFiles.values()) {
      const lc = tf.relPath.toLowerCase()
      if (!plannedNames.has(lc) && !keptNames.has(lc)) {
        del.push({
          targetPath: tf.absPath,
          targetRelPath: tf.relPath,
          isDirectory: false,
          reason: 'extra'
        })
      }
    }
  }
}
