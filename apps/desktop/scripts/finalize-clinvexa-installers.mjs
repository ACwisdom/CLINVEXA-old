import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'

const workspace=path.resolve(import.meta.dirname,'../../../..')
const evidence=path.join(workspace,'.codex-work/installer-20260917')
const read=name=>JSON.parse(fs.readFileSync(path.join(evidence,name),'utf8'))
const meta=read('release-metadata.json')
const installed=read('installer-verification.json')
const online=read('online-verification.json')
const branding=read('branding-verification.json')
assert.ok(installed.passed && installed.files===5060)
assert.ok(online.passed && online.offlineSha256===meta.offline.sha256 && online.onlineSha256===meta.online.sha256)
assert.ok(branding.passed && ['installed-payload','CLINVEXA'].includes(path.basename(branding.source)))
assert.ok(read('asar-preservation.json').passed)
assert.ok(read('final-fresh-boot/verification-result.json').passed)
const output=path.join(workspace,'CLINVEXA_最新版安装包')
fs.mkdirSync(output,{recursive:true})
async function copyVerified(key,name) {
  const target=path.join(output,name)
  fs.copyFileSync(meta[key].file,target)
  const hash=crypto.createHash('sha256')
  for await(const data of fs.createReadStream(target)) hash.update(data)
  assert.equal(hash.digest('hex'),meta[key].sha256)
  return target
}
const offlineFile=await copyVerified('offline','CLINVEXA-全功能离线安装包.exe')
const onlineFile=await copyVerified('online','CLINVEXA-轻量在线安装包.exe')
assert.deepEqual(fs.readdirSync(output).sort(),['CLINVEXA-全功能离线安装包.exe','CLINVEXA-轻量在线安装包.exe'].sort())
const offlineSize=(meta.offline.bytes/1073741824).toFixed(2)
const onlineSize=(meta.online.bytes/1024).toFixed(1)
const description=`# CLINVEXA 2.0.1 双安装包 · 2026-09-17

两种安装方式安装同一套 CLINVEXA 2.0.1。应用程序、安装器、快捷方式、启动/关于页面、悬浮球及副驾驶面板均使用用户最新提供的“小蓝机器人”图标，替代原先的 KNCUBE 文字图标。

| 安装包 | 大小 | 安装时的网络要求 |
| --- | --- | --- |
| CLINVEXA-全功能离线安装包.exe | ${offlineSize} GiB | 不需要联网下载环境和模型 |
| CLINVEXA-轻量在线安装包.exe | ${onlineSize} KiB | 需要联网，自动下载约 ${offlineSize} GiB 的完整安装资源 |

## 安装与首次使用

1. 使用 Windows 10 22H2 或更新版本的 64 位系统（含 Windows 11），建议预留至少 16 GB 可用磁盘空间。
2. 先退出正在运行的旧版 CLINVEXA，再双击所选安装包，按向导安装。在线版点击“下载并安装”，可以暂停并继续；网络失败可重试。
3. 使用新生成的桌面或开始菜单快捷方式启动；旧开发版快捷方式可能仍指向旧程序。首次打开时，程序自动准备本地 Python、Node.js、Git Bash、浏览器、语音模型与运行依赖。等待初始化进度完成即可，无需自行安装环境或运行命令。
4. 按自己的使用方式登录医疗智能体平台、连接模型服务。云端模型和平台同步仍需网络及有效账号/模型配置；安装包不包含个人 API Key 或账号密码。

在线安装器校验完整安装资源的 SHA-256 后才启动安装；安装成功后自动移除已下载的重复安装文件。中断时保留下载进度。

## 保留与验证

- 以 release-copilot-v20 最新构建为基础，保留全部原有功能资源和语音模型；采用无损压缩，没有通过删模型、删技能来减小体积。在线版减小的是初始下载文件，完整安装后的资源规模相同。
- 实际运行离线安装包，核对全部 ${installed.files} 个文件的路径、大小和 SHA-256。
- 在独立空白运行目录完成自动依赖初始化；验证本地语音依赖、27 项技能入口、三个确定性技能的输出、问诊结构化协议以及再次启动。
- 验证随包 Git Bash、Node.js 可运行，语音组件实际加载本地准备的 C++ 运行库。
- 验证 27 处应用图标资源、EXE 图标及悬浮球点击展开后的“小蓝机器人”图标；原功能代码与资源保留情况另有逐文件比对记录。
- 在线下载器通过完整下载、缓存、续传、服务器忽略 Range、损坏文件、错误分段、断网恢复、取消等测试；生产 HTTPS 地址通过文件头与字节范围检查，并完成超过 2 GB 偏移的实际续传和完整文件哈希校验。

云端模型效果、真实录音质量和医院系统兼容性不属于这次安装包测试的全场景覆盖范围；本次交付保留现有功能实现。

## 下载与校验

- [离线安装包](${online.offlineUrl})
- [在线安装包](${online.onlineUrl})

离线版 SHA-256：\`${meta.offline.sha256}\`

在线版 SHA-256：\`${meta.online.sha256}\`

当前安装包未配置商业代码签名证书，Windows 可能显示发布者提示。请从上述受控下载地址获取并核对校验值。

本地交付目录：\`${output}\`

构建与测试记录：\`${evidence}\`
`
const guide=path.join(workspace,'CLINVEXA_双版本安装说明.md')
fs.writeFileSync(guide,description)
const result={offlineFile,onlineFile,guide,offlineBytes:meta.offline.bytes,onlineBytes:meta.online.bytes,offlineUrl:online.offlineUrl,onlineUrl:online.onlineUrl}
fs.writeFileSync(path.join(evidence,'delivery-result.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
