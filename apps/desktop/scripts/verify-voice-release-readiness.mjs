import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'

const root = process.env.CLINVEXA_RELEASE_DIR || path.resolve(import.meta.dirname,'../../../../.codex-work/voice-repair-20260918')
const cleanRoot = process.env.CLINVEXA_VERIFIED_INSTALL_ROOT
assert.ok(cleanRoot, 'Specify the isolated installed runtime verification directory')
const read = (base,name) => JSON.parse(fs.readFileSync(path.join(base,name),'utf8'))
const stage = read(root,'stage-result.json')
const fresh = read(cleanRoot,'verification-result.json')
const engines = read(cleanRoot,'runtime-engines.json')
const voice = read(root,'native-packaged/result.json')
const visual = read(root,'visual-his-final/result.json')
const mentions = read(root,'mentions-final/native-result.json')
assert.ok(stage.originalResourcesPreserved)
assert.ok(fresh.passed && engines.passed && engines.checks.length===13 && engines.checks.every(row=>row.passed))
assert.ok(voice.passed && voice.version===stage.version)
for (const name of ['continuous-recording-one-minute','real-transcript-to-structured-ai-draft','summon-floating-ball-hidden','summon-floating-ball-outside-display','summon-floating-ball-closed','summoned-ball-is-interactive']) assert.ok(voice.steps.some(row=>row.name===name),name)
assert.ok(visual.passed && visual.performancePassed && visual.version===stage.version)
assert.ok(visual.timings.length>=3 && visual.timings.every(row=>row.wallMs<=10000))
assert.ok(mentions.passed && mentions.packaged)
const installedVoice = read(cleanRoot,'runtime/.clinvexa-live-voice.json')
const manifestPath = path.join(stage.source,'resources/clinvexa-dependencies/clinvexa-live-voice/manifest.json')
assert.equal(installedVoice.manifest,crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex'))
assert.equal(installedVoice.decodeChecks.filter(row=>row.decoded).length,4)
assert.equal(installedVoice.documentChecks.length,7)
const result = {passed:true,version:stage.version,cleanRoot,checkedAt:new Date().toISOString(),
  sourceManifestSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'installer-manifest.json'))).digest('hex'),
  checks:['isolated-offline-installation','13-installed-tool-engine-groups','native-recording-and-draft','floating-ball-recovery','three-visual-deliveries-under-ten-seconds','focused-HIS-fill','mentions-and-workspace-navigation']}
fs.writeFileSync(path.join(root,'release-readiness.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
