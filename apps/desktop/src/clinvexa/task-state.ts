export type CLINVEXATaskSurface = 'floating-ball' | 'sidebar' | 'workbench'
export type CLINVEXATaskStatus = 'completed' | 'failed' | 'pending' | 'running'

export interface CLINVEXATask {
  correlationId: string
  id: string
  input: string
  status: CLINVEXATaskStatus
  surfaces: CLINVEXATaskSurface[]
}

export interface CLINVEXATaskSubmission {
  correlationId: string
  input: string
  surface: CLINVEXATaskSurface
}

export interface CLINVEXATaskStoreState {
  snapshot: () => CLINVEXATask[]
  submit: (submission: CLINVEXATaskSubmission) => CLINVEXATask
  update: (taskId: string, status: CLINVEXATaskStatus) => void
}

/** Create the single task authority shared by every CLINVEXA desktop surface. */
export function createCLINVEXATaskStore(): CLINVEXATaskStoreState {
  const tasks = new Map<string, CLINVEXATask>()
  const idsByCorrelation = new Map<string, string>()
  let sequence = 0

  return {
    snapshot: () => Array.from(tasks.values()),
    submit(submission) {
      const existingId = idsByCorrelation.get(submission.correlationId)
      const existing = existingId ? tasks.get(existingId) : undefined

      if (existing) {
        if (!existing.surfaces.includes(submission.surface)) {
          existing.surfaces.push(submission.surface)
        }

        return existing
      }

      sequence += 1

      const task: CLINVEXATask = {
        correlationId: submission.correlationId,
        id: `clinvexa-task-${sequence}`,
        input: submission.input,
        status: 'pending',
        surfaces: [submission.surface]
      }

      tasks.set(task.id, task)
      idsByCorrelation.set(task.correlationId, task.id)

      return task
    },
    update(taskId, status) {
      const task = tasks.get(taskId)

      if (task) {
        task.status = status
      }
    }
  }
}

export const CLINVEXATaskStore = createCLINVEXATaskStore()
