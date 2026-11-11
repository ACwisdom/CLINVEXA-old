import { describe, expect, it } from 'vitest'

import { pcmWav } from './pcm-recorder'

describe('independently decodable consultation audio', () => {
  it('encodes complete mono PCM headers and clamps clipping without wrapping', async () => {
    const blob = pcmWav(new Float32Array([-2, -1, 0, 1, 2]), 16000)

    const bytes = await new Promise<ArrayBuffer>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.readAsArrayBuffer(blob)
    })

    const view = new DataView(bytes)
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(40, true)).toBe(10)
    expect([0, 1, 2, 3, 4].map(i => view.getInt16(44 + i * 2, true))).toEqual([-32768, -32768, 0, 32767, 32767])
  })
})
