/** Typed IPC contract shared by the renderer and Electron main process. */
export interface CopilotSuggestion {
  id: string
  kind: 'field' | 'examination' | 'advice'
  title: string
  text: string
  reason: string
  evidence: string[]
  sourceIds: string[]
  cautions: string[]
  targetLabel: string
}

export interface CopilotResult {
  consultationId?: string
  consultationSegments?: number
  id: string
  taskKey: string
  frameId: string
  windowId: string
  processName: string
  title: string
  capturedAt: number
  createdAt: number
  latencyMs: number
  deliveryMs?: number
  patientId: string
  patientName: string
  encounterId: string
  scene: 'record' | 'examination' | 'report' | 'reading' | 'writing' | 'other'
  summary: string
  facts: string[]
  missing: string[]
  suggestions: CopilotSuggestion[]
  sources: { id: string; title: string; version: string; url: string; reviewer: string; reviewedAt: string }[]
  question: string
  draft: string
  revision: number
}

export interface CopilotState {
  analysisProgress?: string[]
  enabled: boolean
  expanded: boolean
  fillMode: boolean
  status: 'off' | 'watching' | 'analyzing' | 'ready' | 'error'
  error: string | null
  frameId: string | null
  result: CopilotResult | null
  stale: boolean
  startedAt: number | null
  target: { title: string; processName: string; windowId: string } | null
}

export interface CopilotFillResult {
  status: 'filled' | 'copied' | 'failed'
  message: string
  fields: { label: string; status: 'filled' | 'failed'; message?: string }[]
}

export interface CopilotBridge {
  getState(): Promise<CopilotState>
  onState(callback: (state: CopilotState) => void): () => void
  setExpanded(expanded: boolean): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  analyze(question?: string, sourceText?: string, expectedFrameId?: string, resultId?: string): Promise<void>
  copy(resultId: string, suggestionIds: string[]): Promise<CopilotFillResult>
  fill(resultId: string, suggestionIds: string[]): Promise<CopilotFillResult>
  startFillMode(resultId: string): Promise<void>
  stopFillMode(): Promise<void>
  history(): Promise<CopilotResult[]>
  taskHistory(taskKey: string): Promise<CopilotResult[]>
  saveDraft(resultId: string, revision: number, draft: string): Promise<CopilotResult>
  versions(resultId: string): Promise<{ revision: number; saved: number; draft: string }[]>
  knowledge(): Promise<CopilotResult['sources']>
  addKnowledge(source: { title: string; version: string; reviewer: string; text: string; url: string; reviewed: true }): Promise<CopilotResult['sources'][number]>
}
