<script setup lang="ts">
import { computed } from 'vue'
import type { SyncPlan } from '@shared/sync-types'

const props = defineProps<{
  plan: SyncPlan | null
}>()

const emit = defineEmits<{
  open: [path: string]
  reveal: [path: string]
}>()

const copyCount = computed(() => props.plan?.copy.length ?? 0)
const deleteCount = computed(() => props.plan?.delete.length ?? 0)
const skipCount = computed(() => props.plan?.skip.length ?? 0)
const overwriteCount = computed(() => props.plan?.copy.filter((c) => c.overwrite).length ?? 0)
const nothingToDo = computed(
  () => copyCount.value === 0 && deleteCount.value === 0 && skipCount.value === 0
)

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
</script>

<template>
  <el-card v-if="plan" class="preview-card" shadow="never">
    <template #header><span class="title">同步预览</span></template>

    <div class="summary">
      <el-tag type="success" size="large">
        待复制 {{ copyCount }} 个文件（{{ formatSize(plan.totalCopyBytes) }}）
      </el-tag>
      <el-tag v-if="overwriteCount" type="warning" size="large"
        >其中覆盖 {{ overwriteCount }} 个</el-tag
      >
      <el-tag :type="deleteCount ? 'danger' : 'info'" size="large"
        >待删除 {{ deleteCount }} 项</el-tag
      >
      <el-tag v-if="skipCount" type="info" size="large">跳过 {{ skipCount }} 个</el-tag>
    </div>

    <el-alert
      v-for="(w, i) in plan.warnings.slice(0, 5)"
      :key="i"
      :title="w"
      type="warning"
      :closable="false"
      class="warn"
    />
    <el-alert
      v-if="plan.warnings.length > 5"
      :title="`还有 ${plan.warnings.length - 5} 条提示未显示，详见同步结果`"
      type="info"
      :closable="false"
    />

    <el-empty
      v-if="nothingToDo"
      description="没有需要同步的文件，源与目标已一致"
      :image-size="72"
    />

    <el-tabs v-else class="preview-tabs">
      <el-tab-pane :label="`待复制 (${copyCount})`">
        <div class="table-fill">
          <el-table :data="plan.copy" height="100%" size="small">
            <el-table-column
              prop="targetRelPath"
              label="目标位置"
              min-width="200"
              show-overflow-tooltip
            />
            <el-table-column
              prop="sourceRelPath"
              label="来源"
              min-width="200"
              show-overflow-tooltip
            />
            <el-table-column label="大小" width="90">
              <template #default="{ row }">{{ formatSize(row.size) }}</template>
            </el-table-column>
            <el-table-column label="类型" width="80">
              <template #default="{ row }">
                <el-tag v-if="row.overwrite" type="warning" size="small">覆盖</el-tag>
                <el-tag v-else type="success" size="small">新增</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="emit('open', row.sourcePath)"
                  >打开</el-button
                >
                <el-button link type="primary" size="small" @click="emit('reveal', row.sourcePath)"
                  >文件夹</el-button
                >
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="`待删除 (${deleteCount})`">
        <el-alert
          v-if="deleteCount"
          title="以下内容将从目标目录中删除"
          type="error"
          :closable="false"
          class="warn"
        />
        <div class="table-fill">
          <el-table :data="plan.delete" height="100%" size="small" empty-text="无待删除项">
            <el-table-column
              prop="targetRelPath"
              label="路径"
              min-width="280"
              show-overflow-tooltip
            />
            <el-table-column label="类型" width="80">
              <template #default="{ row }">{{ row.isDirectory ? '目录' : '文件' }}</template>
            </el-table-column>
            <el-table-column label="原因" width="110">
              <template #default="{ row }">
                <el-tag size="small" :type="row.reason === 'extra' ? 'info' : 'danger'">
                  {{ row.reason === 'extra' ? '多余' : '类型冲突' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="emit('open', row.targetPath)"
                  >打开</el-button
                >
                <el-button link type="primary" size="small" @click="emit('reveal', row.targetPath)"
                  >文件夹</el-button
                >
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="skipCount" :label="`跳过 (${skipCount})`">
        <div class="table-fill">
          <el-table :data="plan.skip" height="100%" size="small">
            <el-table-column
              prop="sourceRelPath"
              label="源文件"
              min-width="200"
              show-overflow-tooltip
            />
            <el-table-column
              prop="targetRelPath"
              label="目标已有"
              min-width="200"
              show-overflow-tooltip
            />
            <el-table-column label="原因" width="130">
              <template #default="{ row }">
                <el-tag size="small" type="info">{{
                  row.reason === 'size-mismatch' ? '大小不同' : '类型冲突'
                }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="emit('open', row.sourcePath)"
                  >打开</el-button
                >
                <el-button link type="primary" size="small" @click="emit('reveal', row.sourcePath)"
                  >文件夹</el-button
                >
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>

<style scoped>
.preview-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.preview-card > :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.title {
  font-weight: 600;
}

.summary {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.warn {
  margin-bottom: 8px;
}

.preview-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.preview-tabs > :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
}

.preview-tabs > :deep(.el-tabs__content) .el-tab-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.table-fill {
  flex: 1;
  min-height: 0;
}
</style>
