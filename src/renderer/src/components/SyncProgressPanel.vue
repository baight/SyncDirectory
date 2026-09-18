<script setup lang="ts">
import type { SyncProgress, SyncResult } from '@shared/sync-types'

defineProps<{
  syncing: boolean
  progress: SyncProgress
  result: SyncResult | null
}>()

const emit = defineEmits<{
  cancel: []
}>()

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)} 秒`
  const m = Math.floor(s / 60)
  return `${m} 分 ${Math.round(s - m * 60)} 秒`
}
</script>

<template>
  <el-card v-if="syncing" shadow="never" class="panel">
    <template #header><span class="title">正在同步…</span></template>
    <el-progress
      :percentage="progress.total ? Math.round((progress.current / progress.total) * 100) : 0"
      :stroke-width="14"
    />
    <div class="progress-info">
      {{ progress.phase === 'copying' ? '复制中' : '删除中' }}：{{ progress.current }} /
      {{ progress.total }}
    </div>
    <div class="progress-path">{{ progress.currentPath }}</div>
    <el-button type="warning" plain @click="emit('cancel')">取消同步</el-button>
  </el-card>

  <el-card v-else-if="result" shadow="never" class="panel">
    <template #header><span class="title">同步结果</span></template>

    <el-result
      v-if="result.canceled"
      icon="warning"
      title="已取消"
      :sub-title="`本次已复制 ${result.copiedCount} 个文件，删除 ${result.deletedCount} 项，耗时 ${formatDuration(result.durationMs)}`"
    />
    <el-result
      v-else-if="result.errors.length > 0"
      icon="error"
      title="同步完成（部分失败）"
      :sub-title="`复制 ${result.copiedCount} 个文件，删除 ${result.deletedCount} 项，失败 ${result.errors.length} 项，耗时 ${formatDuration(result.durationMs)}`"
    />
    <el-result
      v-else
      icon="success"
      title="同步完成"
      :sub-title="`复制 ${result.copiedCount} 个文件，删除 ${result.deletedCount} 项，耗时 ${formatDuration(result.durationMs)}`"
    />

    <el-alert
      v-for="(w, i) in result.warnings.slice(0, 5)"
      :key="`w${i}`"
      :title="w"
      type="warning"
      :closable="false"
      class="alert"
    />

    <el-collapse v-if="result.skipped.length > 0 || result.errors.length > 0">
      <el-collapse-item
        v-if="result.skipped.length > 0"
        :title="`跳过的文件 (${result.skipped.length})`"
      >
        <div v-for="(s, i) in result.skipped" :key="i" class="row">
          {{ s.sourceRelPath }}（源 {{ s.sourceSize }} B / 目标 {{ s.targetSize }} B，
          {{ s.reason === 'size-mismatch' ? '大小不同，未覆盖' : '类型冲突' }}）
        </div>
      </el-collapse-item>
      <el-collapse-item v-if="result.errors.length > 0" :title="`失败项 (${result.errors.length})`">
        <div v-for="(e, i) in result.errors" :key="i" class="row error">
          {{ e.path }}：{{ e.message }}
        </div>
      </el-collapse-item>
    </el-collapse>
  </el-card>
</template>

<style scoped>
.title {
  font-weight: 600;
}

.progress-info {
  margin: 12px 0 4px;
  font-size: 13px;
  color: #606266;
}

.progress-path {
  margin-bottom: 12px;
  font-size: 12px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alert {
  margin-bottom: 8px;
}

.row {
  font-size: 12px;
  color: #606266;
  padding: 2px 0;
  word-break: break-all;
}

.row.error {
  color: #f56c6c;
}
</style>
