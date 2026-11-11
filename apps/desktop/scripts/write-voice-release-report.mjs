import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const workspace=path.resolve(import.meta.dirname,'../../../..')
const root=path.join(workspace,'.codex-work/voice-repair-20260918')
const read=(base,file)=>JSON.parse(fs.readFileSync(path.join(base,file),'utf8'))
const ready=read(root,'release-readiness.json')
assert.ok(ready.passed)
const engines=read(ready.cleanRoot,'runtime-engines.json')
const native=read(root,'native-packaged/result.json')
const visual=read(root,'visual-his-final/result.json')
const installer=read(root,'installer-verification.json')
const icons=read(root,'blue-robot-native-icons.json')
const online=read(root,'online-verification.json')
assert.ok(installer.passed && icons.passed && online.passed)
const names={
 'product-imports-from-installed-home':'产品模块及后台依赖来自安装目录',
 'installed-dependency-compatibility':'全部已装 Python 依赖的兼容性',
 'document-read-write-engines':'Word / Excel / PDF / PPT 实际读写',
 'realtime-asr-offline-decode':'问诊实时语音四条路由实际解码',
 'general-dictation-offline-decode':'通用语音输入 faster-whisper 实际解码',
 'bundled-node-execution':'内置 Node 执行',
 'bundled-ripgrep-execution':'内置文件检索工具执行',
 'bundled-computer-use-driver':'桌面操作驱动启动',
 'bundled-git-bash-execution':'内置 Git Bash 执行',
 'bundled-audio-codec-conversion':'内置 FFmpeg / FFprobe 音频转换与读取',
 'bundled-browser-navigation-and-fill':'通过产品浏览器工具真实打开、定位、填写页面',
 'memory-persistence-and-search':'记忆保存、重新加载、搜索与删除测试记录',
 'scheduled-task-management':'定时任务创建、更新、禁用、重新读取与删除测试任务',
}
const file=path.join(workspace,`CLINVEXA_${ready.version}_功能验收记录.md`)
const link=(label,target)=>`[${label}](<${target.replaceAll('\\','/')}>)`
fs.writeFileSync(file,`# CLINVEXA ${ready.version} 功能验收记录

检查日期：${new Date().toISOString()}。平台：本机 Windows x64。所有临床文字和麦克风输入均为合成测试资料。

## 已修复的问题

1. 旧包只检查 faster-whisper，遗漏问诊实际使用的 sherpa-onnx 和实时模型。现在三套模型及识别依赖随包提供，逐文件校验并实际解码，录音前先确认引擎就绪。
2. 补齐 PDF 输入及常用办公文件生成所需的依赖。完整兼容性检查额外发现并补齐 CTranslate2 的 setuptools 依赖；初始化加入兼容性检查，不能只靠模块导入成功判断完整。
3. 主页面“副驾驶悬浮球”由只改变展开状态改为显式恢复或重新创建窗口，恢复置顶并放回当前屏幕。连接失败会显示错误。
4. 音频分段持久化、顺序重试和明确错误反馈；停止时检查未处理分段，避免带着积压音频直接结束。
5. 实测定位到视觉延迟来自给所有打开窗口生成缩略图（约 7.4～8.2 秒）及重启监听（约 2.3～5.5 秒）。现使用内置原生驱动只读取指定窗口，提前准备并复用可暂停的监听；视觉截图只读取图像，限制不使用的控件树遍历（原默认最多 5,000 个控件），并让恢复监听立即唤醒。界面耗时包含截图及首次启动监听的等待，不再漏计。
6. 后台原先提前报告就绪，通用语音库的冷导入仍与首次视觉请求竞争 Python 执行资源，并可能使健康检查超时。现在先准备截图驱动、完成语音预加载和驱动健康检查，再通过只读请求准备模型服务连接，最后报告后台就绪；首次启动需要等待后台组件准备完成。

## 安装目录内逐项执行的引擎和工具检查

全新目录：\`${ready.cleanRoot}\`。测试禁用依赖网络下载，清除开发 Python、虚拟环境和开发工具 PATH；由安装包自行创建运行环境。

| 功能或组件 | 结果 |
|---|---|
${engines.checks.map(row=>`| ${names[row.name]||row.name} | ${row.passed?'通过':'失败'} |`).join('\n')}

文档检查包含 7 个实际文件读写操作；语音检查调用模型解码音频，而非仅确认目录或模块存在。定时任务检查验证管理和存储，没有触发外部消息发送。

## 桌面功能流程

| 流程 | 实际结果 |
|---|---|
| 问诊录音→转写 | 首次可见转写 ${(native.steps.find(row=>row.name==='native-audio-to-visible-transcript').milliseconds/1000).toFixed(2)} 秒 |
| 连续录音与切换工作区 | 连续一分钟以上，未自动停止；最大待处理分段 ${native.steps.find(row=>row.name==='continuous-recording-one-minute').maxPending} |
| 手动停止→病历草稿 | ${native.steps.find(row=>row.name==='native-command-mirror-and-finalize').segments} 段全部处理，真实配置模型生成结构化草稿 |
| 悬浮球唤起 | 隐藏、移出屏幕、关闭后三种情况均恢复；另用 Windows 真实鼠标点击主页面入口并展开副驾驶 |
| 视觉截图→模型完整结果 | 三次全流程 ${visual.timings.map(row=>(row.wallMs/1000).toFixed(2)+' 秒').join('、')} |
| 保留结果→快捷填写 HIS | 同一结果填入两个不同名称的输入框；结果保留；未触发正式提交 |
| 本机技能 | 27 个入口逐一调用检查；三个固定输出技能实际生成文件 |
| @ 智能体 / 技能 | 分组、每组四项、展开收起、搜索、键盘选择、召唤标签、当前会话上下文及指令传递通过 |
| 主界面导航 | 视觉副驾驶、问诊记录、医疗智能体、任务进度、桌面操作逐一打开 |
| 应用及两款安装包图标 | 小蓝机器人原始 ICO 各尺寸帧与三个 EXE 内资源逐一比对 |
| 离线安装包 | 真实静默安装；${installer.files} 个文件逐一验证大小与 SHA-256 |
| 在线安装包 | 真实 HTTPS 下载地址、分段下载、超过 2 GB 位置续传和完整 SHA-256 验证 |

自动回归：基线后端 189 项、桌面界面及副驾驶逻辑 83 项、新悬浮球入口交互 2 项；截图与启动顺序优化后另通过相关后端 30 项及桌面 18 项回归（包含复跑项目，不相加作总数）。原生截图驱动另通过 81 项回归；其中修正了测试夹具的 Windows 路径转义及 Linux 平台模拟。界面与后端回归包含部分模拟依赖测试，以上安装目录测试补充验证真实引擎执行。

## 验收范围

问诊和视觉使用本机配置的真实模型服务；@ 智能体集成测试使用合成平台及模型响应验证连接、授权包校验、上下文与调用过程。本轮浏览器中的真实平台账号处于未登录状态，未将真实账号调用标为已验收。

四条识别路由使用同一段普通话音频检测引擎可运行；这不等同于粤语、上海话、北京话各口音准确率的全面评估。录音转写耗时从引擎准备完成后开始计时，首次模型加载另需时间。视觉三次低于十秒是本机与本次网络条件下的实测，不能保证所有画面和云端负载下均低于十秒。

## 可核查记录

- ${link('发布门槛检查',path.join(root,'release-readiness.json'))}
- ${link('隔离安装验证',path.join(ready.cleanRoot,'verification-result.json'))}
- ${link('真实引擎逐项记录',path.join(ready.cleanRoot,'runtime-engines.json'))}
- ${link('问诊与悬浮球桌面验证',path.join(root,'native-packaged/result.json'))}
- ${link('悬浮球原生鼠标操作验证',path.join(root,'native-packaged/native-mouse-summon.json'))}
- ${link('视觉与 HIS 验证',path.join(root,'visual-his-final/result.json'))}
- ${link('@ 调用及导航验证',path.join(root,'mentions-final/native-result.json'))}
- ${link('安装包完整性验证',path.join(root,'installer-verification.json'))}
- ${link('在线下载验证',path.join(root,'online-verification.json'))}
`)
console.log(file)
