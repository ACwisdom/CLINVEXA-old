export type ConsultationStatus = 'failed' | 'processing' | 'ready' | 'recording'
export type ConsultationMarkerLabel =
  | 'allergy_history'
  | 'assessment'
  | 'chief_complaint'
  | 'examination'
  | 'important'
  | 'medication_history'
  | 'past_history'
  | 'plan'
  | 'present_illness'

export interface ConsultationMarker {
  id: string
  label: ConsultationMarkerLabel
  note: string
  offset_ms: number
}

export interface ConsultationMarkerTitle extends ConsultationMarker {
  title: string
}

export interface ConsultationDraft {
  allergy_history: string
  chief_complaint: string
  examination_summary: string
  followup_plan: string
  medication_history: string
  past_history: string
  preliminary_assessment: string
  present_illness: string
  quality_issues: string[]
  requires_human_review: boolean
  source_evidence: Record<string, string>
  treatment_plan: string
}

export interface ConsultationDraftField {
  key: keyof Omit<ConsultationDraft, 'quality_issues' | 'requires_human_review' | 'source_evidence'>
  source_evidence: string
  status: 'not_mentioned' | 'present'
  title: string
  value: string
}

export interface ConsultationResponse {
  analysis_turns?: Array<{ role: string; text: string; evidence: string; inferred: boolean }>
  dialect?: string
  analysis_segments?: number
  suggestions?: Array<{ title: string; reason: string; evidence: string; source: string }>
  doctor_draft?: string | null
  doctor_draft_revision?: number
  segments?: Array<{ sequence: number; text: string; duration_ms: number }>
  analysis_mode: 'ai' | 'deterministic_fallback' | 'pending'
  analysis_warning: string | null
  audio_path: string | null
  consent_confirmed: boolean
  draft: ConsultationDraft | null
  draft_fields: ConsultationDraftField[]
  draft_language: 'zh-CN'
  draft_schema_version: 'clinvexa.consultation-draft.v1'
  draft_text: string
  duration_ms: number
  ended_at: string | null
  error: string | null
  id: string
  marker_titles: ConsultationMarkerTitle[]
  markers: ConsultationMarker[]
  patient_id: string
  patient_name: string
  raw_transcript: string
  started_at: string
  status: ConsultationStatus
  transcript: string
}

export interface ConsultationView {
  status: 'setup' | 'starting' | 'recording' | 'paused' | 'processing' | 'ready' | 'failed'
  record: ConsultationResponse | null
  draft: string
  elapsed: number
  pending: number
  error: string | null
  dirty: boolean
  analyzing?: boolean
  analysisProgress?: string[]
  analysisError?: string | null
}
export type ConsultationCommand =
  | { type: 'start'; patientId: string; patientName: string; consent: boolean; screen?: boolean; dialect?: string }
  | { type: 'pause' | 'resume' | 'finish' | 'retry' | 'reset' | 'save' | 'analyze' }
  | { type: 'load'; id: string }
  | { type: 'draft'; text: string }
  | { type: 'correct'; text: string; segmentCount: number }
  | { type: 'marker'; label: ConsultationMarkerLabel; note: string }

