import { type FormEvent, useState } from 'react'

import { confirmRpaTask, prepareRpaTask, type RpaRunResponse } from './api'

interface CLINVEXARpaProps {
  onClose: () => void
}

const STATE_LABELS: Record<RpaRunResponse['state'], string> = {
  awaiting_confirmation: '等待医生确认',
  stopped: '已安全停止',
  submitted: '已正式提交'
}

/** Render the compact, confirmation-gated HIS RPA panel. */
export function CLINVEXARpa({ onClose }: CLINVEXARpaProps) {
  const [taskId, setTaskId] = useState('')
  const [patientId, setPatientId] = useState('')
  const [windowId, setWindowId] = useState('')
  const [fieldName, setFieldName] = useState('chief_complaint')
  const [fieldValue, setFieldValue] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [run, setRun] = useState<RpaRunResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const prepare = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      setRun(
        await prepareRpaTask({
          expected_patient_id: patientId.trim(),
          expected_window_id: windowId.trim(),
          fields: { [fieldName.trim()]: fieldValue },
          task_id: taskId.trim()
        })
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (): Promise<void> => {
    if (!run || !doctorId.trim()) {return}
    setBusy(true)
    setError(null)

    try {
      setRun(
        await confirmRpaTask(run.task_id, {
          doctor_id: doctorId.trim(),
          patient_id: patientId.trim(),
          window_id: windowId.trim()
        })
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const canPrepare = [taskId, patientId, windowId, fieldName, fieldValue].every(value => value.trim())

  return (
    <main aria-label="CLINVEXA HIS RPA" className="p-5 text-(--ui-text-primary)">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">HIS RPA</h2>
          <p className="text-xs text-(--ui-text-secondary)">自动填写草稿，正式提交前必须医生确认</p>
        </div>
        <button className="min-h-11 rounded-lg px-3 text-sm" onClick={onClose} type="button">
          关闭
        </button>
      </header>

      <details className="mb-4 border-y border-(--ui-stroke-primary) py-3 text-xs">
        <summary className="cursor-pointer font-medium">HIS RPA 使用说明</summary>
        <div className="mt-3 space-y-3 text-(--ui-text-secondary)">
          <section>
            <h3 className="font-medium text-(--ui-text-primary)">使用流程</h3>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>打开目标 HIS 患者页面并核对患者编号。</li>
              <li>填写任务编号、患者编号、窗口标识、字段名和草稿内容。</li>
              <li>点击“准备 HIS 草稿”，系统定位窗口并填写字段。</li>
              <li>核对草稿与患者信息，输入医生编号后确认提交。</li>
            </ol>
          </section>
          <section>
            <h3 className="font-medium text-(--ui-text-primary)">使用场景</h3>
            <p className="mt-1">适用于主诉、病史、随访记录等重复录入，以及已审核文书草稿写回测试环境。</p>
          </section>
          <section>
            <h3 className="font-medium text-(--ui-text-primary)">具备功能</h3>
            <p className="mt-1">患者与窗口核验、UIA 控件定位、字段填写、截图留证、异常停止、医生确认和操作记录。</p>
          </section>
        </div>
      </details>

      <form className="grid gap-3" onSubmit={event => void prepare(event)}>
        <label className="grid gap-1 text-xs">
          任务编号
          <input
            className="min-h-11 rounded-lg border bg-(--ui-bg-input) px-3"
            onChange={event => setTaskId(event.target.value)}
            value={taskId}
          />
        </label>
        <label className="grid gap-1 text-xs">
          患者编号
          <input
            className="min-h-11 rounded-lg border bg-(--ui-bg-input) px-3"
            onChange={event => setPatientId(event.target.value)}
            value={patientId}
          />
        </label>
        <label className="grid gap-1 text-xs">
          HIS 窗口标识
          <input
            className="min-h-11 rounded-lg border bg-(--ui-bg-input) px-3"
            onChange={event => setWindowId(event.target.value)}
            value={windowId}
          />
        </label>
        <label className="grid gap-1 text-xs">
          字段名
          <input
            className="min-h-11 rounded-lg border bg-(--ui-bg-input) px-3"
            onChange={event => setFieldName(event.target.value)}
            value={fieldName}
          />
        </label>
        <label className="grid gap-1 text-xs">
          草稿内容
          <textarea
            className="min-h-24 rounded-lg border bg-(--ui-bg-input) p-3"
            onChange={event => setFieldValue(event.target.value)}
            value={fieldValue}
          />
        </label>
        <button
          className="min-h-11 rounded-lg bg-(--ui-accent) px-3 text-sm text-white disabled:opacity-45"
          disabled={!canPrepare || busy}
          type="submit"
        >
          准备 HIS 草稿
        </button>
      </form>

      {run && (
        <section aria-live="polite" className="mt-4 rounded-xl border border-(--ui-stroke-primary) p-4">
          <p className="text-sm font-medium">{STATE_LABELS[run.state]}</p>
          <p className="mt-1 text-xs text-(--ui-text-secondary)">任务：{run.task_id}</p>
          {run.failure_reason && <p className="mt-2 text-sm text-(--ui-danger)">{run.failure_reason}</p>}
          {run.state === 'awaiting_confirmation' && (
            <div className="mt-3 grid gap-2">
              <label className="grid gap-1 text-xs">
                确认医生编号
                <input
                  className="min-h-11 rounded-lg border bg-(--ui-bg-input) px-3"
                  onChange={event => setDoctorId(event.target.value)}
                  value={doctorId}
                />
              </label>
              <button
                className="min-h-11 rounded-lg bg-(--ui-danger) px-3 text-sm text-white disabled:opacity-45"
                disabled={!doctorId.trim() || busy}
                onClick={() => void confirm()}
                type="button"
              >
                确认并正式提交
              </button>
            </div>
          )}
        </section>
      )}
      {error && <p className="mt-4 rounded-lg border border-(--ui-danger) p-3 text-sm text-(--ui-danger)">{error}</p>}
    </main>
  )
}
