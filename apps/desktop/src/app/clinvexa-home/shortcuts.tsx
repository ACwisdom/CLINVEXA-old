import type { ComponentType } from 'react'

import { CheckCircle2, Clipboard, Clock, FileText, Mic, Search, Users } from '@/lib/icons'

import type { CLINVEXAHomeAction } from './events'

export type CLINVEXAHomeCategory = 'clinical' | 'patient' | 'office'
export type CLINVEXAHomeAvailability = 'available' | 'loading' | 'unavailable'

export type CLINVEXAHomeShortcut = {
  action: CLINVEXAHomeAction
  availability: CLINVEXAHomeAvailability
  badge?: string
  categories: CLINVEXAHomeCategory[]
  description: string
  existingTarget: string
  icon: ComponentType<{ 'aria-hidden'?: boolean; className?: string }>
  id: CLINVEXAHomeAction
  title: string
}

export const CLINVEXA_HOME_CATEGORIES: ReadonlyArray<{
  icon: ComponentType<{ 'aria-hidden'?: boolean; className?: string }>
  id: CLINVEXAHomeCategory
  label: string
}> = [
  { icon: FileText, id: 'clinical', label: '临床文书' },
  { icon: Users, id: 'patient', label: '患者管理' },
  { icon: Clipboard, id: 'office', label: '智能办公' }
]

/** Pure navigation metadata; business behaviour remains in existing surfaces. */
export const CLINVEXA_HOME_SHORTCUTS: readonly CLINVEXAHomeShortcut[] = [
  { action: 'platform-account', availability: 'available', categories: ['clinical', 'patient', 'office'], description: '使用平台同一账号，调用已安装的智能体', existingTarget: 'CLINVEXAPlatform', icon: Users, id: 'platform-account', title: '我的平台智能体' },
  { action: 'consultation', availability: 'available', badge: '推荐', categories: ['clinical', 'patient'], description: '录音转写并生成九字段病历草稿', existingTarget: 'CLINVEXAConsultation', icon: Mic, id: 'consultation', title: '开始问诊记录' },
  { action: 'record-structuring', availability: 'available', categories: ['clinical', 'patient', 'office'], description: '上传文件，结构化并标记冲突与缺项', existingTarget: 'CLINVEXASkillPlaza / record-structuring', icon: FileText, id: 'record-structuring', title: '整理已有病历' },
  { action: 'quality-check', availability: 'available', categories: ['clinical', 'patient', 'office'], description: '发现遗漏、矛盾和需要医生确认的内容', existingTarget: 'CLINVEXAWorkbench / medical_record', icon: CheckCircle2, id: 'quality-check', title: '检查病历质量' },
  { action: 'scheduled-tasks', availability: 'available', badge: '自动执行', categories: ['clinical', 'patient', 'office'], description: '定时生成随访提醒、复诊复查清单和科室周报', existingTarget: '/cron', icon: Clock, id: 'scheduled-tasks', title: '定时任务' },
  { action: 'rpa', availability: 'available', categories: ['clinical', 'patient'], description: '医生确认后自动填写并逐项核验', existingTarget: 'CLINVEXARpa', icon: Clipboard, id: 'rpa', title: '填写 HIS 草稿' },
  { action: 'knowledge-search', availability: 'available', categories: ['clinical', 'patient', 'office'], description: '获得带来源证据的医学资料摘要', existingTarget: 'CLINVEXAWorkbench / knowledge_patient', icon: Search, id: 'knowledge-search', title: '医学知识检索' }
]
