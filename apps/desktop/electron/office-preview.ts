import fs from 'node:fs'
import path from 'node:path'

import { strFromU8, unzipSync } from 'fflate'

const DOCX_DOCUMENT_XML = 'word/document.xml'
const XLSX_SHARED_STRINGS_XML = 'xl/sharedStrings.xml'
const XLSX_WORKSHEET_PREFIX = 'xl/worksheets/sheet'

const OFFICE_PREVIEW_EXTENSIONS = new Set(['.docx', '.xlsx'])

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&apos;': "'",
  '&gt;': '>',
  '&lt;': '<',
  '&quot;': '"'
}

export function isOfficePreviewPath(filePath: string): boolean {
  return OFFICE_PREVIEW_EXTENSIONS.has(path.extname(filePath || '').toLowerCase())
}

export function readOfficePreviewTextFromBuffer(buffer: Uint8Array, extension: string): string | null {
  const ext = extension.toLowerCase()
  const entries = unzipSync(buffer)

  if (ext === '.docx') {
    const documentXml = entries[DOCX_DOCUMENT_XML]

    return documentXml ? wordXmlToText(strFromU8(documentXml)) : ''
  }

  if (ext === '.xlsx') {
    return workbookToText(entries)
  }

  return null
}

export async function readOfficePreviewText(filePath: string): Promise<string | null> {
  if (!isOfficePreviewPath(filePath)) {
    return null
  }

  const buffer = await fs.promises.readFile(filePath)
  return readOfficePreviewTextFromBuffer(buffer, path.extname(filePath).toLowerCase())
}

function workbookToText(entries: Record<string, Uint8Array>): string {
  const sharedStrings = parseSharedStrings(entries[XLSX_SHARED_STRINGS_XML])
  const worksheets = Object.entries(entries)
    .filter(([name]) => name.startsWith(XLSX_WORKSHEET_PREFIX) && name.endsWith('.xml'))
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))

  return worksheets
    .map(([name, bytes], index) => {
      const rows = worksheetXmlToRows(strFromU8(bytes), sharedStrings)
      const body = rows.map(row => row.join('\t')).join('\n')
      const label = worksheetLabel(name, index)

      return body ? `${label}\n${body}` : label
    })
    .join('\n\n')
    .trim()
}

function parseSharedStrings(bytes?: Uint8Array): string[] {
  if (!bytes) {
    return []
  }

  const xml = strFromU8(bytes)
  const values: string[] = []

  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    values.push(xmlRichTextToText(match[1] || ''))
  }

  return values
}

function worksheetXmlToRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = []

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = []

    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] || ''
      const body = cellMatch[2] || ''
      const colIndex = columnIndex(cellReference(attrs))
      const value = cellValue(attrs, body, sharedStrings)

      while (row.length < colIndex) {
        row.push('')
      }

      row[colIndex] = value
    }

    rows.push(trimTrailingEmpty(row))
  }

  return rows.filter(row => row.some(value => value.trim()))
}

function worksheetLabel(name: string, index: number): string {
  const fallback = `工作表 ${index + 1}`
  const match = /sheet(\d+)\.xml$/i.exec(name)

  return match ? `工作表 ${match[1]}` : fallback
}

function cellReference(attrs: string): string {
  return /(?:^|\s)r="([^"]+)"/.exec(attrs)?.[1] || ''
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() || 'A'
  let value = 0

  for (const letter of letters) {
    value = value * 26 + letter.charCodeAt(0) - 64
  }

  return Math.max(0, value - 1)
}

function cellValue(attrs: string, body: string, sharedStrings: string[]): string {
  const type = /(?:^|\s)t="([^"]+)"/.exec(attrs)?.[1] || ''

  if (type === 'inlineStr') {
    return xmlRichTextToText(body)
  }

  const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] || ''

  if (type === 's') {
    const index = Number.parseInt(raw, 10)

    return Number.isFinite(index) ? sharedStrings[index] || '' : ''
  }

  return decodeXmlText(raw)
}

function xmlRichTextToText(xml: string): string {
  return decodeXmlText(
    Array.from(xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
      .map(match => match[1] || '')
      .join('')
  )
}

function trimTrailingEmpty(row: string[]): string[] {
  let end = row.length

  while (end > 0 && !row[end - 1].trim()) {
    end -= 1
  }

  return row.slice(0, end)
}

function wordXmlToText(xml: string): string {
  return decodeXmlText(
    xml.replace(/<w:tab\s*\/>/g, '\t').replace(/<w:br\s*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeXmlText(text: string): string {
  return text.replace(/&(amp|apos|gt|lt|quot);/g, entity => XML_ENTITIES[entity] || entity)
}
