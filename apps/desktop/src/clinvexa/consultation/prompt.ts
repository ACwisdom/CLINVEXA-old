import type { ConsultationResponse } from './api'

/** Build an independent medical-record review task for the editable consultation draft. */
export function buildConsultationAgentPrompt(consultation: ConsultationResponse): string {
  const markerLines = consultation.marker_titles.length
    ? consultation.marker_titles
        .map(marker => {
          const time = Math.max(0, Math.floor(marker.offset_ms / 1_000))

          return `- ${marker.title}（${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}）${marker.note ? `：${marker.note}` : ''}`
        })
        .join('\n')
    : '- 无人工重点标记'

  return `[CLINVEXA 问诊病历草稿复核任务]
目标 Agent：medical_record（病历与文书）
会话要求：本任务已进入独立新会话，请只基于本次问诊材料复核，不沿用上一会话内容。
患者编号：${consultation.patient_id}
患者姓名：${consultation.patient_name || '未填写'}

医生重点标记：
${markerLines}

完整问诊转写：
${consultation.transcript}

CLINVEXA 初步病历草稿：
${consultation.draft_text}

请对草稿做信息质量分析，不要重新生成另一份病历，也不要擅自修改原稿。固定以简体中文输出以下四部分：
1. 结论摘要：说明草稿是否存在明显不合理、矛盾或高风险内容。
2. 问题清单：逐项检查时间线、否定词、过敏与用药冲突、检查结果与判断、处置与随访是否自洽；每项注明严重度。
3. 缺失信息：按主诉、现病史、既往史、过敏史、用药史、检查检验信息、初步判断、处置建议、随访计划列出需要医生补充或确认的内容。
4. 来源证据：每个问题引用上方问诊转写或草稿中的对应原句；无证据时明确写“无原文证据”。
不得补造事实，不得给出新的诊断、处方或治疗决策。所有结论仅供医生复核参考。`
}
