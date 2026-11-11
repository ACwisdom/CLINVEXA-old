import workletUrl from './pcm-worklet.js?url'

export function pcmWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const word = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
  word(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  word(36, 'data'); view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)), true))

  return new Blob([buffer], { type: 'audio/wav' })
}

/** One uninterrupted stream, independent WAV packets; pause and finish flush the tail. */
export class ConsultationPCMRecorder {
  private context?: AudioContext
  private stream?: MediaStream
  private node?: AudioWorkletNode
  private flushed?: () => void

  async start(onSegment: (audio: Blob) => void, onError: (error: Error) => void): Promise<void> {
    if (this.context) {throw new Error('Recording is already active')}

    if (await window.hermesDesktop?.requestMicrophoneAccess?.() === false) {throw new Error('麦克风权限未开启')}

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      this.context = new AudioContext({ sampleRate: 16000 })
      await this.context.audioWorklet.addModule(workletUrl)
      this.node = new AudioWorkletNode(this.context, 'clinvexa-consultation-pcm')

      this.node.port.onmessage = ({ data }) => {
        if (data.flushed) {this.flushed?.();

 return}

        onSegment(pcmWav(data.samples, data.sampleRate))
      }

      this.node.onprocessorerror = () => onError(new Error('音频采集已中断，请保留当前记录后重新开始'))
      this.stream.getAudioTracks().forEach(track => {track.onended = () => onError(new Error('麦克风已断开，已处理记录仍保留'))})
      const source = this.context.createMediaStreamSource(this.stream)
      const muted = this.context.createGain()
      muted.gain.value = 0
      source.connect(this.node).connect(muted).connect(this.context.destination)
      await this.context.resume()
    } catch (error) {
      this.cancel()
      throw error
    }
  }

  pause(): void {this.node?.port.postMessage('pause')}
  resume(): void {this.node?.port.postMessage('resume')}
  async stop(): Promise<void> {
    if (!this.node) {return}
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('音频尾段未能保存，请重试结束录音')), 3000)

        this.flushed = () => {clearTimeout(timer); resolve()}
        this.node!.port.postMessage('pause')
        this.node!.port.postMessage('flush')
    })
    this.cancel()
  }
  cancel(): void {
    this.node?.disconnect()

    if (this.node) {this.node.port.onmessage = null}
    this.node = undefined
    this.stream?.getTracks().forEach(track => {track.onended = null; track.stop()})
    this.stream = undefined
    void this.context?.close()
    this.context = undefined
  }
}
