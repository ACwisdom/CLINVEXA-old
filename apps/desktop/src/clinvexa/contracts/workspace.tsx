import './workspace.css'

import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import {
  type AmountDirection, archiveContract, type Contract, type ContractIndex, createDemoContract, createDemoSeal, type Draft,
  exportContractLedger, exportContractPdf, exportRiskLedger, exportSealedCopy, extractContractFile,
  loadContract, loadContracts, type MaterialKind, type Outcome, recordApproval, registerSeal, rehearseSubmission,
  resolveSubmission, reviewContract, saveContract, saveLegalNote, statusLabels, submitContract, type TemplateId,
  uploadReviewDocument
} from './api'
import { ContractPreaudit } from './preaudit'
import { ContractVersions } from './versions'

const materialFields: Array<{kind: MaterialKind; label: string}> = [
  { kind: 'tender', label: '招标文件' },
  { kind: 'response', label: '响应文件' },
  { kind: 'award', label: '中标通知书' }
]

const riskLabels = { blocking: '阻断', warning: '待核对', advice: '建议' }

const rehearsalReasons: Record<string, string> = {
  not_reviewed: '当前版本尚未预审',
  high_risk_pending: '有未复核高风险',
  high_risk_confirmed: '有已确认高风险',
  needs_materials: '需要补充材料',
  review_incomplete: '预审覆盖不完整',
  model_incomplete: '模型审查未完成或未运行'
}

const modelLabels = { not_configured: '规则预审', pending: '规则预审 · AI 待补审', complete: '规则与院内模型预审' }
const checkLabels = { matched: '已识别正文一致', different: '检测到文本差异，已人工核对', manual: '扫描件已人工核对' }

function routeForDraft(draft: Draft) {
  if (!draft.procurement_required) {return '无需招采'}

  if (draft.amount_direction === 'none' || draft.amount_fixed === false) {return '待核对招采依据'}
  const amount = Number(draft.amount)

  if (draft.amount === null || !Number.isFinite(amount) || amount < 0) {return '待填写金额'}

  if (amount <= 100000) {return '院内备案'}

  return amount <= 300000 ? '询价或磋商' : '委外招标'
}

function ImportFile({ label, name, onImport }: {label: string; name?: string; onImport: (file: File) => void}) {
  return (
    <label className="contract-import">
      <span>{label}{name ? ` · ${name}` : ''}</span>
      <Input
        accept=".txt,.docx,.pdf"
        onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''

          if (file) {onImport(file)}
        }}
        type="file"
      />
    </label>
  )
}

export function ContractWorkspace() {
  const [index, setIndex] = useState<ContractIndex | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [record, setRecord] = useState<Contract | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [query, setQuery] = useState('')
  const [requestId, setRequestId] = useState('')
  const [outcome, setOutcome] = useState<Outcome>('submitted')
  const [receiptNote, setReceiptNote] = useState('')
  const [showSubmit, setShowSubmit] = useState(false)
  const [template, setTemplate] = useState<TemplateId>('business')
  const [legalNote, setLegalNote] = useState('')
  const [sealFile, setSealFile] = useState<File | null>(null)
  const [sealVerified, setSealVerified] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const running = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    loadContracts(AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]))
      .then(setIndex)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })

    return () => controller.abort()
  }, [])

  async function run(label: string, action: () => Promise<void>) {
    if (running.current) {return}
    running.current = true
    setBusy(label)
    setError('')
    setMessage('')

    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      running.current = false
      setBusy('')
    }
  }

  function applyRecord(next: Contract, updateIndex = true) {
    setActiveId(next.id)
    setRecord(next)
    setDraft(next.draft)
    setDirty(false)
    setShowSubmit(false)
    setRequestId(next.oa_request_id ?? '')
    setReceiptNote('')
    setOutcome('submitted')
    setLegalNote(next.legal_note ?? '')
    setSealFile(null)
    setSealVerified(false)

    if (updateIndex) {
      const item = {
        id: next.id, title: next.draft.title, counterparty: next.draft.counterparty,
        project_number: next.draft.project_number, amount: next.draft.amount,
        status: next.status, oa_request_id: next.oa_request_id,
        updated_at: next.events.at(-1)?.at ?? '', reminders: next.reminders ?? []
      }

      setIndex(current => current && { ...current, records: [item, ...current.records.filter(row => row.id !== next.id)] })
    }
  }

  function startDraft() {
    setActiveId(crypto.randomUUID())
    setRecord(null)
    setDraft({
      title: '', counterparty: '', project_number: '', amount: null, materials: {},
      body: index?.templates?.[template].body ?? index?.template ?? '',
      template_id: template, procurement_required: true, procurement_reference: '', starts_on: null, ends_on: null
    })
    setRequestId('')
    setShowSubmit(false)
    setMessage('')
    setError('')
    setDirty(true)
  }

  function changeDraft(patch: Partial<Draft>) {
    setDraft(current => current && { ...current, ...patch })
    setDirty(true)
    setShowSubmit(false)
  }

  function importFile(file: File, kind?: MaterialKind) {
    void run('正在读取文件', async () => {
      if (draft && activeId && index?.preaudit_ready) {
        if (!record) {
          const title = draft.title.trim() || (!kind ? file.name.replace(/\.[^.]+$/, '').slice(0, 200) : '')

          if (!title) {throw new Error('请先填写合同名称，再导入招采材料。')}
          applyRecord(await saveContract(activeId, 0, { ...draft, title }))
        }

        const documentKind = kind ?? 'contract'
        const { document, fields } = await uploadReviewDocument(activeId, documentKind, file)
        const preaudit_documents = { ...draft.preaudit_documents, [documentKind]: document.id }

        if (kind) {
          const materials = { ...draft.materials }

          if (document.text.trim()) {materials[kind] = { name: file.name, text: document.text }}
          else {delete materials[kind]}

          changeDraft({ preaudit_documents, materials })
        } else {
          const direction = fields.amount_direction as AmountDirection | undefined
          const amountDirection = draft.amount_direction ?? direction ?? null

          const amountFixed = amountDirection === 'none' ? null :
            draft.amount_fixed ?? (fields.amount_fixed === undefined ? null : fields.amount_fixed === 'True')

          changeDraft({
            preaudit_documents,
            title: draft.title.trim() || file.name.replace(/\.[^.]+$/, '').slice(0, 200),
            ...(document.text.trim() && {
              body: document.text,
              counterparty: draft.counterparty || fields.counterparty || '',
              project_number: draft.project_number || fields.project_number || '',
              amount: draft.amount ?? (amountDirection !== 'none' && amountFixed !== false ? fields.amount : undefined) ?? null,
              hospital_party: draft.hospital_party || fields.hospital_party || '',
              funding_source: draft.funding_source || fields.funding_source || '',
              contract_type: draft.contract_type ?? fields.contract_type as TemplateId | undefined,
              amount_direction: amountDirection,
              amount_fixed: amountFixed,
              starts_on: draft.starts_on ?? fields.starts_on ?? null,
              ends_on: draft.ends_on ?? fields.ends_on ?? null
            })
          })
        }

        setMessage(document.diagnostics.length
          ? `${file.name} · ${document.diagnostics.join('；')}。保存后可查看对应的审查范围。`
          : `已读取 ${file.name}，请核对提取内容后保存。`)

        return
      }

      const extracted = await extractContractFile(file)

      if (kind && draft) {
        changeDraft({ materials: { ...draft.materials, [kind]: { name: file.name, text: extracted.text } } })
      } else if (draft) {
        changeDraft({
          body: extracted.text,
          title: draft.title || file.name.replace(/\.[^.]+$/, ''),
          counterparty: draft.counterparty || extracted.fields.counterparty || '',
          project_number: draft.project_number || extracted.fields.project_number || '',
          amount: draft.amount ?? extracted.fields.amount ?? null
        })
      }

      setMessage(`已读取 ${file.name}，请核对提取的内容后保存`)
    })
  }

  function unlinkDocument(kind: keyof NonNullable<Draft['preaudit_documents']>) {
    if (!draft) {return}
    const preaudit_documents = { ...draft.preaudit_documents }
    delete preaudit_documents[kind]
    changeDraft({ preaudit_documents })
  }

  const editable = !record || ['draft', 'reviewed', 'rejected'].includes(record.status)
  const canReview = record && !dirty && (record.status === 'draft' || record.status === 'reviewed')

  const canSend = record?.status === 'reviewed' && !!record.review && !dirty &&
    !record.review.findings.some(item => item.level === 'blocking')

  const canRecordReceipt = record && !dirty && (canSend || ['submitted', 'sending', 'submission_unknown'].includes(record.status))
  const canClean = record && ['approved', 'sealed', 'archived'].includes(record.status)
  const canFollowup = record && index?.model_ready && !editable && record.review?.ai_status !== 'complete'
  const filter = query.trim().toLowerCase()

  const rows = index?.records.filter(row => [row.title, row.counterparty, row.project_number, row.oa_request_id, statusLabels[row.status]]
    .some(value => value?.toLowerCase().includes(filter))) ?? []

  return (
    <div aria-label="合同管理" className="contract-workspace">
      <header className="contract-page-heading">
        <div><h1>合同管理</h1>{index?.demo && <p className="contract-demo-banner">演示工作区 · 合同及 OA 回执均为合成数据</p>}</div>
        <div className="contract-actions">
          <Button disabled={!!busy || dirty} onClick={() => void run('正在刷新', async () => {
            setIndex(await loadContracts())

            if (activeId && record) {applyRecord(await loadContract(activeId), false)}
          })} variant="outline">刷新</Button>
          <Button disabled={!!busy || !index?.records.length} onClick={() => void run('正在导出', exportContractLedger)} variant="outline">导出台账</Button>
          <Button disabled={!!busy || !index?.records.length} onClick={() => void run('正在导出风险台账', exportRiskLedger)} variant="outline">风险台账</Button>
          {index?.demo && <Button disabled={!!busy || dirty} onClick={() => void run('正在创建演示合同', async () => {
            applyRecord(await createDemoContract())
          })} variant="outline">创建设备维保演示</Button>}
          {index?.templates && <label className="contract-template">起草模板<select disabled={!!busy || dirty} onChange={event => setTemplate(event.currentTarget.value as TemplateId)} value={template}>
            {Object.entries(index.templates).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
          </select></label>}
          <Button disabled={!!busy || !index || dirty} onClick={startDraft}>新建业务合同</Button>
        </div>
      </header>
      {error && <p className="contract-error" role="alert">{error}</p>}
      {(busy || message) && <p className="contract-feedback" role="status">{busy || message}</p>}
      <div className="contract-columns">
        <aside aria-label="合同台账" className="contract-ledger">
          <Input aria-label="搜索合同" onChange={event => setQuery(event.currentTarget.value)} placeholder="搜索名称、相对方、编号或状态" value={query} />
          {!index && !error && <p>正在读取合同台账…</p>}
          {index && rows.length === 0 && <p>{filter ? '没有匹配的合同' : '暂无合同'}</p>}
          <ul>
            {rows.map(row => (
              <li key={row.id}>
                <Button
                  aria-pressed={row.id === activeId}
                  className="contract-row"
                  disabled={!!busy || dirty}
                  onClick={() => void run('正在打开合同', async () => applyRecord(await loadContract(row.id), false))}
                  variant={row.id === activeId ? 'secondary' : 'ghost'}
                >
                  <span>{row.title}</span>
                  <small>{[statusLabels[row.status], row.counterparty, row.project_number].filter(Boolean).join(' · ')}</small>
                  {row.reminders?.length > 0 && <small className="contract-reminder">{row.reminders[0]}</small>}
                </Button>
              </li>
            ))}
          </ul>
        </aside>
        <section aria-label="合同详情" className="contract-detail">
          {!draft && index && <p>从台账打开合同，或新建一份业务合同。</p>}
          {draft && activeId && (
            <>
              <div className="contract-detail-heading">
                <h2>{record?.draft.title ?? '业务合同起草'}</h2>
                <span>{dirty ? '有未保存修改' : record && statusLabels[record.status]}</span>
              </div>
              {record?.reminders?.map(item => <p className="contract-reminder" key={item}>{item}</p>)}
              <fieldset disabled={!!busy || !editable}>
                <div className="contract-fields">
                  <label>合同名称<Input maxLength={200} onChange={event => changeDraft({ title: event.currentTarget.value })} value={draft.title} /></label>
                  <label>合同相对方<Input maxLength={200} onChange={event => changeDraft({ counterparty: event.currentTarget.value })} value={draft.counterparty} /></label>
                  <label>项目编号<Input maxLength={100} onChange={event => changeDraft({ project_number: event.currentTarget.value })} value={draft.project_number} /></label>
                  {index?.preaudit_ready && <>
                    <label>合同类型<select onChange={event => changeDraft({ contract_type: (event.currentTarget.value || null) as TemplateId | null })} value={draft.contract_type ?? ''}>
                      <option value="">请选择</option>
                      <option value="business">业务合同</option>
                      <option value="purchase">货物采购合同</option>
                      <option value="service">服务合同</option>
                    </select></label>
                    <label>院方主体<Input maxLength={200} onChange={event => changeDraft({ hospital_party: event.currentTarget.value })} value={draft.hospital_party ?? ''} /></label>
                    <label>金额方向<select onChange={event => {
                      const amount_direction = (event.currentTarget.value || null) as AmountDirection | null
                      changeDraft(amount_direction === 'none' ? { amount_direction, amount_fixed: null, amount: null } : { amount_direction })
                    }} value={draft.amount_direction ?? ''}>
                      <option value="">请选择</option>
                      <option value="income">收入</option>
                      <option value="expense">支出</option>
                      <option value="none">不涉及金额</option>
                    </select></label>
                    {draft.amount_direction && draft.amount_direction !== 'none' && <label>是否确定金额<select
                      onChange={event => {
                        const choice = event.currentTarget.value
                        changeDraft(choice === 'false' ? { amount_fixed: false, amount: null } : { amount_fixed: choice === 'true' ? true : null })
                      }} value={draft.amount_fixed == null ? '' : String(draft.amount_fixed)}>
                      <option value="">请选择</option>
                      <option value="true">是</option>
                      <option value="false">否</option>
                    </select></label>}
                    <label>资金来源<Input maxLength={200} onChange={event => changeDraft({ funding_source: event.currentTarget.value })} value={draft.funding_source ?? ''} /></label>
                  </>}
                  {(draft.amount_direction !== 'none' && draft.amount_fixed !== false) || draft.amount != null
                    ? <label>合同金额（元）<Input inputMode="decimal" maxLength={17} onChange={event => changeDraft({ amount: event.currentTarget.value || null })} value={draft.amount ?? ''} /></label> : null}
                  <label>履行开始日期<Input onChange={event => changeDraft({ starts_on: event.currentTarget.value || null })} type="date" value={draft.starts_on ?? ''} /></label>
                  <label>履行结束日期<Input onChange={event => changeDraft({ ends_on: event.currentTarget.value || null })} type="date" value={draft.ends_on ?? ''} /></label>
                </div>
                <div className="contract-section">
                  <h3>招采前置程序 · {routeForDraft(draft)}</h3>
                  <label className="contract-checkbox"><input checked={draft.procurement_required} onChange={event => changeDraft({ procurement_required: event.currentTarget.checked })} type="checkbox" />适用招采前置程序</label>
                  <label className="contract-body">{draft.procurement_required ? '前置审批编号' : '无需招采的依据'}<Input maxLength={250} onChange={event => changeDraft({ procurement_reference: event.currentTarget.value })} value={draft.procurement_reference} /></label>
                </div>
                {editable && <ImportFile label="导入合同正文" onImport={file => importFile(file)} />}
                {editable && draft.preaudit_documents?.contract && <Button onClick={() => unlinkDocument('contract')} variant="ghost">解除正文原件关联</Button>}
                {index?.locked_header && <p className="contract-locked">锁定段 · {index.locked_header}</p>}
                <label className="contract-body">合同正文<Textarea maxLength={200000} onChange={event => changeDraft({ body: event.currentTarget.value })} rows={12} value={draft.body} /></label>
                <section className="contract-section">
                  <h3>招采材料</h3>
                  {materialFields.map(({ kind, label }) => (
                    <div key={kind}>
                      <div className="contract-material">
                        {editable ? <ImportFile label={label} name={draft.materials[kind]?.name} onImport={file => importFile(file, kind)} /> : (
                          <span>{label} · {draft.materials[kind]?.name ?? '未导入'}</span>
                        )}
                        {editable && draft.preaudit_documents?.[kind] && <Button onClick={() => unlinkDocument(kind)} variant="ghost">解除{label}原件关联</Button>}
                      </div>
                      {(editable || draft.materials[kind]) && <details>
                        <summary>{editable ? `查看或录入${label}摘录` : `查看${label}摘录`}</summary>
                        <Textarea
                          aria-label={`${label}摘录`}
                          maxLength={200000}
                          onChange={event => {
                            const materials = { ...draft.materials }
                            const text = event.currentTarget.value

                            if (text.trim()) {materials[kind] = { name: materials[kind]?.name ?? `${label}（人工摘录）`, text }}
                            else {delete materials[kind]}

                            changeDraft({ materials })
                          }}
                          placeholder="扫描件可粘贴核对过的文字，例如项目编号、中标单位和中标金额"
                          rows={4}
                          value={draft.materials[kind]?.text ?? ''}
                        />
                      </details>}
                    </div>
                  ))}
                </section>
              </fieldset>
              <div className="contract-actions">
                {editable && <Button disabled={!!busy || !draft.title.trim() || !dirty} onClick={() => void run('正在保存', async () => {
                  applyRecord(await saveContract(activeId, record?.revision ?? 0, draft))
                  setMessage('已保存合同草稿')
                })}>保存草稿</Button>}
                {dirty && <Button disabled={!!busy} onClick={() => {
                  if (record) {applyRecord(record, false)}
                  else {setDraft(null); setActiveId(null); setDirty(false)}

                  setError('')
                  setMessage('')
                }} variant="ghost">放弃未保存修改</Button>}
                {canReview && <Button disabled={!!busy} onClick={() => void run('正在进行规则预审', async () => {
                  applyRecord(await reviewContract(activeId, record.revision, false))
                })} variant="outline">{index?.preaudit_ready ? '送审前规则检查' : '规则预审'}</Button>}
                {canReview && index?.model_ready && <Button disabled={!!busy} onClick={() => void run('院内模型预审中', async () => {
                  applyRecord(await reviewContract(activeId, record.revision, true))
                })} variant="outline">{index.preaudit_ready ? '送审前模型预审' : '用院内模型预审'}</Button>}
                {canFollowup && <Button disabled={!!busy} onClick={() => void run('院内模型补审中', async () => {
                  applyRecord(await reviewContract(activeId, record.revision, true))
                })} variant="outline">用院内模型补审</Button>}
                {record && index?.submission_rehearsal_ready && <Button disabled={!!busy || dirty}
                  onClick={() => void run('正在判断演练准入', async () => {
                    const result = await rehearseSubmission(record.id, record.revision)

                    const reasons = result.reasons.map(reason =>
                      (rehearsalReasons[reason] ?? reason) + (result.blocking.includes(reason) ? '（阻断）' : ''))

                    setMessage(['演练准入' + (result.allowed ? '通过' : '未通过'), ...reasons].join(' · '))
                  })} variant="outline">预审准入演练</Button>}
              </div>
              {record && index?.preaudit_ready && <ContractPreaudit
                busy={!!busy} dirty={dirty} id={record.id} key={record.id} modelReady={index.model_ready} revision={record.revision} run={run}
              />}
              {record?.review && !dirty && (
                <section className="contract-section">
                  <h3>{index?.preaudit_ready ? '送审前预审结果' : '预审结果'}</h3>
                  <p>{modelLabels[record.review.ai_status]}{!record.review.findings.length ? ' · 当前规则未发现问题' : ''}</p>
                  <ol className="contract-findings">
                    {record.review.findings.map((item, i) => (
                      <li data-level={item.level} key={i}><strong>{riskLabels[item.level]} · {item.issue}</strong><small>{item.source}</small><span>{item.suggestion}</span></li>
                    ))}
                  </ol>
                </section>
              )}
              {record && index?.legal && !dirty && record.review && (
                <section className="contract-section">
                  <h3>法务复核</h3>
                  {record.review.legal_summary && <p>{record.review.legal_summary}</p>}
                  {record.review.suggested_revision && <pre className="contract-legal-text">{record.review.suggested_revision}</pre>}
                  <label className="contract-body">法务审查意见<Textarea disabled={!!busy || !['reviewed', 'submitted'].includes(record.status)} maxLength={500} onChange={event => setLegalNote(event.currentTarget.value)} rows={3} value={legalNote} /></label>
                  {['reviewed', 'submitted'].includes(record.status) && <Button disabled={!!busy || !legalNote.trim()} onClick={() => void run('正在保存法务意见', async () => {
                    applyRecord(await saveLegalNote(activeId, record.revision, legalNote))
                  })} variant="outline">保存法务意见</Button>}
                </section>
              )}
              {canSend && !index?.oa_ready && <p className="contract-feedback">OA 测试接口尚未配置。可在 OA 手工提交并登记回执。</p>}
              {canSend && index?.oa_ready && (
                <div className="contract-actions">
                  {showSubmit ? <>
                    <Button disabled={!!busy} onClick={() => void run('正在提交 OA 测试流程', async () => {
                      applyRecord(await submitContract(activeId, record.revision))
                    })}>{index.demo ? '确认演示送审' : '确认提交 OA 测试流程'}</Button>
                    <Button onClick={() => setShowSubmit(false)} variant="ghost">取消</Button>
                  </> : <Button disabled={!!busy} onClick={() => setShowSubmit(true)} variant="outline">{index.demo ? '演示送审' : '提交 OA 测试审批'}</Button>}
                </div>
              )}
              {(record?.status === 'submission_unknown' || record?.status === 'sending') && <p role="status">请在 OA 核实是否已生成流程，找到流程编号后登记回执。</p>}
              {record?.oa_request_id && <p>OA 流程编号：{record.oa_request_id}</p>}
              {canRecordReceipt && (
                <form className="contract-section" onSubmit={event => {
                  event.preventDefault()
                  void run('正在登记回执', async () => applyRecord(
                    await recordApproval(activeId, record.revision, requestId.trim(), outcome, receiptNote)
                  ))
                }}>
                  <h3>登记 OA 回执</h3>
                  <div className="contract-fields">
                    <label>OA 流程编号<Input disabled={!!busy || !!record.oa_request_id} inputMode="numeric" maxLength={20} onChange={event => setRequestId(event.currentTarget.value)} required value={requestId} /></label>
                    <label>OA 审批状态<select disabled={!!busy} onChange={event => setOutcome(event.currentTarget.value as Outcome)} value={outcome}>
                      <option value="submitted">审批中</option>
                      <option value="approved">已通过</option>
                      <option value="rejected">已退回</option>
                    </select></label>
                  </div>
                  <label className="contract-body">审批结论<Input disabled={!!busy} maxLength={500} onChange={event => setReceiptNote(event.currentTarget.value)} required={outcome !== 'submitted'} value={receiptNote} /></label>
                  <div className="contract-actions">
                    <Button disabled={!!busy || !requestId.trim()} type="submit" variant="outline">登记回执</Button>
                    {(record.status === 'submission_unknown' || record.status === 'sending') && <Button
                      disabled={!!busy || !receiptNote.trim() || !!requestId.trim()}
                      onClick={() => void run('正在登记核实结果', async () => {
                        applyRecord(await resolveSubmission(activeId, record.revision, receiptNote))
                      })}
                      type="button"
                      variant="ghost"
                    >确认 OA 未创建流程</Button>}
                  </div>
                </form>
              )}
              {record && !dirty && (
                <div className="contract-actions">
                  <Button disabled={!!busy} onClick={() => void run('正在生成水印版', () => exportContractPdf(activeId, record.revision, false))} variant="outline">下载水印 PDF</Button>
                  {canClean && <Button disabled={!!busy} onClick={() => void run('正在生成清洁版', () => exportContractPdf(activeId, record.revision, true))} variant="outline">下载清洁版 PDF</Button>}
                  {record.signed_name && <Button disabled={!!busy} onClick={() => void run('正在读取用印件', () => exportSealedCopy(activeId, record.signed_name!))} variant="outline">下载用印原件</Button>}
                </div>
              )}
              {record?.status === 'approved' && (
                <section className="contract-section">
                  <h3>登记用印</h3>
                  {index?.demo ? <Button disabled={!!busy} onClick={() => void run('正在生成演示用印件', async () => {
                    applyRecord(await createDemoSeal(activeId, record.revision))
                  })} variant="outline">生成演示用印件</Button> : <>
                    <label className="contract-import">已用印的合同 PDF<Input accept=".pdf" disabled={!!busy} onChange={event => {
                      setSealFile(event.currentTarget.files?.[0] ?? null)
                      setSealVerified(false)
                    }} type="file" /></label>
                    <label className="contract-checkbox"><input checked={sealVerified} disabled={!!busy || !sealFile} onChange={event => setSealVerified(event.currentTarget.checked)} type="checkbox" />已核对用印件与 OA 批准版本</label>
                    <Button disabled={!!busy || !sealFile || !sealVerified} onClick={() => void run('正在登记用印件', async () => {
                      if (sealFile) {applyRecord(await registerSeal(activeId, record.revision, sealFile))}
                    })} variant="outline">登记用印件</Button>
                  </>}
                </section>
              )}
              {record?.signed_check && <p className="contract-feedback">用印件核对 · {checkLabels[record.signed_check]}</p>}
              {record?.status === 'sealed' && <Button disabled={!!busy} onClick={() => void run('正在归档', async () => {
                applyRecord(await archiveContract(activeId, record.revision))
              })}>归档到台账</Button>}
              {record && !dirty && <ContractVersions id={activeId} key={`${activeId}:${record.revision}`} />}
              {!!record?.events.length && (
                <details className="contract-section">
                  <summary>流转记录</summary>
                  <ol className="contract-findings">
                    {record.events.map((event, i) => <li key={i}><strong>{statusLabels[event.status]}</strong><small>{new Date(event.at).toLocaleString()}</small>{event.note && <span>{event.note}</span>}</li>)}
                  </ol>
                </details>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
