<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { Delete, DocumentChecked, Edit } from '@element-plus/icons-vue'
import type { InputInstance } from 'element-plus'
import type { SyncConfigItem } from '@shared/sync-types'

const props = defineProps<{
  configs: SyncConfigItem[]
  selectedId: string
  saving: boolean
}>()

const emit = defineEmits<{
  select: [item: SyncConfigItem]
  delete: [id: string]
  save: []
  rename: [id: string, name: string]
}>()

const editingId = ref('')
const editingName = ref('')
const renameInput = ref<InputInstance | null>(null)

function setRenameInput(el: unknown): void {
  renameInput.value = el as InputInstance | null
}

/** 点击编辑图标：进入标题编辑 */
function startRename(item: SyncConfigItem): void {
  editingId.value = item.id
  editingName.value = item.name
  nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

function commitRename(): void {
  const id = editingId.value
  if (!id) return
  editingId.value = ''
  const name = editingName.value.trim()
  const item = props.configs.find((c) => c.id === id)
  if (name && item && name !== item.name) {
    emit('rename', id, name)
  }
}

/** 模式摘要，纯文本显示 */
function modeText(item: SyncConfigItem): string {
  const parts = [
    item.syncMode === 'full' ? '完全同步' : '增量同步',
    item.layoutMode === 'flat' ? '平铺' : '原始结构'
  ]
  if (item.useTrash) {
    parts.push('回收站')
  }
  return parts.join(' · ')
}
</script>

<template>
  <el-card class="config-list" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="title">同步配置</span>
        <el-button
          :icon="DocumentChecked"
          size="small"
          type="primary"
          plain
          :loading="saving"
          @click="emit('save')"
        >
          保存当前配置
        </el-button>
      </div>
    </template>

    <el-empty
      v-if="configs.length === 0"
      description="暂无配置，请在右侧设置目录后点击“保存当前配置”"
      :image-size="72"
    />

    <div
      v-for="item in configs"
      :key="item.id"
      class="config-item"
      :class="{ active: item.id === selectedId }"
    >
      <div class="config-name">
        <el-input
          v-if="editingId === item.id"
          :ref="setRenameInput"
          v-model="editingName"
          class="name-input"
          size="small"
          @keydown.enter="commitRename"
          @keydown.esc="editingId = ''"
          @blur="commitRename"
        />
        <template v-else>
          <span class="name-text" :title="item.name">{{ item.name }}</span>
          <el-button class="edit-btn" :icon="Edit" size="small" text @click="startRename(item)" />
        </template>
      </div>
      <div class="config-path">{{ item.sourceDir }}</div>
      <div class="config-path">→ {{ item.targetDir }}</div>
      <div class="config-modes">{{ modeText(item) }}</div>
      <div class="item-foot">
        <el-button size="small" text type="danger" :icon="Delete" @click="emit('delete', item.id)">
          删除
        </el-button>
        <el-button size="small" type="primary" plain @click="emit('select', item)">加载</el-button>
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.title {
  font-weight: 600;
}

.config-item {
  padding: 10px 12px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  margin-bottom: 10px;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.config-item:hover {
  border-color: #409eff;
}

.config-item.active {
  border-color: #409eff;
  background-color: #ecf5ff;
}

.config-name {
  display: flex;
  align-items: center;
  min-width: 0;
}

.name-input {
  flex: 1;
  min-width: 0;
}

.name-text {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-btn {
  color: #909399;
}

.config-path {
  font-size: 12px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-modes {
  font-size: 12px;
  color: #909399;
  margin-top: 6px;
}

.item-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
