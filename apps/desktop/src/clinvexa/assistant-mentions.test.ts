import { describe, expect, it } from 'vitest'

import { assistantMention, hasAssistantMention, resolveAssistantMention } from './assistant-mentions'
import type { SummonedAssistant } from './summon'

const local: SummonedAssistant = { id: 'record-structuring', name: '病历结构化', source: 'local', description: '' }
const platform: SummonedAssistant = {
  id: 'meeting',
  name: '会议助手',
  source: 'platform',
  description: '',
  account: 'owner'
}
const catalog = [local, platform]
describe('assistant mentions', () => {
  it('resolves Chinese names, IDs and inline mentions without changing the surrounding task', () => {
    expect(resolveAssistantMention('@病历结构化 请处理附件', catalog)).toEqual({ assistant: local, task: '请处理附件' })
    expect(resolveAssistantMention('请用 @record-structuring 整理上述资料', catalog)).toEqual({
      assistant: local,
      task: '请用  整理上述资料'
    })
    expect(resolveAssistantMention('@会议助手 整理上文', catalog).assistant).toBe(platform)
  })
  it('leaves email addresses, native references and ordinary prose alone', () => {
    for (const text of [
      'email@病历结构化',
      '@file:report.txt 整理',
      '@file:`资料 @病历结构化 副本.txt`',
      '@diff',
      '向 @同事 说明结果'
    ]) {
      expect(resolveAssistantMention(text, catalog)).toEqual({ assistant: undefined, task: text })
      expect(hasAssistantMention(text, catalog)).toBe(false)
    }
  })
  it('quotes names with spaces and disambiguates duplicate names by source and id', () => {
    const spaced = { ...local, name: 'Skill 创建器' }
    expect(resolveAssistantMention(`${assistantMention(spaced, [spaced])} 创建技能`, [spaced]).assistant).toBe(spaced)
    const duplicate = { ...platform, name: local.name }
    expect(() => resolveAssistantMention('@病历结构化 任务', [local, duplicate])).toThrow('同名')
    expect(
      resolveAssistantMention(`${assistantMention(duplicate, [local, duplicate])} 任务`, [local, duplicate]).assistant
    ).toBe(duplicate)
  })
  it('rejects unknown explicit calls and multiple different assistants instead of silently sending generic chat', () => {
    expect(() => resolveAssistantMention('@不存在 任务', catalog)).toThrow('未找到')
    expect(() => resolveAssistantMention('@病历结构化 @会议助手 任务', catalog)).toThrow('一位助手')
    expect(resolveAssistantMention('@病历结构化 @record-structuring 任务', catalog).task).toBe('任务')
  })
})
