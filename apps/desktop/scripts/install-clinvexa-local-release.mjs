import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
const evidence=path.resolve(import.meta.dirname,'../../../../.codex-work/installer-20260917')
const install=path.join(process.env.LOCALAPPDATA,'Programs/CLINVEXA')
const meta=JSON.parse(fs.readFileSync(path.join(evidence,'package-result.json'),'utf8'))
assert.equal(JSON.parse(fs.readFileSync(path.join(evidence,'installer-verification.json'),'utf8')).installer,meta.installer)
assert.ok(meta.installer.includes('2.0.1'))
async function run(exe,args){
  const code=await new Promise((resolve,reject)=>{const child=spawn(exe,args,{windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('exit',resolve)})
  assert.equal(code,0,`${path.basename(exe)} exited ${code}`)
}
// User requested removal of the installed old app. Stop only that installation
// and its descendants, preserving all unrelated services and user data.
const stop=String.raw`
$ErrorActionPreference='Stop'
$expected=Join-Path $env:LOCALAPPDATA 'Programs\CLINVEXA\CLINVEXA.exe'
$all=@(Get-CimInstance Win32_Process)
$ids=[Collections.Generic.HashSet[int]]::new()
foreach($p in $all){if($p.ExecutablePath -eq $expected){[void]$ids.Add([int]$p.ProcessId)}}
do{$changed=$false;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)){$changed=$true}}}while($changed)
foreach($id in $ids){Stop-Process -Id $id -ErrorAction SilentlyContinue}
Write-Output ('Stopped installed app process count: '+$ids.Count)
`
execFileSync('powershell.exe',['-NoProfile','-Command',stop],{windowsHide:true,stdio:'inherit'})
const uninstall=path.join(install,'unins000.exe')
if(fs.existsSync(uninstall)){
  console.log('Uninstalling previous registered application; preserving user data.')
  await run(uninstall,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',`/LOG=${path.join(evidence,'v201-remove-previous.log')}`])
}
console.log('Installing verified 2.0.1 payload; exactly one installer process.')
await run(meta.installer,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOCLOSEAPPLICATIONS',`/DIR=${install}`,`/LOG=${path.join(evidence,'v201-local-install.log')}`])
assert.ok(fs.existsSync(path.join(install,'CLINVEXA.exe')))
console.log(JSON.stringify({installed:true,path:install,version:'2.0.1'}))
