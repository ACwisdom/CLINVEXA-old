import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {extractAll, createPackageWithOptions} from '@electron/asar'

const desktop = path.resolve(import.meta.dirname, '..')
const repo = path.resolve(desktop, '../..')
const output = path.resolve(repo, '../.codex-work/visual-repair-20260919/hotfix')
const installed = path.join(process.env.LOCALAPPDATA, 'Programs/CLINVEXA/resources')
fs.mkdirSync(output, {recursive:true})
const extracted = path.join(output, 'application')
if (!fs.existsSync(extracted)) extractAll(path.join(installed, 'app.asar'), extracted)
// Preserve installed native modules and replace built application code plus the
// visual backend. No engines, models, user settings or data are removed.
fs.cpSync(path.join(desktop, 'dist'), path.join(extracted, 'dist'), {recursive:true})
await createPackageWithOptions(extracted, path.join(output, 'app.asar'), {unpackDir:'dist'})
fs.copyFileSync(path.join(repo, 'hermes_cli/clinvexa_copilot.py'), path.join(output, 'clinvexa_copilot.py'))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({
  fix:'visual-25-fields-20260919', baseVersion:'2.0.4',
  appAsar:hash(path.join(output, 'app.asar')),
  visualBackend:hash(path.join(output, 'clinvexa_copilot.py')),
  preparedAt:new Date().toISOString()
}, null, 2))
console.log(output)
