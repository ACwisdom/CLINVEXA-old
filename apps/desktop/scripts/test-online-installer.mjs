import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'

const source = path.join(import.meta.dirname, 'online-installer')
const root = path.resolve(import.meta.dirname, '../../../../.codex-work/installer-20260917/download-tests')
fs.mkdirSync(root, { recursive: true })
const compiler = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
const exe = path.join(root, 'TestDownload.exe')
execFileSync(compiler, ['/nologo', `/out:${exe}`, path.join(source, 'Download.cs'), path.join(source, 'TestDownload.cs')], { windowsHide: true })
const payload = crypto.randomBytes(1024 * 1024)
const hash = crypto.createHash('sha256').update(payload).digest('hex')
const file = path.join(root, 'payload.exe')
let hits = 0, range = null
const server = http.createServer((req, res) => {
  hits++; range = req.headers.range
  if (req.url === '/fail') { res.writeHead(503).end(); return }
  const start = req.url === '/ignore-range' ? 0 : Number(range?.match(/bytes=(\d+)-/)?.[1] || 0)
  const data = req.url === '/corrupt' ? Buffer.alloc(payload.length, 0) : payload
  const headers = { 'Content-Length': data.length - start }
  if (start) headers['Content-Range'] = `bytes ${req.url === '/bad-range' ? start + 1 : start}-${data.length - 1}/${data.length}`
  res.writeHead(start ? 206 : 200, headers)
  res.end(data.subarray(start))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
async function run(route, extra = []) {
  return new Promise(resolve => {
    const child = spawn(exe, [base + route, file, String(payload.length), hash, ...extra], { windowsHide: true })
    let output = ''; child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
    child.on('exit', code => resolve({ code, output }))
  })
}
function clear() { for (const name of [file, file + '.part']) if (fs.existsSync(name)) fs.unlinkSync(name) }
const results = []
async function check(name, action) { await action(); results.push({ name, passed: true }); console.log(`PASS ${name}`) }
try {
  await check('full download and SHA256 verification', async () => { clear(); assert.equal((await run('/ok')).code, 0); assert.deepEqual(fs.readFileSync(file),payload) })
  await check('verified cache avoids network', async () => { const previous = hits; assert.equal((await run('/fail')).code,0); assert.equal(hits,previous) })
  await check('resume partial download', async () => { clear(); fs.writeFileSync(file+'.part',payload.subarray(0,65432)); assert.equal((await run('/ok')).code,0); assert.equal(range,'bytes=65432-') })
  await check('server without range restarts safely', async () => { clear(); fs.writeFileSync(file+'.part',payload.subarray(0,98765)); assert.equal((await run('/ignore-range')).code,0); assert.deepEqual(fs.readFileSync(file),payload) })
  await check('corrupted payload cannot become executable', async () => { clear(); assert.equal((await run('/corrupt')).code,1); assert.equal(fs.existsSync(file),false); assert.equal(fs.existsSync(file+'.part'),false) })
  await check('mismatched Content-Range is rejected', async () => { clear(); fs.writeFileSync(file+'.part',payload.subarray(0,123)); assert.equal((await run('/bad-range')).code,1); assert.equal(fs.existsSync(file),false) })
  await check('network failure preserves resume data', async () => { clear(); fs.writeFileSync(file+'.part',payload.subarray(0,321)); assert.equal((await run('/fail')).code,1); assert.equal(fs.statSync(file+'.part').size,321); assert.equal((await run('/ok')).code,0) })
  await check('cancel never promotes incomplete installer', async () => { clear(); assert.equal((await run('/ok',['262144'])).code,1); assert.equal(fs.existsSync(file),false); assert.equal((await run('/ok')).code,0) })
  fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(results,null,2))
} finally { server.close() }
