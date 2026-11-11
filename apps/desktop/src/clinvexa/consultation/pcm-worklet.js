/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// Keep capture off the renderer thread; every message is a complete PCM segment.
class ConsultationPCM extends AudioWorkletProcessor {
  constructor() {
    super()
    this.samples = new Float32Array(sampleRate * 6)
    this.length = 0
    this.quiet = 0
    this.speech = false
    this.paused = false
    this.port.onmessage = ({ data }) => {
      if (data === 'pause' || data === 'flush') this.flush()
      if (data === 'pause') this.paused = true
      if (data === 'resume') this.paused = false
      if (data === 'flush') this.port.postMessage({ flushed: true })
    }
  }
  flush() {
    if (!this.length) return
    const samples = this.samples.slice(0, this.length)
    this.port.postMessage({ samples, sampleRate }, [samples.buffer])
    this.length = 0
    this.quiet = 0
    this.speech = false
  }
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel || this.paused) return true
    // Decide silence over an audio frame, not consecutive individual samples:
    // background noise and waveform zero crossings made the old endpoint brittle.
    const rms = Math.sqrt(channel.reduce((sum, value) => sum + value * value, 0) / channel.length)
    if (rms >= 0.003) this.speech = true
    this.quiet = rms < 0.003 ? this.quiet + channel.length : 0
    for (const value of channel) {
      this.samples[this.length++] = value
      if (this.length === this.samples.length) this.flush()
    }
    // Prefer phrase boundaries; a six-second ceiling bounds first-result delay.
    if (this.speech && this.length >= sampleRate * 0.8 && this.quiet >= sampleRate * 0.4) this.flush()
    return true
  }
}
registerProcessor('clinvexa-consultation-pcm', ConsultationPCM)
