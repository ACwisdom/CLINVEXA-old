import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
const workspace=path.resolve(import.meta.dirname,'../../../..')
const root='C:/Users/home/AppData/Local/Temp/clinvexa-release-20260921'
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'))
const meta=read('release-metadata.json')
assert.ok(read('installer-verification.json').passed && read('online-verification.json').passed && read('blue-robot-native-icons.json').passed)
const output=path.join(workspace,'CLINVEXA_最新版安装包')
const backup=path.join(workspace,'.codex-backups/clinvexa-installers-before-20260921')
fs.mkdirSync(backup,{recursive:true})
for(const [kind,name] of [['offline','CLINVEXA-全功能离线安装包.exe'],['online','CLINVEXA-轻量在线安装包.exe']]){
  const dest=path.join(output,name)
  if(fs.existsSync(dest)&&!fs.existsSync(path.join(backup,name)))fs.copyFileSync(dest,path.join(backup,name))
  fs.copyFileSync(meta[kind].file,dest+'.new')
  const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(dest+'.new'))h.update(chunk)
  assert.equal(h.digest('hex'),meta[kind].sha256)
  fs.renameSync(dest+'.new',dest)
}
const onlineUrl=meta.offline.url.replace('Offline-Setup','Online-Setup')
fs.writeFileSync(path.join(workspace,'CLINVEXA_双版本安装说明.md'),`# CLINVEXA 2.0.5 · 2026-09-21

两款安装包安装后的版本、功能和本地引擎一致，应用及安装包使用小蓝机器人图标。

| 安装包 | 大小 | 安装联网要求 | 适用情况 |
| --- | --- | --- | --- |
| 全功能离线安装包 | ${(meta.offline.bytes/1024**3).toFixed(2)} GiB | 无需联网下载依赖 | 内网、网络不稳定、多机部署 |
| 轻量在线安装包（推荐） | ${meta.online.bytes/1024} KiB | 自动下载约 ${(meta.offline.bytes/1024**3).toFixed(2)} GiB 完整资源 | 网络稳定的电脑 |

无需手工安装 Python、识别引擎或模型。建议预留 20 GB 空间。离线指安装及已内置的本地功能；云端 AI 分析、平台智能体同步仍需网络与有效账号或模型配置。安装包不包含个人密钥。

## 本次更新

在 2.0.4 已打包引擎与资源的基础上，纳入 9 月 19 日视觉修复：识别、选择、复制与快捷填写最多 25 项；超过上限明确提示分段读取，不静默截断；历史结果与当前读取错误分开展示。

## 已执行验证及边界

- 保留原版全部资源，未改动引擎和模型；实际隔离安装后核对 5,658 个文件的清单、大小及 SHA-256。
- 视觉后端 25 项测试、桌面端 17 项相关测试、平台下载区 3 项测试通过。
- 两款安装包及应用的 7 个图标尺寸全部匹配小蓝机器人。
- 公网下载、Range 请求、在线安装下载器续传及完整 SHA-256 校验通过。
- 本次是安装包和下载入口发布验收，不代表重新完成所有医疗功能与所有方言准确率验收；复杂病历的视觉分析 10 秒目标尚未全面达成。

## 下载与校验

[全功能离线安装包](${meta.offline.url})

[轻量在线安装包](${onlineUrl})

离线 SHA-256：\`${meta.offline.sha256}\`

在线 SHA-256：\`${meta.online.sha256}\`

平台入口：我的智能体专科 → AI应用桌面助手 → 下载与安装。
`)
const evidence=path.join(workspace,'.codex-work/platform-downloads-20260921')
fs.mkdirSync(evidence,{recursive:true})
for(const entry of fs.readdirSync(root)){if(/\.(json|log)$/.test(entry))fs.copyFileSync(path.join(root,entry),path.join(evidence,entry))}
console.log(JSON.stringify({output,evidence,version:'2.0.5'}))
