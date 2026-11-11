import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const workspace = path.resolve(import.meta.dirname, '../../../..')
const evidence = path.join(workspace, '.codex-work/voice-repair-20260918')
const bundle = path.join(evidence, 'clinvexa-live-voice')
fs.mkdirSync(bundle, { recursive: true })
fs.cpSync(path.join(workspace, '.clinvexa-copilot-runtime/models/clinvexa-live'), path.join(bundle, 'models/clinvexa-live'), { recursive: true })
fs.cpSync(path.join(evidence, 'wheelhouse'), path.join(bundle, 'wheelhouse'), { recursive: true })
fs.cpSync(path.join(evidence, 'office-wheelhouse'), path.join(bundle, 'wheelhouse'), { recursive: true })
fs.copyFileSync(path.join(workspace, '.codex-work/copilot-v12-packaged-acceptance/run-euzdv6/home/hermes-agent/artifacts/voice-test/simplified-chinese-medical.wav'), path.join(bundle, 'smoke.wav'))
const files = []
async function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(file)
    else if (file !== path.join(bundle, 'manifest.json')) {
      const hash = crypto.createHash('sha256')
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
      files.push({ path: path.relative(bundle, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size, sha256: hash.digest('hex') })
    }
  }
}
await walk(bundle)
const requirements = ['sherpa-onnx==1.13.4', 'numpy==2.4.6', 'pypdf==6.19.0', 'python-docx==1.2.0',
  'openpyxl==3.1.5', 'python-pptx==1.0.2', 'pandas==3.0.6', 'reportlab==5.0.1', 'pdfplumber==0.11.10', 'setuptools==84.0.0']
fs.writeFileSync(path.join(bundle, 'manifest.json'), JSON.stringify({ schemaVersion: 2, python: 'cp311-win_amd64', sherpa: '1.13.4', requirements, files }, null, 2))
console.log(JSON.stringify({ bundle, files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0) }))
