<script setup lang="ts">
import { Folder, QuestionFilled } from '@element-plus/icons-vue'
import type { LayoutMode, SyncMode } from '@shared/sync-types'
import type { SyncForm } from '../composables/useSync'

const props = defineProps<{
  form: SyncForm
  planning: boolean
  syncing: boolean
  canStart: boolean
}>()

const emit = defineEmits<{
  pick: [field: 'sourceDir' | 'targetDir']
  generate: []
  start: []
}>()

function setField<K extends keyof SyncForm>(key: K, value: SyncForm[K]): void {
  // form 是父组件 useSync() 返回的同一 reactive 对象，此处按字段写回
  // eslint-disable-next-line vue/no-mutating-props
  props.form[key] = value
}
</script>

<template>
  <el-card shadow="never">
    <template #header><span class="title">同步设置</span></template>

    <el-form label-position="left" label-width="auto" @submit.prevent>
      <el-form-item>
        <template #label>
          <span class="label-tip">
            源目录：
            <el-tooltip placement="top" :show-after="150">
              <template #content>
                <div class="tooltip-wrap">同步的来源目录，从这个目录读取文件</div>
              </template>
              <el-icon class="tip-icon"><QuestionFilled /></el-icon>
            </el-tooltip>
          </span>
        </template>
        <div class="dir-row">
          <el-input :model-value="form.sourceDir" placeholder="选择要同步的源目录" readonly />
          <el-button :icon="Folder" :disabled="syncing" @click="emit('pick', 'sourceDir')">
            浏览
          </el-button>
        </div>
      </el-form-item>

      <el-form-item>
        <template #label>
          <span class="label-tip">
            目标目录：
            <el-tooltip placement="top" :show-after="150">
              <template #content>
                <div class="tooltip-wrap">同步的目的地目录，文件会写入这个目录</div>
              </template>
              <el-icon class="tip-icon"><QuestionFilled /></el-icon>
            </el-tooltip>
          </span>
        </template>
        <div class="dir-row">
          <el-input :model-value="form.targetDir" placeholder="选择同步到的目标目录" readonly />
          <el-button :icon="Folder" :disabled="syncing" @click="emit('pick', 'targetDir')">
            浏览
          </el-button>
        </div>
      </el-form-item>

      <el-row :gutter="16">
        <el-col :span="8">
          <el-form-item>
            <template #label>
              <span class="label-tip">
                同步模式：
                <el-tooltip placement="top" :show-after="150">
                  <template #content>
                    <div class="tooltip-wrap">
                      增量同步：只把目标目录缺少的文件复制过去，不删除不覆盖；完全同步：复制缺少的文件，并删除目标中多余的文件，使源与目标完全一致
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-radio-group
              :model-value="form.syncMode"
              :disabled="syncing"
              @update:model-value="(v) => setField('syncMode', v as SyncMode)"
            >
              <el-radio-button value="incremental">增量同步</el-radio-button>
              <el-radio-button value="full">完全同步</el-radio-button>
            </el-radio-group>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item>
            <template #label>
              <span class="label-tip">
                目录结构：
                <el-tooltip placement="top" :show-after="150">
                  <template #content>
                    <div class="tooltip-wrap">
                      原始结构：按源目录的层级结构保存到目标目录；平铺：忽略层级，所有文件直接放到目标根目录
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-radio-group
              :model-value="form.layoutMode"
              :disabled="syncing"
              @update:model-value="(v) => setField('layoutMode', v as LayoutMode)"
            >
              <el-radio-button value="original">原始结构</el-radio-button>
              <el-radio-button value="flat">平铺</el-radio-button>
            </el-radio-group>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item>
            <el-checkbox
              :model-value="form.useTrash"
              :disabled="syncing"
              @update:model-value="(v) => setField('useTrash', Boolean(v))"
            >
              删除文件时移入回收站（更安全，速度较慢）
            </el-checkbox>
          </el-form-item>
        </el-col>
      </el-row>

      <div class="actions">
        <el-button type="primary" :loading="planning" :disabled="syncing" @click="emit('generate')">
          生成同步预览
        </el-button>
        <el-button type="success" :disabled="!canStart || syncing" @click="emit('start')">
          开始同步
        </el-button>
      </div>
    </el-form>
  </el-card>
</template>

<style scoped>
.title {
  font-weight: 600;
}

.label-tip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.tip-icon {
  color: #909399;
  cursor: help;
  font-size: 14px;
}

.dir-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.actions {
  margin-top: 16px;
}
</style>
