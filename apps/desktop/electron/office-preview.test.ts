import assert from 'node:assert/strict'

import { strToU8, zipSync } from 'fflate'
import { describe, it } from 'vitest'

import { isOfficePreviewPath, readOfficePreviewTextFromBuffer } from './office-preview'

describe('office-preview', () => {
  it('extracts readable simplified Chinese text from a docx archive', () => {
    const archive = zipSync({
      '[Content_Types].xml': strToU8('<Types />'),
      'word/document.xml': strToU8(
        '<w:document><w:body><w:p><w:r><w:t>主诉：头痛三天</w:t></w:r></w:p><w:p><w:r><w:t>处理：复查血压</w:t></w:r></w:p></w:body></w:document>'
      )
    })

    const text = readOfficePreviewTextFromBuffer(archive, '.docx')

    assert.equal(text, '主诉：头痛三天\n处理：复查血压')
    assert.equal(text?.includes('PK'), false)
  })

  it('extracts readable worksheet rows from an xlsx archive', () => {
    const archive = zipSync({
      '[Content_Types].xml': strToU8('<Types />'),
      'xl/sharedStrings.xml': strToU8(
        '<sst><si><t>姓名</t></si><si><t>诊断</t></si><si><t>张三</t></si><si><t>高血压</t></si></sst>'
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>'
      )
    })

    const text = readOfficePreviewTextFromBuffer(archive, '.xlsx')

    assert.equal(text, '工作表 1\n姓名\t诊断\n张三\t高血压')
    assert.equal(text?.includes('PK'), false)
  })

  it('recognizes Word and Excel Office preview paths', () => {
    assert.equal(isOfficePreviewPath('C:/case/病历.docx'), true)
    assert.equal(isOfficePreviewPath('C:/case/统计.xlsx'), true)
    assert.equal(isOfficePreviewPath('C:/case/简历.pdf'), false)
  })
})
