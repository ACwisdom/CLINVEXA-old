const BASE = 'http://127.0.0.1:8001/clinvexa/contracts'

export const statusLabels = {
  draft: '起草中',
  reviewed: '已预审',
  sending: '送审中',
  submission_unknown: '待核实送审结果',
  submitted: '审批中',
  approved: '已通过',
  rejected: '已退回',
  sealed: '已用印',
  archived: '已归档'
} as const

export type Status = keyof typeof statusLabels
export type MaterialKind = 'tender' | 'response' | 'award'
export type Outcome = 'submitted' | 'approved' | 'rejected'
export type TemplateId = 'business' | 'purchase' | 'service'
export type DocumentKind = 'contract' | MaterialKind
export type AmountDirection = 'income' | 'expense' | 'none'

export interface Draft {
  title: string
  counterparty: string
  project_number: string
  amount: string | null
  body: string
  materials: Partial<Record<MaterialKind, {name: string; text: string}>>
  template_id: TemplateId
  procurement_required: boolean
  procurement_reference: string
  contract_type?: TemplateId | null
  hospital_party?: string
  amount_direction?: AmountDirection | null
  amount_fixed?: boolean | null
  funding_source?: string
  preaudit_documents?: Partial<Record<DocumentKind, string>>
  starts_on: string | null
  ends_on: string | null
}

export interface Summary {
  id: string
  title: string
  counterparty: string
  project_number: string
  amount: string | null
  status: Status
  oa_request_id: string | null
  updated_at: string
  reminders: string[]
}

export interface Contract {
  id: string
  revision: number
  status: Status
  draft: Draft
  review: {
    findings: Array<{level: 'blocking' | 'warning' | 'advice'; source: string; issue: string; suggestion: string}>
    ai_status: 'not_configured' | 'complete' | 'pending'
    legal_summary: string
    suggested_revision: string
  } | null
  oa_request_id: string | null
  events: Array<{status: Status; at: string; note: string}>
  signed_name: string | null
  signed_sha256: string | null
  signed_check: 'matched' | 'different' | 'manual' | null
  legal_note: string
  procurement_route: string
  reminders: string[]
}

export interface ContractIndex {
  records: Summary[]
  template: string
  model_ready: boolean
  oa_ready: boolean
  preaudit_ready?: boolean
  submission_rehearsal_ready?: boolean
  templates: Record<TemplateId, {label: string; body: string}>
  locked_header: string
  demo: boolean
  legal: boolean
}

export interface VersionEntry {revision: number; status: Status; at: string}
export interface DiffBlock {before_line: number; after_line: number; before: string[]; after: string[]}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response

  try {
    response = await fetch(BASE + path, { signal: AbortSignal.timeout(60000), ...init })
  } catch (error) {
    if (init?.signal?.aborted) {throw error}
    throw new Error('合同管理服务未响应，请检查 CLINVEXA 后台后重试')
  }

  if (!response.ok) {
    const result = await response.json().catch(() => null)
    const details = result?.detail

    if (typeof details === 'string') {throw new Error(details)}

    if (Array.isArray(details)) {
      const message = details[0]?.msg

      if (typeof message === 'string' && message.startsWith('Value error, ')) {
        throw new Error(message.slice('Value error, '.length))
      }

      throw new Error('请检查合同名称、金额或 OA 流程编号格式')
    }

    throw new Error(`合同管理请求失败（${response.status}）`)
  }

  return response
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request(path, init)).json() as Promise<T>
}

function write<T = Contract>(path: string, value: unknown, method = 'POST'): Promise<T> {
  return json(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
}

export const loadContracts = (signal?: AbortSignal) => json<ContractIndex>('', signal ? { signal } : undefined)
export const loadContract = (id: string) => json<Contract>(`/${id}`)
export const saveContract = (id: string, revision: number, draft: Draft) => write(`/${id}`, { revision, draft }, 'PUT')
export const reviewContract = (id: string, revision: number, use_model: boolean) => write(`/${id}/review`, { revision, use_model })
export const submitContract = (id: string, revision: number) => write(`/${id}/submit`, { revision })
export const rehearseSubmission = (id: string, revision: number) =>
  write<{allowed: boolean; reasons: string[]; blocking: string[]}>(`/${id}/submission-rehearsal`, { revision })
export const archiveContract = (id: string, revision: number) => write(`/${id}/archive`, { revision })
export const recordApproval = (id: string, revision: number, request_id: string, outcome: Outcome, note: string) =>
  write(`/${id}/receipt`, { revision, request_id, outcome, note })
export const resolveSubmission = (id: string, revision: number, note: string) =>
  write(`/${id}/resolve-submission`, { revision, note })
export const createDemoContract = () => json<Contract>('/demo', { method: 'POST' })
export const createDemoSeal = (id: string, revision: number) => write(`/${id}/demo-seal`, { revision })
export const saveLegalNote = (id: string, revision: number, note: string) => write(`/${id}/legal-review`, { revision, note })
export const loadVersions = (id: string) => json<VersionEntry[]>(`/${id}/versions`)
export const compareVersions = (id: string, before: number, after: number) => json<DiffBlock[]>(`/${id}/compare?before=${before}&after=${after}`)

export function registerSeal(id: string, revision: number, file: File) {
  return json<Contract>(
    `/${id}/seal?revision=${revision}&verified=true&name=${encodeURIComponent(file.name)}`,
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/pdf' } }
  )
}

export function extractContractFile(file: File) {
  return json<{text: string; fields: Partial<Pick<Draft, 'counterparty' | 'project_number' | 'amount'>>}>(
    `/extract?name=${encodeURIComponent(file.name)}`,
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } }
  )
}

async function download(path: string, filename: string): Promise<void> {
  const url = URL.createObjectURL(await (await request(path)).blob())
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const exportContractLedger = () => download('/ledger.csv', '合同台账.csv')
export const exportRiskLedger = () => download('/risks.csv', '合同风险台账.csv')
export const exportContractPdf = (id: string, revision: number, clean: boolean) =>
  download(`/${id}/pdf?clean=${clean}`, `合同-${clean ? '清洁版' : '水印版'}-v${revision}.pdf`)
export const exportSealedCopy = (id: string, filename: string) => download(`/${id}/sealed-copy`, filename)

export interface ReviewDocument {
  id: string
  name: string
  kind: DocumentKind
  sha256: string
  hash_basis: 'text' | 'file'
  parser_version: string
  status: 'complete' | 'partial' | 'failed' | 'empty' | 'ocr_required'
  diagnostics: string[]
  reliability: string
  text: string
  segments: Array<{anchor: string; start: number; end: number}>
}

export interface ReviewEvidence {
  document_id: string
  document_name: string
  anchor: string
  start: number
  end: number
  quote: string
  reliability: string
}

export type DecisionStatus = 'pending' | 'accepted' | 'dismissed' | 'needs_evidence'

export interface ReviewDecision {
  status: DecisionStatus
  reviewer: string
  identity_source?: 'local_service_account'
  note: string
  at: string
}

export interface ReviewFinding {
  id: string
  origin: 'rule' | 'model'
  level: 'blocking' | 'warning' | 'advice'
  rule_id: string
  rule_version: string
  scope: string
  issue: string
  suggestion: string
  evidence: ReviewEvidence[]
  model_suggestions?: Array<Pick<ReviewFinding, 'level' | 'suggestion' | 'evidence'>>
}

export interface ReviewJobSummary {
  id: string
  contract_revision: number
  status: 'running' | 'completed' | 'partial' | 'failed'
  created_at: string
  coverage: Record<string, string>
}

export interface ReviewJob extends ReviewJobSummary {
  rules: { source: string; version: string }
  model: { name: string | null; requested: boolean }
  documents: ReviewDocument[]
  findings: ReviewFinding[]
  decisions: Record<string, ReviewDecision[]>
  decision_revision: number
  error: string | null
  elements: Record<string, Array<{value: string; evidence: ReviewEvidence}>>
}

export interface ReviewReportSummary { id: string; generated_at: string; decision_revision: number }

export interface ReviewReport extends ReviewReportSummary, Pick<ReviewJob, 'findings' | 'decisions' | 'status' |
  'contract_revision' | 'coverage' | 'rules' | 'model' | 'error'> {
  job_id: string
  contract: Omit<Draft, 'body' | 'materials' | 'preaudit_documents'>
  documents: Array<Omit<ReviewDocument, 'text' | 'segments'>>
}

export function uploadReviewDocument(id: string, kind: DocumentKind, file: File) {
  return json<{document: ReviewDocument; fields: Record<string, string>}>(
    `/${id}/review-documents?kind=${kind}&name=${encodeURIComponent(file.name)}`,
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } }
  )
}

const jobsPath = (id: string) => `/${id}/review-jobs`
const jobPath = (id: string, job: string) => `${jobsPath(id)}/${job}`
const reportsPath = (id: string, job: string) => `${jobPath(id, job)}/reports`

export const startPreaudit = (id: string, revision: number, use_model: boolean) =>
  write<ReviewJob>(jobsPath(id), { revision, use_model, job_id: crypto.randomUUID() })
export const loadPreaudits = (id: string, signal?: AbortSignal) =>
  json<ReviewJobSummary[]>(jobsPath(id), signal ? { signal } : undefined)
export const loadPreaudit = (id: string, job: string, signal?: AbortSignal) =>
  json<ReviewJob>(jobPath(id, job), signal ? { signal } : undefined)
export const saveReviewDecision = (
  id: string, job: string, finding: string, revision: number, decision: Pick<ReviewDecision, 'status' | 'note'>
) => write<ReviewJob>(`${jobPath(id, job)}/findings/${finding}/decision`, { revision, ...decision }, 'PUT')
export const generateReviewReport = (id: string, job: string) => write<ReviewReport>(reportsPath(id, job), {})
export const loadReviewReports = (id: string, job: string, signal?: AbortSignal) =>
  json<ReviewReportSummary[]>(reportsPath(id, job), signal ? { signal } : undefined)
export const loadReviewReport = (id: string, job: string, report: string) =>
  json<ReviewReport>(`${reportsPath(id, job)}/${report}`)
export const exportReviewReport = (id: string, job: string, report: string) =>
  download(`${reportsPath(id, job)}/${report}?format=csv`, `合同预审-${report}.csv`)
export const exportReviewOriginal = (id: string, document: Pick<ReviewDocument, 'id' | 'name'>) =>
  download(`/${id}/review-documents/${document.id}/original`, document.name)
