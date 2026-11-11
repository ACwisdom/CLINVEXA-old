import { describe, expect, it } from 'vitest'

import type { SkillInfo, ToolsetInfo } from '@/types/hermes'
import installedSkills from './__fixtures__/installed-skills.json'

import {
  capabilityLanguage,
  categoryLabel,
  classifySkill,
  localizedSkillDescription,
  localizedSkillTitle,
  localizeToolset
} from './capability-localization'

const MEDICAL_SKILLS = [
  'allergy-conflict-check',
  'appointment-triage',
  'clinical-knowledge-search',
  'consultation-note-draft',
  'department-weekly-report',
  'diagnosis-certainty-check',
  'discharge-summary',
  'exam-report-summary',
  'followup-plan',
  'guideline-evidence-summary',
  'informed-consent-explanation',
  'lab-trend-review',
  'literature-screening',
  'medical-certificate-draft',
  'medical-record-quality',
  'medical-translation',
  'medication-reconciliation',
  'nursing-handover-summary',
  'outpatient-note-draft',
  'outpatient-summary',
  'patient-communication-record',
  'patient-education',
  'patient-one-page-summary',
  'record-structuring',
  'referral-note-draft',
  'research-data-extraction'
]

function skill(name: string, category = 'CLINVEXA'): SkillInfo {
  return { category, description: '', enabled: true, name, provenance: 'bundled' }
}

describe('CLINVEXA capability localization and categories', () => {
  it.each(installedSkills)('shows installed skill %s in Chinese while preserving its invocation name', name => {
    const original = skill(name)
    expect(localizedSkillTitle(original, 'zh')).toMatch(/[\u3400-\u9fff]/u)
    expect(localizedSkillDescription(original, 'zh')).toMatch(/[\u3400-\u9fff]/u)
    expect(original.name).toBe(name)
  })
  it('places every bundled medical workflow in the Medical category', () => {
    expect(MEDICAL_SKILLS).toHaveLength(26)

    for (const name of MEDICAL_SKILLS) {
      expect(classifySkill(skill(name)), name).toBe('medical')
    }

    expect(classifySkill(skill('skill-creator'))).toBe('office')
    expect(classifySkill(skill('xlsx', 'Productivity'))).toBe('office')
  })

  it('provides concise Simplified Chinese and English copy without changing the invocation id', () => {
    const recordSkill = skill('record-structuring')

    expect(localizedSkillTitle(recordSkill, 'zh')).toBe('病历结构化')
    expect(localizedSkillDescription(recordSkill, 'zh')).toContain('来源证据')
    expect(localizedSkillTitle(recordSkill, 'en')).toBe('Medical Record Structuring')
    expect(localizedSkillDescription(recordSkill, 'en')).toContain('medical records')
    expect(recordSkill.name).toBe('record-structuring')
  })

  it('limits capability display language to Simplified Chinese or English', () => {
    expect(capabilityLanguage('zh')).toBe('zh')
    expect(capabilityLanguage('zh-hant')).toBe('zh')
    expect(capabilityLanguage('ja')).toBe('zh')
    expect(capabilityLanguage('en')).toBe('en')
    expect(categoryLabel('medical', 'zh')).toBe('医疗')
    expect(categoryLabel('office', 'en')).toBe('Office Work')
  })

  it('localizes common office toolsets with a short function introduction', () => {
    const computerUse: ToolsetInfo = {
      configured: true,
      description: 'computer tools',
      enabled: true,
      label: 'Computer Use',
      name: 'computer_use',
      tools: ['computer']
    }

    expect(localizeToolset(computerUse, 'zh')).toEqual({
      title: '电脑操作',
      description: '通过截图理解桌面并执行点击、输入、滚动和软件操作。'
    })
    expect(localizeToolset(computerUse, 'en').title).toBe('Computer Use')
  })
})
