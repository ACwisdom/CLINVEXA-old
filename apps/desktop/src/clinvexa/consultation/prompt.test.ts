import { describe, expect, it } from 'vitest'

import { buildConsultationAgentPrompt } from './prompt'

describe('buildConsultationAgentPrompt', () => {
  it('preserves the patient, marked evidence, transcript, and review boundary', () => {
    const prompt = buildConsultationAgentPrompt({
      analysis_mode: 'ai',
      analysis_warning: null,
      audio_path: 'audio.webm',
      consent_confirmed: true,
      draft: null,
      draft_fields: [],
      draft_language: 'zh-CN',
      draft_schema_version: 'clinvexa.consultation-draft.v1',
      draft_text: '主诉：咳嗽3天',
      duration_ms: 12_000,
      ended_at: '2026-08-09T10:01:00+08:00',
      error: null,
      id: 'consultation-1',
      marker_titles: [{ id: 'marker-1', label: 'chief_complaint', note: '重点追问', offset_ms: 5_000, title: '主诉' }],
      markers: [{ id: 'marker-1', label: 'chief_complaint', note: '重点追问', offset_ms: 5_000 }],
      patient_id: 'DC-001',
      patient_name: '张明',
      raw_transcript: '患者咳嗽三天。',
      started_at: '2026-08-09T10:00:00+08:00',
      status: 'ready',
      transcript: '患者咳嗽三天。'
    })

    expect(prompt).toContain('[CLINVEXA 问诊病历草稿复核任务]')
    expect(prompt).toContain('目标 Agent：medical_record')
    expect(prompt).toContain('本任务已进入独立新会话')
    expect(prompt).toContain('患者编号：DC-001')
    expect(prompt).toContain('主诉（0:05）：重点追问')
    expect(prompt).toContain('患者咳嗽三天。')
    expect(prompt).toContain('信息质量分析')
    expect(prompt).toContain('主诉、现病史、既往史、过敏史、用药史、检查检验信息、初步判断、处置建议、随访计划')
    expect(prompt).toContain('过敏与用药冲突')
    expect(prompt).toContain('无原文证据')
    expect(prompt).toContain('仅供医生复核参考')
  })
})
