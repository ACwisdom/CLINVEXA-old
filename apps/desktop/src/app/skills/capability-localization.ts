import type { SkillInfo, ToolsetInfo } from '@/types/hermes'
import { SKILL_ZH_COPY } from './skill-zh-copy'

export type CapabilityCategory = 'medical' | 'office'
export type CapabilityLanguage = 'en' | 'zh'

interface CapabilityCopy {
  enDescription: string
  enTitle: string
  zhDescription: string
  zhTitle: string
}

const MEDICAL_SKILL_COPY: Record<string, CapabilityCopy> = {
  'allergy-conflict-check': {
    zhTitle: '过敏冲突检查',
    zhDescription: '核对多来源过敏信息并标出冲突，保留原始证据供医生复核。',
    enTitle: 'Allergy Conflict Check',
    enDescription: 'Compare allergy information across sources and flag conflicts with evidence for clinician review.'
  },
  'appointment-triage': {
    zhTitle: '预约分诊整理',
    zhDescription: '整理预约目的、就诊信息和缺失材料，生成可复核的分诊清单。',
    enTitle: 'Appointment Triage',
    enDescription: 'Organize visit purpose, appointment details, and missing materials into a reviewable triage list.'
  },
  'clinical-knowledge-search': {
    zhTitle: '医学知识检索',
    zhDescription: '检索医学来源并生成带出处和复核提示的医学问题回答。',
    enTitle: 'Clinical Knowledge Search',
    enDescription: 'Search medical sources and produce cited answers with clear clinician-review prompts.'
  },
  'consultation-note-draft': {
    zhTitle: '会诊记录草稿',
    zhDescription: '依据会诊资料整理事实、待确认事项和会诊记录初稿。',
    enTitle: 'Consultation Note Draft',
    enDescription: 'Turn consultation materials into a fact-based draft with items that still need confirmation.'
  },
  'department-weekly-report': {
    zhTitle: '科室周报',
    zhDescription: '汇总科室业务数据、文书待办和异常事项，生成周报草稿。',
    enTitle: 'Department Weekly Report',
    enDescription: 'Summarize department activity, documentation tasks, and exceptions in a weekly report draft.'
  },
  'diagnosis-certainty-check': {
    zhTitle: '诊断确定性检查',
    zhDescription: '区分确诊、疑似、待查和已排除诊断，并核对对应来源。',
    enTitle: 'Diagnosis Certainty Check',
    enDescription: 'Separate confirmed, suspected, pending, and excluded diagnoses and verify their sources.'
  },
  'discharge-summary': {
    zhTitle: '出院小结',
    zhDescription: '依据住院材料生成供医生复核的出院小结草稿。',
    enTitle: 'Discharge Summary',
    enDescription: 'Create a clinician-reviewable discharge summary draft from inpatient materials.'
  },
  'exam-report-summary': {
    zhTitle: '检查报告摘要',
    zhDescription: '提取检查报告关键结果、异常标记、单位和待复核事项。',
    enTitle: 'Examination Report Summary',
    enDescription: 'Extract key findings, abnormal flags, units, and review items from examination reports.'
  },
  'followup-plan': {
    zhTitle: '随访计划',
    zhDescription: '依据医生目标整理随访时间、观察项目、复查事项和提醒草稿。',
    enTitle: 'Follow-up Plan',
    enDescription: 'Draft follow-up timing, monitoring items, repeat tests, and reminders from clinician goals.'
  },
  'guideline-evidence-summary': {
    zhTitle: '指南证据摘要',
    zhDescription: '整理指南推荐、适用范围、版本和来源，便于医生快速复核。',
    enTitle: 'Guideline Evidence Summary',
    enDescription: 'Summarize guideline recommendations, scope, version, and sources for rapid clinician review.'
  },
  'informed-consent-explanation': {
    zhTitle: '知情沟通说明',
    zhDescription: '把医生确认的方案整理为易理解的风险说明和沟通要点草稿。',
    enTitle: 'Informed Consent Explanation',
    enDescription: 'Turn a clinician-confirmed plan into a clear draft of risks and communication points.'
  },
  'lab-trend-review': {
    zhTitle: '检验趋势复核',
    zhDescription: '汇总检验原始数值、单位、异常标记和时间变化趋势。',
    enTitle: 'Laboratory Trend Review',
    enDescription: 'Summarize laboratory values, units, abnormal flags, and trends over time.'
  },
  'literature-screening': {
    zhTitle: '文献筛选',
    zhDescription: '按给定纳排标准筛选文献，并记录每条筛选依据。',
    enTitle: 'Literature Screening',
    enDescription: 'Screen literature against supplied criteria and record the reason for each decision.'
  },
  'medical-certificate-draft': {
    zhTitle: '医疗证明草稿',
    zhDescription: '依据已提供的医疗事实生成证明类文书草稿，正式出具前由医生确认。',
    enTitle: 'Medical Certificate Draft',
    enDescription: 'Draft medical certificates from supplied facts for clinician confirmation before issuance.'
  },
  'medical-record-quality': {
    zhTitle: '病历质量检查',
    zhDescription: '检查病历缺项、冲突、诊断确定性、剂量单位和时间问题。',
    enTitle: 'Medical Record Quality Check',
    enDescription: 'Check medical records for omissions, conflicts, certainty, dosage units, and timeline issues.'
  },
  'medical-translation': {
    zhTitle: '医学资料翻译',
    zhDescription: '翻译医学资料并保留术语、数值、单位和不确定性。',
    enTitle: 'Medical Translation',
    enDescription: 'Translate medical materials while preserving terminology, values, units, and uncertainty.'
  },
  'medication-reconciliation': {
    zhTitle: '用药核对',
    zhDescription: '对比当前、既往和停用药物，标记剂量、单位与状态冲突。',
    enTitle: 'Medication Reconciliation',
    enDescription: 'Compare current, previous, and stopped medicines and flag dose, unit, and status conflicts.'
  },
  'nursing-handover-summary': {
    zhTitle: '护理交接摘要',
    zhDescription: '整理护理记录中的风险、观察结果和交接事项。',
    enTitle: 'Nursing Handover Summary',
    enDescription: 'Summarize documented risks, observations, and handover items from nursing records.'
  },
  'outpatient-note-draft': {
    zhTitle: '门诊病历草稿',
    zhDescription: '依据门诊录音、问诊记录和检查资料生成可复核的门诊病历草稿。',
    enTitle: 'Outpatient Note Draft',
    enDescription: 'Create a reviewable outpatient note draft from recordings, consultation notes, and test data.'
  },
  'outpatient-summary': {
    zhTitle: '门诊摘要',
    zhDescription: '依据门诊记录生成保留来源证据的简明摘要草稿。',
    enTitle: 'Outpatient Summary',
    enDescription: 'Create a concise outpatient summary draft with traceable source evidence.'
  },
  'patient-communication-record': {
    zhTitle: '患者沟通记录',
    zhDescription: '将医患沟通整理为沟通记录、患者问题和后续待办。',
    enTitle: 'Patient Communication Record',
    enDescription: 'Turn clinician-patient communication into a record of questions and follow-up actions.'
  },
  'patient-education': {
    zhTitle: '患者宣教',
    zhDescription: '把医生确认的医疗内容改写为易理解的患者宣教草稿。',
    enTitle: 'Patient Education',
    enDescription: 'Rewrite clinician-confirmed medical content as clear patient education material.'
  },
  'patient-one-page-summary': {
    zhTitle: '患者一页摘要',
    zhDescription: '把多份患者资料整理为可追溯的一页摘要。',
    enTitle: 'Patient One-page Summary',
    enDescription: 'Consolidate multiple patient documents into a traceable one-page summary.'
  },
  'record-structuring': {
    zhTitle: '病历结构化',
    zhDescription: '结构化病历、问诊记录和检查资料，并保留来源证据供医生复核。',
    enTitle: 'Medical Record Structuring',
    enDescription: 'Structure medical records, consultation transcripts, and reports with traceable evidence.'
  },
  'referral-note-draft': {
    zhTitle: '转诊记录草稿',
    zhDescription: '依据现有病历整理转诊原因、关键事实和待确认事项。',
    enTitle: 'Referral Note Draft',
    enDescription: 'Draft referral reasons, key facts, and confirmation items from existing records.'
  },
  'research-data-extraction': {
    zhTitle: '科研数据提取',
    zhDescription: '从研究材料提取指定变量，并保留文献位置证据。',
    enTitle: 'Research Data Extraction',
    enDescription: 'Extract requested variables from research materials with location evidence.'
  }
}

const OFFICE_SKILL_COPY: Record<string, CapabilityCopy> = {
  'tencent-docs': {
    zhTitle: '腾讯文档', zhDescription: '搜索、读取和编辑已授权的腾讯文档。',
    enTitle: 'Tencent Docs', enDescription: 'Search, read, and edit authorized Tencent documents.'
  },
  'tencent-meeting': {
    zhTitle: '腾讯会议', zhDescription: '查询会议、参会人、录制和纪要，并预约会议。',
    enTitle: 'Tencent Meeting', enDescription: 'Manage meetings, participants, recordings, and minutes.'
  },
  wecom: {
    zhTitle: '企业微信', zhDescription: '调用已授权业务域的企业微信工具。',
    enTitle: 'WeCom', enDescription: 'Use authorized WeCom business tools.'
  },
  feishu: {
    zhTitle: '飞书', zhDescription: '使用飞书开放平台的消息、文档和日历工具。',
    enTitle: 'Feishu', enDescription: 'Use Feishu messages, documents, and calendar tools.'
  },
  dingtalk: {
    zhTitle: '钉钉', zhDescription: '调用从钉钉 MCP 广场授权的服务工具。',
    enTitle: 'DingTalk', enDescription: 'Use authorized DingTalk MCP services.'
  },
  'skill-creator': {
    zhTitle: '技能创建器',
    zhDescription: '创建、校验并发布技能，使其可在技能中心检索和调用。',
    enTitle: 'Skill Creator',
    enDescription: 'Create, validate, and publish CLINVEXA skills so they can be found and invoked.'
  },
  docx: {
    zhTitle: 'Word 文档',
    zhDescription: '创建、读取和编辑 Word 文档与模板。',
    enTitle: 'Word Documents',
    enDescription: 'Create, read, and edit Word documents and templates.'
  },
  pdf: {
    zhTitle: 'PDF 文档',
    zhDescription: '创建、合并、拆分、填写和整理 PDF 文件。',
    enTitle: 'PDF Documents',
    enDescription: 'Create, merge, split, fill, and organize PDF files.'
  },
  powerpoint: {
    zhTitle: 'PowerPoint 演示文稿',
    zhDescription: '创建、读取和编辑演示文稿、幻灯片与讲者备注。',
    enTitle: 'PowerPoint Presentations',
    enDescription: 'Create, read, and edit presentations, slides, and speaker notes.'
  },
  xlsx: {
    zhTitle: 'Excel 表格',
    zhDescription: '创建、读取和编辑 Excel 工作簿与 CSV 数据。',
    enTitle: 'Excel Spreadsheets',
    enDescription: 'Create, read, and edit Excel workbooks and CSV data.'
  }
}

const TOOLSET_COPY: Record<string, CapabilityCopy> = {
  browser: {
    zhTitle: '浏览器操作',
    zhDescription: '打开网页、读取页面内容并执行受控的网页交互。',
    enTitle: 'Browser',
    enDescription: 'Open websites, read page content, and perform controlled web interactions.'
  },
  computer_use: {
    zhTitle: '电脑操作',
    zhDescription: '通过截图理解桌面并执行点击、输入、滚动和软件操作。',
    enTitle: 'Computer Use',
    enDescription: 'Understand the desktop through screenshots and perform clicks, typing, scrolling, and app actions.'
  },
  cronjob: {
    zhTitle: '计划任务',
    zhDescription: '创建和管理按时间自动执行的任务。',
    enTitle: 'Scheduled Tasks',
    enDescription: 'Create and manage tasks that run automatically on a schedule.'
  },
  image_gen: {
    zhTitle: '图像生成',
    zhDescription: '根据文字描述生成或编辑图像。',
    enTitle: 'Image Generation',
    enDescription: 'Generate or edit images from text instructions.'
  },
  terminal: {
    zhTitle: '终端与文件',
    zhDescription: '运行命令、处理本地文件并执行办公自动化脚本。',
    enTitle: 'Terminal and Files',
    enDescription: 'Run commands, manage local files, and execute office automation scripts.'
  },
  vision: {
    zhTitle: '图像分析',
    zhDescription: '识别截图、图片和扫描件中的内容并进行分析。',
    enTitle: 'Vision and Image Analysis',
    enDescription: 'Recognize and analyze content in screenshots, images, and scanned documents.'
  },
  web: {
    zhTitle: '网页检索',
    zhDescription: '搜索网页并提取可引用的页面信息。',
    enTitle: 'Web Search',
    enDescription: 'Search the web and extract source-backed page information.'
  }
}

const MEDICAL_TERMS = [
  'allergy',
  'appointment',
  'clinical',
  'consultation',
  'diagnosis',
  'discharge',
  'followup',
  'guideline',
  'lab-',
  'medical',
  'medication',
  'nursing',
  'outpatient',
  'patient',
  'referral',
  '病历',
  '患者',
  '医疗',
  '医学',
  '临床',
  '诊断',
  '检验',
  '随访'
]

function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(' ', '_')
    .replaceAll('-', '_')
}

function readableName(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

export function capabilityLanguage(locale: string): CapabilityLanguage {
  return locale === 'en' ? 'en' : 'zh'
}

export function classifySkill(skill: Pick<SkillInfo, 'category' | 'description' | 'name'>): CapabilityCategory {
  if (skill.name === 'skill-creator') {
    return 'office'
  }

  if (MEDICAL_SKILL_COPY[skill.name]) {
    return 'medical'
  }

  const haystack = `${skill.name} ${skill.category} ${skill.description}`.toLowerCase()

  return MEDICAL_TERMS.some(term => haystack.includes(term)) ? 'medical' : 'office'
}

export function categoryLabel(category: CapabilityCategory, language: CapabilityLanguage): string {
  if (category === 'medical') {
    return language === 'zh' ? '医疗' : 'Medical'
  }

  return language === 'zh' ? '办公事务' : 'Office Work'
}

export function categoryDescription(category: CapabilityCategory, language: CapabilityLanguage): string {
  if (category === 'medical') {
    return language === 'zh'
      ? '病历、问诊、患者管理、医学知识与科研相关技能。'
      : 'Skills for records, consultations, patient management, medical knowledge, and research.'
  }

  return language === 'zh'
    ? '文档、表格、检索、自动化和通用办公事务能力。'
    : 'Capabilities for documents, spreadsheets, research, automation, and general office work.'
}

function localizeSkill(skill: SkillInfo): CapabilityCopy {
  const key = normalizeKey(skill.name).replaceAll('_', '-')
  const copy = MEDICAL_SKILL_COPY[key] ?? OFFICE_SKILL_COPY[key]

  if (copy) {
    return copy
  }

  const title = readableName(skill.name)
  const category = classifySkill(skill)
  const translated = SKILL_ZH_COPY[key]

  return {
    enTitle: title,
    enDescription:
      skill.description ||
      (category === 'medical'
        ? `Medical workflow support for ${title}.`
        : `Office workflow and automation support for ${title}.`),
    zhTitle: translated?.[0] ?? title,
    zhDescription:
      translated?.[1] ??
      (category === 'medical'
        ? `用于 ${title} 相关的医疗资料整理与工作流处理，结果需由医生复核。`
        : `用于 ${title} 相关的文档、信息处理或办公自动化任务。`)
  }
}

export function localizedSkillTitle(skill: SkillInfo, language: CapabilityLanguage): string {
  const copy = localizeSkill(skill)

  return language === 'zh' ? copy.zhTitle : copy.enTitle
}

export function localizedSkillDescription(skill: SkillInfo, language: CapabilityLanguage): string {
  const copy = localizeSkill(skill)

  return language === 'zh' ? copy.zhDescription : copy.enDescription
}

export function localizeToolset(
  toolset: ToolsetInfo,
  language: CapabilityLanguage
): { description: string; title: string } {
  const key = normalizeKey(toolset.name)
  const copy = TOOLSET_COPY[key]

  if (copy) {
    return {
      title: language === 'zh' ? copy.zhTitle : copy.enTitle,
      description: language === 'zh' ? copy.zhDescription : copy.enDescription
    }
  }

  const rawTitle = toolset.label || readableName(toolset.name)
  const title = rawTitle.replace(/^[\p{Emoji}\p{Extended_Pictographic}\s]+/u, '').trim() || rawTitle

  return {
    title,
    description:
      language === 'zh'
        ? `用于 ${title} 相关的办公处理与自动化操作。`
        : toolset.description || `Office workflow and automation tools for ${title}.`
  }
}

export function localizeExternalDescription(
  description: string | null | undefined,
  name: string,
  language: CapabilityLanguage
): string {
  const key = normalizeKey(name).replaceAll('_', '-')
  const copy = MEDICAL_SKILL_COPY[key] ?? OFFICE_SKILL_COPY[key]
  if (language === 'en') {
    return copy?.enDescription ?? description ?? `Connect ${readableName(name)} to extend CLINVEXA workflows.`
  }

  if (copy) {
    return copy.zhDescription
  }
  const translated = SKILL_ZH_COPY[key]
  if (translated) return translated[1]

  return `连接或安装 ${readableName(name)}，扩展 CLINVEXA 的办公事务处理能力。`
}

export function localizedExternalTitle(name: string, language: CapabilityLanguage): string {
  const key = normalizeKey(name).replaceAll('_', '-')
  const copy = MEDICAL_SKILL_COPY[key] ?? OFFICE_SKILL_COPY[key]

  if (!copy) {
    return language === 'zh' ? (SKILL_ZH_COPY[key]?.[0] ?? readableName(name)) : readableName(name)
  }

  return language === 'zh' ? copy.zhTitle : copy.enTitle
}

export function isMedicalSkillName(name: string): boolean {
  return MEDICAL_SKILL_COPY[name] !== undefined
}
