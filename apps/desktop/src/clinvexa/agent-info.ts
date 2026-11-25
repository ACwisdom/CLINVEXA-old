/** User-facing names for the four fixed CLINVEXA work roles.
 *
 * Runtime routing keeps the stable ids below.  The desktop never exposes those
 * ids as the primary label because they do not tell a clinician what the role
 * can actually do.
 */
export type CLINVEXAAgentId = 'desktop_his' | 'knowledge_patient' | 'medical_record' | 'orchestrator'

export interface CLINVEXAAgentMetadata {
  description: string
  name: string
  useWhen: string
}

export const CLINVEXA_AGENT_IDS: CLINVEXAAgentId[] = ['orchestrator', 'medical_record', 'knowledge_patient', 'desktop_his']

export const CLINVEXA_AGENT_INFO: Record<CLINVEXAAgentId, CLINVEXAAgentMetadata> = {
  orchestrator: {
    name: '任务协调助手',
    description: '理解医生的目标，安排合适的能力，并汇总可核对的结果。',
    useWhen: '适合跨多个步骤的办公任务，例如整理资料后生成待办。'
  },
  medical_record: {
    name: '病历文书助手',
    description: '提炼主诉、现病史和检查信息，生成病历草稿并提示缺项。',
    useWhen: '适合问诊记录整理、病历结构化和文书质量核对。'
  },
  knowledge_patient: {
    name: '患者与医学资料助手',
    description: '整理已提供的患者资料，辅助随访与医学资料查阅。',
    useWhen: '适合患者摘要、随访计划和已授权资料的检索整理。'
  },
  desktop_his: {
    name: '屏幕与 HIS 填写助手',
    description: '读取当前电脑画面，在核对患者后将医生选定的草稿快捷填写到测试或 HIS 页面。',
    useWhen: '适合模拟 HIS、表单和桌面软件中的字段填写；不会自行提交正式病历。'
  }
}

export function CLINVEXAAgentInfo(agentId: CLINVEXAAgentId): CLINVEXAAgentMetadata {
  return CLINVEXA_AGENT_INFO[agentId]
}
