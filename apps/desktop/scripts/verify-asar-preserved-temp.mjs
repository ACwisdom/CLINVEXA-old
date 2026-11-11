import {listPackage,extractFile,statFile} from '@electron/asar';
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const base='D:/N260 Hermes+CLINVEXA/';
const old=base+'hermes-agent-main/apps/desktop/release-copilot-v20/win-unpacked/resources/app.asar';
const now=base+'.codex-work/installer-20260917/release-source-kncube/resources/app.asar';
const names=a=>listPackage(a).map(p=>p.replace(/^[/\\]/,'').replaceAll('\\','/')).sort();
assert.ok(names(old).every(p=>names(now).includes(p))); assert.deepEqual(names(now).filter(p=>!names(old).includes(p)), ['dist/kncube-branding.css','public/kncube-branding.css']);
const icon=/(?:icon\.(?:png|ico|icns)|apple-touch-icon\.png|nous-girl\.jpg|hermes(?:-sprite|-frame-\d+)?\.png)$/;
let unchanged=0,changes=[];
for(const p of names(old)){if(typeof statFile(old,p.replaceAll('/',String.fromCharCode(92))).size!=='number')continue;const sha=b=>crypto.createHash('sha256').update(b).digest('hex');if(sha(extractFile(old,p.replaceAll('/',String.fromCharCode(92))))===sha(extractFile(now,p.replaceAll('/',String.fromCharCode(92))))){unchanged++;continue}if(p==='package.json'){const before=JSON.parse(extractFile(old,p));const after=JSON.parse(extractFile(now,p));assert.equal(after.version,'2.0.1');after.version=before.version;assert.deepEqual(after,before)}else assert.ok(icon.test(p)||p==='dist/electron-main.mjs'||p==='dist/index.html','Unexpected application change: '+p);changes.push(p)}
const result={passed:true,unchangedApplicationFiles:unchanged,changedFiles:changes};fs.writeFileSync(base+'.codex-work/installer-20260917/asar-preservation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));


