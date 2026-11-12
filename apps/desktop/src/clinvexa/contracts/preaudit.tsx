import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import {
  type DecisionStatus, exportReviewOriginal, exportReviewReport, generateReviewReport,
  loadPreaudit, loadPreaudits, loadReviewReport, loadReviewReports, type ReviewDecision, type ReviewDocument,
  type ReviewEvidence, type ReviewFinding, type ReviewJob, type ReviewJobSummary, type ReviewReport,
  type ReviewReportSummary, saveReviewDecision, startPreaudit
} from './api'

const states: Record<string, string> = {
  running: '运行中', completed: '执行完成', partial: '部分完成', failed: '失败', complete: '已执行',
  skipped: '本次未启用', not_applicable: '不适用', not_checked: '未检查', unavailable: '不可用',
  timeout: '超时', invalid: '输出校验失败', interrupted: '中断', empty: '空文档', ocr_required: '需 OCR'
}
const scopes: Record<string, string> = {
  rules: '规则执行', model: '模型辅助', contract_text: '合同正文',
  procurement_tender: '招标项目编号', procurement_response: '响应项目编号',
  procurement_award: '中标项目编号、相对方及适用的金额'
}
const levels = { blocking: '高风险', warning: '待核对', advice: '建议' }
const decisions: Record<DecisionStatus, string> = {
  pending: '待复核', accepted: '确认问题', dismissed: '驳回误报', needs_evidence: '需要补充材料'
}
const documentKinds = { contract: '合同正文', tender: '招标文件', response: '响应文件', award: '中标通知书' }
const fieldLabels: Record<string, string> = {
  hospital_party: '院方主体', counterparty: '相对方', project_number: '项目编号', amount: '金额（元）',
  amount_direction: '金额方向', amount_fixed: '是否确定金额', funding_source: '资金来源', contract_type: '合同类型',
  starts_on: '履行开始日期', ends_on: '履行结束日期'
}
const fieldValues: Record<string, string> = {
  income: '收入', expense: '支出', none: '不涉及金额', True: '是', False: '否',
  business: '业务合同', purchase: '货物采购合同', service: '服务合同'
}
const reliability: Record<string, string> = {
  source: '文件文本', saved_text: '保存的正文', unverified_excerpt: '未核验摘录', ocr_unverified: 'OCR 待核验'
}
const timestamp = (value: string) => new Date(value).toLocaleString()

function location(anchor: string) {
  const [kind, number] = anchor.split(':')
  const units: Record<string, string> = { page: '页', paragraph: '段', line: '行' }
  return units[kind] ? `第 ${number} ${units[kind]}` : anchor
}

function Evidence({ item, documents }: {item: ReviewEvidence; documents: ReviewDocument[]}) {
  const [expanded, setExpanded] = useState(false)
  const document = documents.find(doc => doc.id === item.document_id)
  const segment = document?.segments.find(entry => entry.anchor === item.anchor)
  const position = location(item.anchor)
  if (!document || !segment) {
    return <blockquote>{item.document_name} · {position}<br />{item.quote}</blockquote>
  }

  // API offsets count Unicode code points. Slice after converting from UTF-16.
  const points = expanded ? Array.from(document.text) : []
  const from = Math.max(segment.start, item.start - 160)
  const to = Math.min(segment.end, item.end + 160)
  return (
    <details onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>{item.document_name} · {position} · {reliability[item.reliability] ?? item.reliability}</summary>
      {expanded && <blockquote className="contract-evidence">
        {from > segment.start ? '…' : ''}{points.slice(from, item.start).join('')}
        <mark>{item.quote}</mark>
        {points.slice(item.end, to).join('')}{to < segment.end ? '…' : ''}
      </blockquote>}
    </details>
  )
}

function FindingContent({ item, documents }: {item: ReviewFinding; documents: ReviewDocument[]}) {
  return (
    <>
      <strong>{levels[item.level]} · {item.issue}</strong>
      <small>{item.origin === 'rule' ? '规则发现' : '模型建议'} · {item.rule_id} / {item.rule_version} · {scopes[item.scope] ?? '合同正文'}</small>
      <span>{item.suggestion}</span>
      {item.evidence.length === 0 && <small>缺项或证据不足，无可引用原文。</small>}
      {item.evidence.map(cite => <Evidence documents={documents} item={cite} key={cite.document_id + ':' + cite.start} />)}
      {item.model_suggestions?.map((candidate, index) => <div key={index}>
        <small>模型建议 · {levels[candidate.level]}</small>
        <span>{candidate.suggestion}</span>
        {candidate.evidence.map(cite => <Evidence documents={documents} item={cite} key={cite.document_id + ':' + cite.start} />)}
      </div>)}
    </>
  )
}

function DecisionHistory({ history }: {history: ReviewDecision[]}) {
  const latest = history.at(-1)
  return (
    <>
      <small>复核状态 · {decisions[latest?.status ?? 'pending']}{latest ? ' · ' + latest.reviewer : ''}</small>
      {history.length > 0 && <details>
        <summary>复核记录（{history.length}）</summary>
        <ul>{history.map((item, index) => <li key={index}>
          {decisions[item.status]} · {item.reviewer}（{item.identity_source ? '本机服务账号' : '历史本机登记'}） · {timestamp(item.at)}{item.note && ' · ' + item.note}
        </li>)}</ul>
      </details>}
    </>
  )
}

function DecisionEditor({ latest, disabled, onSave }: {
  latest?: ReviewDecision
  disabled: boolean
  onSave: (decision: Pick<ReviewDecision, 'status' | 'note'>) => void
}) {
  const [status, setStatus] = useState<DecisionStatus>(latest?.status ?? 'pending')
  const [note, setNote] = useState(latest?.note ?? '')

  return (
    <form onSubmit={event => {
      event.preventDefault()
      onSave({ status, note })
    }}>
      <fieldset className="contract-fields" disabled={disabled}>
        <label>复核决定<select onChange={event => setStatus(event.currentTarget.value as DecisionStatus)} value={status}>
          {Object.entries(decisions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <small>复核记录使用本机服务账号</small>
        <label>复核备注<Textarea maxLength={1000} onChange={event => setNote(event.currentTarget.value)} rows={2} value={note} /></label>
        <Button type="submit" variant="outline">保存此项复核</Button>
      </fieldset>
    </form>
  )
}

interface PreauditProps {
  id: string
  revision: number
  dirty: boolean
  busy: boolean
  modelReady: boolean
  run: (label: string, action: () => Promise<void>) => Promise<void>
}

export function ContractPreaudit({ id, revision, dirty, busy, modelReady, run }: PreauditProps) {
  const [history, setHistory] = useState<ReviewJobSummary[] | null>(null)
  const [job, setJob] = useState<ReviewJob | null>(null)
  const [reports, setReports] = useState<ReviewReportSummary[]>([])
  const [report, setReport] = useState<ReviewReport | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
      try {
        const items = await loadPreaudits(id, signal)
        if (controller.signal.aborted) {return}
        setHistory(items)
      } catch (reason) {
        if (!controller.signal.aborted) {setLoadError(reason instanceof Error ? reason.message : String(reason))}
      }
    }
    void load()
    return () => controller.abort()
  }, [id])

  async function open(next: ReviewJob) {
    setJob(next)
    setReport(null)
    setReports([])
    setReports(await loadReviewReports(id, next.id))
  }

  function start(useModel: boolean) {
    void run(useModel ? '正在执行规则和院内模型预审' : '正在执行智能预审规则', async () => {
      const next = await startPreaudit(id, revision, useModel)
      await open(next)
      setHistory(await loadPreaudits(id))
    })
  }

  const displayed = report ?? job

  return (
    <section aria-label="智能合同预审" className="contract-section contract-preaudit">
      <h3>智能合同预审</h3>
      <div className="contract-actions">
        <Button disabled={busy || dirty || history === null && !loadError} onClick={() => start(false)}>创建规则审查任务</Button>
        {modelReady && <Button disabled={busy || dirty || history === null && !loadError} onClick={() => start(true)} variant="outline">创建规则与模型审查任务</Button>}
        <Button disabled={busy} onClick={() => void run('正在读取审查历史', async () => {
          setHistory(await loadPreaudits(id))
          setLoadError('')
          if (job) {await open(await loadPreaudit(id, job.id))}
        })} variant="outline">刷新审查历史</Button>
      </div>
      {dirty && <p>保存合同后可对新版本创建任务。</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {history === null && !loadError && <p role="status">正在读取审查历史…</p>}
      {history?.length === 0 && <p>暂无审查任务。</p>}
      {!!history?.length && <label>审查历史<select disabled={busy} onChange={event => {
        const selected = event.currentTarget.value
        if (selected) {void run('正在打开审查任务', async () => open(await loadPreaudit(id, selected)))}
      }} value={job?.id ?? ''}>
        <option disabled value="">选择任务</option>
        {history.map(item => <option key={item.id} value={item.id}>
          {timestamp(item.created_at)} · 合同 v{item.contract_revision} · {states[item.status]} · {item.id.slice(0, 8)}
        </option>)}
      </select></label>}
      {job && displayed && (
        <>
          <p><strong>{states[displayed.status]}</strong> · 合同 v{displayed.contract_revision} · 任务 {job.id}</p>
          {job.contract_revision !== revision && <p>此任务使用历史合同版本。</p>}
          <p>{displayed.rules.source} {displayed.rules.version}{displayed.model.name && ' · 模型 ' + displayed.model.name}</p>
          {displayed.error && <p role="status">{displayed.error}</p>}
          <ul className="contract-coverage">
            {Object.entries(displayed.coverage).map(([scope, state]) => <li key={scope}>{scopes[scope] ?? scope} · {states[state] ?? state}</li>)}
          </ul>
          <details>
            <summary>输入文件及版本</summary>
            <ul>{displayed.documents.map(document => (
              <li key={document.id}>
                <strong>{documentKinds[document.kind]} · {document.name}</strong>
                <p>{states[document.status]} · 解析器 v{document.parser_version} · {document.hash_basis === 'file' ? '文件' : '文本'} SHA256 <code>{document.sha256}</code></p>
                {document.diagnostics.map(message => <p key={message}>{message}</p>)}
                {document.hash_basis === 'file' && <Button disabled={busy} onClick={() => void run('正在下载任务原件', () => exportReviewOriginal(id, document))} variant="outline">下载原件</Button>}
              </li>
            ))}</ul>
          </details>
          {!!Object.keys(job.elements).length && !report && <details>
            <summary>提取的合同要素</summary>
            <ul>{Object.entries(job.elements).flatMap(([key, candidates]) => candidates.map(candidate => <li key={key + ':' + candidate.value}>
              {fieldLabels[key] ?? key} · {fieldValues[candidate.value] ?? candidate.value}
              <Evidence documents={job.documents} item={candidate.evidence} />
            </li>))}</ul>
          </details>}
          <div className="contract-actions">
            <Button disabled={busy || job.status === 'running'} onClick={() => void run('正在生成预审报告', async () => {
              setReport(await generateReviewReport(id, job.id))
              setReports(await loadReviewReports(id, job.id))
            })} variant="outline">生成并保存报告</Button>
            {!!reports.length && <label>已保存报告<select disabled={busy} onChange={event => {
              const selected = event.currentTarget.value
              if (selected) {void run('正在打开预审报告', async () => setReport(await loadReviewReport(id, job.id, selected)))}
              else {setReport(null)}
            }} value={report?.id ?? ''}>
              <option value="">当前任务结果</option>
              {reports.map(item => <option key={item.id} value={item.id}>{timestamp(item.generated_at)} · 复核版本 {item.decision_revision} · {item.id.slice(0, 8)}</option>)}
            </select></label>}
            {report && <Button disabled={busy} onClick={() => void run('正在导出预审报告', () => exportReviewReport(id, job.id, report.id))} variant="outline">导出报告 CSV</Button>}
          </div>
          {report && <div>
            <p>报告 {report.id} · 生成于 {timestamp(report.generated_at)}</p>
            <dl className="contract-report-info">
              <dt>合同名称</dt><dd>{report.contract.title}</dd>
              <dt>院方主体</dt><dd>{report.contract.hospital_party || '未填写'}</dd>
              <dt>合同相对方</dt><dd>{report.contract.counterparty || '未填写'}</dd>
              <dt>项目编号</dt><dd>{report.contract.project_number || '未填写'}</dd>
              <dt>金额方向</dt><dd>{fieldValues[report.contract.amount_direction ?? ''] ?? '未填写'}</dd>
              <dt>固定金额（元）</dt><dd>{report.contract.amount ?? '未填写或不适用'}</dd>
              <dt>资金来源</dt><dd>{report.contract.funding_source || '未填写'}</dd>
            </dl>
          </div>}
          {!displayed.findings.length && <p>{displayed.status === 'completed' ? '在本次已执行范围内未发现问题。' : '目前没有已保存的发现项。'}</p>}
          <ol className="contract-findings">
            {displayed.findings.map(item => {
              const audit = displayed.decisions[item.id] ?? []
              return <li data-level={item.level} key={item.id}>
                <FindingContent documents={job.documents} item={item} />
                <DecisionHistory history={audit} />
                {!report && (job.status === 'completed' || job.status === 'partial') && <details>
                  <summary>逐项复核</summary>
                  <DecisionEditor disabled={busy} key={audit.length} latest={audit.at(-1)} onSave={decision => {
                    void run('正在保存逐项复核', async () => setJob(
                      await saveReviewDecision(id, job.id, item.id, job.decision_revision, decision)
                    ))
                  }} />
                </details>}
              </li>
            })}
          </ol>
        </>
      )}
    </section>
  )
}
