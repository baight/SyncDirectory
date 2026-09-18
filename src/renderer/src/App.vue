<script setup lang="ts">
import { onMounted } from 'vue'
import { ElMessageBox } from 'element-plus'
import SyncConfigList from './components/SyncConfigList.vue'
import SyncSettingsForm from './components/SyncSettingsForm.vue'
import PlanPreviewPanel from './components/PlanPreviewPanel.vue'
import SyncProgressPanel from './components/SyncProgressPanel.vue'
import { useSync } from './composables/useSync'

const {
  configs,
  selectedId,
  form,
  plan,
  planning,
  canStart,
  syncing,
  progress,
  result,
  saving,
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
} = useSync()

onMounted(() => {
  refreshConfigs()
  restoreRunningJob()
})

async function handleDeleteConfig(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm('确定要删除这条配置吗？', '删除确认', { type: 'warning' })
  } catch {
    return
  }
  deleteConfig(id)
}
</script>

<template>
  <el-container class="layout">
    <el-aside width="320px" class="aside">
      <SyncConfigList
        :configs="configs"
        :selected-id="selectedId"
        :saving="saving"
        @select="applyConfig"
        @delete="handleDeleteConfig"
        @save="saveConfig"
        @rename="renameConfig"
      />
    </el-aside>

    <el-main class="main">
      <SyncSettingsForm
        :form="form"
        :planning="planning"
        :syncing="syncing"
        :can-start="canStart"
        @pick="pickDirectory"
        @generate="generatePlan"
        @start="startSync"
      />
      <SyncProgressPanel
        :syncing="syncing"
        :progress="progress"
        :result="result"
        @cancel="cancelSync"
      />
      <PlanPreviewPanel :plan="plan" />
    </el-main>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100vh;
}

.aside {
  padding: 12px;
  border-right: 1px solid #e4e7ed;
  background-color: #fff;
  overflow-y: auto;
}

.main {
  padding: 12px 16px;
  overflow-y: auto;
}

.main > .el-card + .el-card {
  margin-top: 12px;
}
</style>
