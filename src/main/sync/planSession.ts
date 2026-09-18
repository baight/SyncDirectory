import { randomUUID } from 'crypto'
import type { SyncPlan } from '@shared/sync-types'

/** 同步计划会话：预览生成的计划暂存在主进程，确认执行时按 planId 一次性取出 */
export class PlanSessionStore {
  #sessions = new Map<string, SyncPlan>()
  static readonly MAX_SESSIONS = 10

  /** 暂存计划草稿，分配 planId 后返回完整计划 */
  create(draft: Omit<SyncPlan, 'planId'>): SyncPlan {
    if (this.#sessions.size >= PlanSessionStore.MAX_SESSIONS) {
      // 防止反复生成预览导致内存增长，淘汰最早的一个
      const oldest = this.#sessions.keys().next().value
      if (oldest !== undefined) {
        this.#sessions.delete(oldest)
      }
    }
    const plan: SyncPlan = { ...draft, planId: randomUUID() }
    this.#sessions.set(plan.planId, plan)
    return plan
  }

  /** 取出并移除（一次性，防重放） */
  take(planId: string): SyncPlan | undefined {
    const plan = this.#sessions.get(planId)
    this.#sessions.delete(planId)
    return plan
  }
}
