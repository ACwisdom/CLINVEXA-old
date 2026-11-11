import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'

const root=process.env.CLINVEXA_RELEASE_DIR
assert.ok(root,'Explicit release directory required')
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'))
const meta=read('release-metadata.json'), stage=read('stage-result.json')
const install=read('installer-verification.json'), skills=read('skill-runtime-verification.json')
const online=read('online-verification.json')
const ui=read('native-ui-verification.json')
assert.ok(install.passed && skills.passed && online.passed && read('blue-robot-native-icons.json').passed)
assert.ok(ui.passed && ui.workbookRows===1 && ui.workbookSheets===1,'A real installed desktop Skill task must generate a verified workbook')
assert.equal(ui.installerSha256,meta.offline.sha256)
assert.equal(skills.installerSha256,meta.offline.sha256)
assert.equal(online.offlineSha256,meta.offline.sha256)
assert.equal(online.onlineSha256,meta.online.sha256)
const hash=async file=>{const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex')}
for(const kind of ['offline','online']) assert.equal(await hash(meta[kind].file),meta[kind].sha256)
const workspace=path.resolve(import.meta.dirname,'../../../..')
const output=path.join(workspace,'CLINVEXA_最新版安装包')
const backup=path.join(root,'previous-delivery')
fs.mkdirSync(output,{recursive:true});fs.mkdirSync(backup,{recursive:true})
for(const [kind,name] of [['offline','CLINVEXA-全功能离线安装包.exe'],['online','CLINVEXA-轻量在线安装包.exe']]) {
 const dest=path.join(output,name)
 if(fs.existsSync(dest)&&!fs.existsSync(path.join(backup,name))) fs.copyFileSync(dest,path.join(backup,name))
 fs.copyFileSync(meta[kind].file,dest+'.new')
 assert.equal(await hash(dest+'.new'),meta[kind].sha256)
 fs.renameSync(dest+'.new',dest)
}
const latest={version:stage.version,publishedAt:'2026-10-06'}
for(const kind of ['offline','online']) latest[kind]={url:new URL(kind==='offline'?online.offlineUrl:online.onlineUrl).pathname,bytes:meta[kind].bytes,sha256:meta[kind].sha256}
const manifest=path.join(root,'latest.json')
fs.writeFileSync(manifest,JSON.stringify(latest,null,2))
const host='ubuntu@43.138.188.149'
const options=['-i',path.join(process.env.USERPROFILE,'.ssh/id_rsa_deploy'),'-o','BatchMode=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2']
const remote='/home/ubuntu/clinvexa-latest-skills-20261006.json'
execFileSync('scp',['-q',...options,manifest,host+':'+remote],{windowsHide:true,stdio:'inherit'})
// Both immutable downloads have been exercised before switching the index.
execFileSync('ssh',[...options,host,`set -eu\nsudo -n cp '/opt/medical-ai-platform/install APPS/clinvexa/latest.json' '/opt/medical-ai-platform/install APPS/clinvexa/latest.before-skills-20261006.json'\nsudo -n install -m 644 '${remote}' '/opt/medical-ai-platform/install APPS/clinvexa/latest.json.new'\nsudo -n mv '/opt/medical-ai-platform/install APPS/clinvexa/latest.json.new' '/opt/medical-ai-platform/install APPS/clinvexa/latest.json'`],{windowsHide:true,stdio:'inherit'})
const response=await fetch('https://ai.keningcube.com/install-apps/clinvexa/latest.json?verify=20261006-skills',{cache:'no-store'})
assert.equal(response.status,200)
assert.deepEqual(await response.json(),latest)
const guide=path.join(workspace,'CLINVEXA_双版本安装说明.md')
fs.writeFileSync(guide,`# CLINVEXA ${stage.version} · 2026-10-06

两款安装包均包含技能调用修复，安装后的功能和引擎一致。

| 安装包 | 大小 | 安装方式 |
| --- | --- | --- |
| 全功能离线安装包 | ${(meta.offline.bytes/1024**3).toFixed(2)} GiB | 内置 Python、技能模块、文档处理依赖和本地语音引擎，无需联网下载依赖 |
| 轻量在线安装包 | ${(meta.online.bytes/1024).toFixed(0)} KiB | 联网自动下载经过相同验收的完整安装包，支持续传并校验 SHA-256 |

首次启动自动准备本地运行环境，无需用户手动安装 Python 或技能模块。通过聊天召唤技能时，云端模型仍需网络及有效模型配置；安装包不含个人密钥。

## 本次修复与实际验收

- 修复聊天 Python 环境无法导入 clinvexa.deterministic_skills；首次安装和后续启动均检查并离线修复。
- 修复安装时误选系统 Anaconda/Python；安装环境明确绑定包内 Python，缺失时拒绝以外部环境替代。
- 实际安装包解包后，逐文件核对 ${install.files} 项大小与 SHA-256。
- 全新运行目录禁止联网下载依赖，使用包内 Python 和依赖完成初始化。
- ${skills.skills.catalogSkills} 个本机技能完成安装及调用指令检查；病历结构化、门诊病历草稿、随访计划的两种入口共 6 项真实文件处理通过。
- Word、Excel、PDF 三种输入格式的批量病历结构化通过，输出逐行核对。
- 从本次安装包实际安装的桌面版本中召唤病历结构化，处理合成文件并生成 Excel；工作表与数据行实际核验通过。
- 在线下载器的 8 项恢复与完整性检查通过；正式 HTTPS 下载、续传和完整文件 SHA-256 通过。
- 应用与两种安装程序的小蓝机器人图标校验通过。
- 测试附件与浏览器会话缓存已从分发资源排除。功能代码、引擎和模型保留。

本次覆盖安装与技能调用链路；不代表对任意第三方技能、模型回答质量或全部医院环境作无条件保证。

## 下载

[全功能离线安装包](${online.offlineUrl})

[轻量在线安装包](${online.onlineUrl})

离线 SHA-256：\`${meta.offline.sha256}\`

在线 SHA-256：\`${meta.online.sha256}\`
`)
fs.writeFileSync(path.join(root,'delivery-result.json'),JSON.stringify({version:stage.version,output,guide,latest,platformIndexVerified:true},null,2))
console.log(JSON.stringify({version:stage.version,output,platformIndexVerified:true}))
