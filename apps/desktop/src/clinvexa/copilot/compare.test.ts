import { describe, expect, it } from 'vitest'

import { mergeSelectedUpdates } from './compare'
import type { CopilotSuggestion } from './types'
import { resultDraft } from './workbench'

describe('doctor draft update isolation', () => {
  it('updates selected fields and preserves unselected manual content', () => {
    const original = '主诉\n医生保留的主诉\n\n辅助检查\n旧报告\n\n现病史\n医生修订的现病史'
    const update = {title:'辅助检查',text:'新报告：合成数值'} as CopilotSuggestion
    const merged = mergeSelectedUpdates(original, [update], {'辅助检查':'旧报告'})
    expect(merged).toContain('医生保留的主诉')
    expect(merged).toContain('医生修订的现病史')
    expect(merged).toContain('新报告：合成数值')
    expect(merged).not.toContain('旧报告')
  })
  it('appends an unmatched heading without deleting the freeform draft', () => {
    expect(mergeSelectedUpdates('医生自定义文字', [{title:'辅助检查',text:'新报告'} as CopilotSuggestion], {})).toBe('医生自定义文字\n\n辅助检查\n新报告')
  })
  it('preserves custom headings and trailing notes and appends when a doctor changed original text', () => {
    const source = '辅助检查\n旧报告\n\n医生备注\n需电话随访\n'
    const update = {title:'辅助检查',text:'新报告'} as CopilotSuggestion
    expect(mergeSelectedUpdates(source,[update],{'辅助检查':'旧报告'})).toContain('新报告\n\n医生备注\n需电话随访')
    expect(mergeSelectedUpdates(source.replace('旧报告','医生改写报告'),[update],{'辅助检查':'旧报告'})).toContain('医生改写报告\n\n医生备注\n需电话随访')
  })
  it('preserves an intentionally saved empty draft', () => {
    expect(resultDraft({draft:'',revision:1,summary:'AI内容',suggestions:[]})).toBe('')
  })
})
