import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'

const workspace = path.resolve(import.meta.dirname, '../../../..')
const evidence = path.join(workspace, '.codex-work/voice-repair-20260918')
const read = name => JSON.parse(fs.readFileSync(path.join(evidence, name), 'utf8'))
const meta = read('release-metadata.json')
const install = read('installer-verification.json')
const online = read('online-verification.json')
const stage = read('stage-result.json')
const native = read('native-packaged/result.json')
const visual = read('visual-his-final/result.json')
const mention = read('mentions-final/native-result.json')
const readiness = read('release-readiness.json')
assert.ok(readiness.passed && read('blue-robot-native-icons.json').passed, 'Release or application-icon checks have not passed')
assert.equal(readiness.sourceManifestSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(evidence,'installer-manifest.json'))).digest('hex'),'Release payload changed after acceptance')
const cleanRoot = process.env.CLINVEXA_VERIFIED_INSTALL_ROOT
assert.ok(cleanRoot, 'An explicitly verified isolated installation is required')
const clean = name => JSON.parse(fs.readFileSync(path.join(cleanRoot,name),'utf8'))
assert.ok(clean('verification-result.json').passed, 'Fresh installation did not pass')
const engines = clean('runtime-engines.json')
assert.ok(engines.passed && engines.checks.length === 13 && engines.checks.every(row => row.passed), 'Installed engines did not all pass')
assert.ok(native.passed && native.version === stage.version)
for (const suffix of ['hidden','outside-display','closed']) assert.ok(native.steps.some(step => step.name === 'summon-floating-ball-' + suffix))
assert.ok(native.steps.some(step => step.name === 'continuous-recording-one-minute'))
assert.ok(visual.passed && visual.performancePassed && visual.version === stage.version, 'Visual capture/fill or ten-second delivery gate failed')
assert.ok(mention.passed && mention.packaged, 'Packaged mention/call workflow did not pass')
assert.ok(install.passed && install.installer === meta.offline.file)
assert.ok(stage.originalResourcesPreserved)
assert.ok(online.passed && online.offlineSha256 === meta.offline.sha256 && online.onlineSha256 === meta.online.sha256)
assert.equal(clean('runtime/.clinvexa-live-voice.json').decodeChecks.filter(check => check.decoded).length, 4)
const output = path.join(workspace, 'CLINVEXA_最新版安装包')
fs.mkdirSync(output, { recursive: true })
const files = {}
for (const [kind, name] of [['offline', 'CLINVEXA-全功能离线安装包.exe'], ['online', 'CLINVEXA-轻量在线安装包.exe']]) {
  const target = path.join(output, name)
  const temporary = target + '.new'
  fs.copyFileSync(meta[kind].file, temporary)
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(temporary)) hash.update(chunk)
  assert.equal(hash.digest('hex'), meta[kind].sha256)
  fs.renameSync(temporary, target)
  files[kind] = target
}
const guide = path.join(workspace, 'CLINVEXA_双版本安装说明.md')
fs.writeFileSync(guide, `# CLINVEXA ${stage.version} · 2026-09-18

两种安装包安装相同版本，均保留原版全部功能资源和小蓝机器人应用图标。

| 安装包 | 大小 | 安装方式 |
| --- | --- | --- |
| 全功能离线版 | ${(meta.offline.bytes / 1073741824).toFixed(2)} GiB | 包含环境、语音引擎和模型，无需联网下载依赖 |
| 轻量在线版 | ${(meta.online.bytes / 1024).toFixed(0)} KiB | 联网自动下载上述完整资源，支持续传并验证 SHA-256 |

退出旧版后运行安装包；首次启动会自动准备本地组件，请等待初始化完成，无需手工安装 Python、语音引擎或模型。建议预留 20 GB 磁盘空间。用户现有配置、问诊记录保留。云端 AI 分析及平台同步仍需网络和有效模型/账号配置，安装包不含个人密钥。

## 本次修复与验证

- 根因：先前安装包未带实时转写使用的 sherpa_onnx 和完整模型，安装检查只覆盖另一套语音依赖；界面在组件缺失时仍允许录音，并反复重试。
- 修复：内置实际使用的识别引擎、依赖和三套模型；逐文件校验；录音前检查并预热；失败音频保留和重试；存在未处理录音时阻止直接结束丢弃。
- 已恢复本机原先积压的 10 段录音，并完成 AI 病历草稿。
- 独立 Python 3.11 环境中离线安装识别依赖，四种路由实际解码通过。四路由使用普通话测试音频，不代表四种方言的全面准确率验收。
- 实际安装版 Electron 通过合成麦克风输入、真实本地识别、真实模型分析测试：引擎准备完成后首次转写 ${(native.steps.find(step=>step.name==='native-audio-to-visible-transcript').milliseconds/1000).toFixed(1)} 秒；连续录音一分钟且切换工作区继续记录；手动停止后队列清空并生成结构化病历。
- 主页面“副驾驶悬浮球”入口实际验证：隐藏、移出屏幕、关闭后均可重新唤起，并可展开操作。
- 后端 189 项、桌面界面及副驾驶逻辑 83 项、悬浮球入口交互 2 项回归通过。实际安装包解出 ${install.files} 个文件，逐一核对大小与 SHA-256。
- 截图与启动顺序优化后，相关后端 30 项、桌面 18 项回归通过（含复跑项目）。改为原生驱动只读取目标窗口、复用可暂停监听，并在引擎准备完成后才报告后台就绪，避免首次视觉请求承担后台冷导入开销。
- 隔离环境内逐项执行 13 组引擎与工具检查，包括两套语音实际解码、文档读写、浏览器实际导航填写、音频编解码、Git Bash、桌面驱动、记忆读写、定时任务管理及完整依赖兼容性。
- 视觉端到端测试（截图→真实模型→完整结果）耗时 ${visual.timings.map(row=>(row.wallMs/1000).toFixed(2)+' 秒').join('、')}；保留结果后可填入两个不同标题的模拟 HIS 输入框。云端耗时仍受网络、服务负载和画面复杂度影响。
- 智能体与技能 @ 菜单、召唤、会话上下文和调用指令传递通过打包程序测试；该流程测试使用合成平台及模型响应，真实云端可用性仍取决于账号授权和服务状态。

## 下载与校验

[全功能离线安装包](${online.offlineUrl})

[轻量在线安装包](${online.onlineUrl})

离线 SHA-256：\`${meta.offline.sha256}\`

在线 SHA-256：\`${meta.online.sha256}\`

测试记录：\`${evidence}\`。以上是已执行的测试范围，不等同于所有麦克风、方言、网络及医院系统组合均已验证。
`)
const result = { version: stage.version, ...files, guide, offlineUrl: online.offlineUrl, onlineUrl: online.onlineUrl }
fs.writeFileSync(path.join(evidence, 'delivery-result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
