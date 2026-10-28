import type { TaskInfo } from '@shared/types'
import { broadcast } from './broadcast'
import { errorMessage, id, throttle } from './util'

export interface TaskHandle {
  readonly id: string
  update(patch: { detail?: string | null; progress?: number | null; title?: string }): void
}

class Tasks {
  private tasks = new Map<string, TaskInfo>()

  private emit = throttle(() => broadcast('event:tasks', this.list()), 120)

  list(): TaskInfo[] {
    return [...this.tasks.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  dismiss(taskId: string): void {
    const t = this.tasks.get(taskId)
    if (t && t.state !== 'running') {
      this.tasks.delete(taskId)
      this.emit()
    }
  }

  /** Runs `work` as a tracked task; progress is reported to every window. */
  async run<T>(title: string, work: (task: TaskHandle) => Promise<T>): Promise<T> {
    const info: TaskInfo = {
      id: id(),
      title,
      detail: null,
      progress: null,
      state: 'running',
      error: null,
      startedAt: Date.now(),
      finishedAt: null
    }
    this.tasks.set(info.id, info)
    this.emit()
    const handle: TaskHandle = {
      id: info.id,
      update: (patch) => {
        Object.assign(info, patch)
        this.emit()
      }
    }
    try {
      const result = await work(handle)
      info.state = 'done'
      info.progress = 1
      info.detail = null
      return result
    } catch (err) {
      info.state = 'error'
      info.error = errorMessage(err)
      throw err
    } finally {
      info.finishedAt = Date.now()
      this.emit()
      // Finished tasks linger briefly so the UI can show the outcome.
      setTimeout(() => {
        if (this.tasks.get(info.id)?.state === 'done') {
          this.tasks.delete(info.id)
          this.emit()
        }
      }, 6000)
    }
  }
}

export const tasks = new Tasks()
