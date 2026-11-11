import { useEffect } from 'react'
import { useNavigate } from 'react-router'

import { requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { CRON_ROUTE, navigateToWorkspacePage } from '@/app/routes'
import { $skillsCategory } from '@/app/skills/store'
import { CLINVEXAPagePath } from '@/clinvexa/navigation'

import { onCLINVEXAHomeAction } from './events'

const QUALITY_DRAFT = '请检查已提供病历中的缺项、冲突、诊断确定性、剂量单位和时间问题，并列出需要医生确认的内容。'
const KNOWLEDGE_DRAFT = '请检索并整理这个医学问题，提供来源、证据摘要、适用范围和需要医生复核的事项：'
const FIRST_USE_DRAFT = '这是一次仅使用虚构病例的体验，不涉及真实患者数据。请协助整理以下虚构病例：患者王某，35 岁，咳嗽 3 天、低热 1 天；请先提示我补充需要医生确认的信息。'

/** Routes home shortcuts to existing navigation/composer surfaces. It never submits a task. */
export function CLINVEXAHomeBridge() {
  const navigate = useNavigate()
  useEffect(() => onCLINVEXAHomeAction(action => {
    switch (action) {
      case 'scheduled-tasks':
        navigateToWorkspacePage(navigate, CRON_ROUTE)
        break
      case 'all-medical-tools':
        $skillsCategory.set('medical')
        navigateToWorkspacePage(navigate, CLINVEXAPagePath('skills'))
        break
      case 'quality-check':
        requestComposerInsert(QUALITY_DRAFT, { target: 'main' })
        requestComposerFocus('main')
        break
      case 'knowledge-search':
        requestComposerInsert(KNOWLEDGE_DRAFT, { target: 'main' })
        requestComposerFocus('main')
        break
      case 'first-use-demo':
        requestComposerInsert(FIRST_USE_DRAFT, { target: 'main' })
        requestComposerFocus('main')
        break
      default:
        break
    }
  }), [navigate])
  return null
}
