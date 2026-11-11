import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { _electron as electron } from 'playwright'
import { listPackage, extractFile, statFile } from '@electron/asar'

const desktop = path.resolve(import.meta.dirname,'..')
const evidence = path.resolve(desktop,'../../../.codex-work/installer-20260917')
const source = process.argv[2] ? path.resolve(process.argv[2]) : path.join(evidence,'release-source-kncube')
const archive = path.join(source,'resources/app.asar')
const oldArchive = path.join(desktop,'release-copilot-v20/win-unpacked/resources/app.asar')
const imagePattern = /(?:icon\.(?:png|ico|icns)|apple-touch-icon\.png|nous-girl\.jpg|hermes(?:-sprite|-frame-\d+)?\.png)$/
const sha = data => crypto.createHash('sha256').update(data).digest('hex')
const old = new Set(listPackage(oldArchive).filter(p=>imagePattern.test(p)).map(p=>sha(extractFile(oldArchive,p.replace(/^[/\\]/,'')))))
const icons = listPackage(archive).filter(p=>imagePattern.test(p))
assert.ok(icons.length >= 15)
for(const icon of icons) assert.ok(!old.has(sha(extractFile(archive,icon.replace(/^[/\\]/,'')))),`Old icon remains: ${icon}`)
const expectedPng=fs.readFileSync(path.join(desktop,'assets/icon.png'))
for(const icon of icons.filter(p=>p.endsWith('.png'))) assert.equal(sha(extractFile(archive,icon.replace(/^[/\\]/,''))),sha(expectedPng),`Icon does not match latest supplied artwork: ${icon}`)
assert.equal(JSON.parse(extractFile(archive,'package.json')).version,'2.0.1')
assert.equal(statFile(archive,'dist/electron-main.mjs').unpacked,true)
const runtime = path.join(evidence,'final-fresh-boot/runtime')
const log = path.join(runtime,'logs/desktop.log')
const before = fs.existsSync(log)?fs.readFileSync(log,'utf8').length:0
const env={...process.env,CLINVEXA_PRODUCT_IDENTITY:'1',HERMES_HOME:runtime,CLINVEXA_RUNTIME_HOME:runtime,HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_SKIP_QUIT_CONFIRM:'1',HERMES_DESKTOP_USER_DATA_DIR:path.join(evidence,'kncube-smoke-profile')}
for(const key of Object.keys(env)) if(/(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key)||['ELECTRON_RUN_AS_NODE','HERMES_DESKTOP_PYTHON','HERMES_DESKTOP_HERMES_ROOT','HERMES_GIT_BASH_PATH'].includes(key)) delete env[key]
let app
try {
  app=await electron.launch({executablePath:path.join(source,'CLINVEXA.exe'),env,timeout:120000})
  let ready=false
  for(let i=0;i<120;i++) {
    const text=fs.readFileSync(log,'utf8').slice(before)
    if(text.includes('CLINVEXA backend is ready')) {ready=true;break}
    await new Promise(r=>setTimeout(r,1000))
  }
  assert.ok(ready,'The branded packaged application must really start its backend')
  const icon=await app.evaluate(async ({app})=>(await app.getFileIcon(process.execPath,{size:'large'})).toPNG().toString('base64'))
  fs.writeFileSync(path.join(evidence,'installed-exe-icon.png'),Buffer.from(icon,'base64'))
  await app.windows().find(page => !page.url().includes('win=clinvexa')).evaluate(() => window.hermesDesktop.CLINVEXACopilot.setExpanded(false))
  let floating
  for (let attempt = 0; attempt < 40; attempt++) {
    floating = app.windows().find(page => page.url().includes('win=clinvexa'))
    if (floating && await floating.locator('button[aria-expanded][class~="size-12"]').count()) break
    await new Promise(resolve => setTimeout(resolve,500))
  }
  assert.ok(floating,'Floating entry must open')
  const pages=app.windows()
  if (floating) {
    const trigger = floating.locator('button[aria-expanded][class~="size-12"]')
    if (await trigger.count()) {
      const brand = await trigger.evaluate(button => ({ image: getComputedStyle(button, '::before').backgroundImage, oldSymbol: getComputedStyle(button.querySelector('svg')).visibility }))
      assert.ok(brand.image.includes('apple-touch-icon.png'), 'Floating entry must use the KNCUBE asset')
      assert.equal(brand.oldSymbol,'hidden')
      await floating.screenshot({path:path.join(evidence,'kncube-floating-entry.png')})
      await trigger.click()
      await floating.locator('.dc-brand').waitFor()
      const headerBrand = await floating.locator('.dc-brand').evaluate(node => ({ image:getComputedStyle(node,'::before').backgroundImage, oldSymbol:getComputedStyle(node.querySelector('svg')).display }))
      assert.ok(headerBrand.image.includes('apple-touch-icon.png'))
      assert.equal(headerBrand.oldSymbol,'none')
      await floating.screenshot({path:path.join(evidence,'kncube-copilot-panel.png')})
    }
  }
  let main
  for(const page of pages) { const size=page.viewportSize(); if(size && size.width>600) main=page }
  if(!main) main=pages.at(-1)
  await main.screenshot({path:path.join(evidence,'branded-app-smoke.png')})
  const result={passed:true,source,iconResourcesVerified:icons.length,backendReady:true,asarUnpackedMain:true}
  fs.writeFileSync(path.join(evidence,'branding-verification.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
} finally {if(app)await app.close()}
