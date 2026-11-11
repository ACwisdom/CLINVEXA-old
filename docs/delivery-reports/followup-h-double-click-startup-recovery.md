# CLINVEXA 双击启动无响应修复交付报告

交付日期：2026-08-10

## 故障

用户双击唯一软件 A 后，Windows 显示“CLINVEXA 未响应”，长时间无法进入主界面。

## 根因

本次确认存在两个叠加问题：

1. 正式版优先从虚拟 `app.asar` 文件系统加载主页面；Windows 上该入口发生 `ERR_FAILED (-2)` 后没有回退路径。
2. 完整软件会在 Electron 主线程中使用 `fs.cpSync` 将整套运行源码复制到用户运行目录，并且每次启动重复执行。复制和杀毒扫描期间主线程不能处理窗口消息，因此 Windows 判定未响应，8001 服务也无法启动。

## 修复

- 正式版优先加载真实文件 `app.asar.unpacked/dist/index.html`。
- 页面加载失败时按有限候选链自动回退；所有入口都失败后结束重试并记录明确日志，不进入无限循环。
- 源码 A 同步改为异步复制，Electron 窗口不再被阻塞。
- 增加构建指纹；只有软件构建发生变化或活跃运行时不完整时才同步，相同版本直接跳过。
- Agent 网关和 8001 医疗服务等待源码同步完成后启动，防止新界面连接旧运行代码。
- 成功构建后自动清理 `win-unpacked.bak`，保持唯一软件 A。

## 自动化验证

- 渲染入口候选链与失败回退：4/4 通过。
- 运行时增量同步决策：3/3 通过。
- Electron TypeScript 类型检查：通过。
- 构建钩子：确认 27 个医疗 Skill、中文语音模型和 `cua-driver` 均已打包。

## 实际双击闭环

### 第一次启动（构建发生变化）

- 双击后 2 秒检查：Electron 主进程 `Responding=True`。
- 后台异步同步源码 A：成功。
- 医疗与 Skill 服务：约 9 秒后就绪。
- Skill 数量：27。
- 日志确认：`agent_gateway=ready medical_service=ready voice=ready computer_use=ready`。

### 第二次启动（构建未变化）

- 日志确认跳过运行时同步。
- Electron 主进程持续响应，窗口标题为 CLINVEXA。
- 8001 仅有 1 个监听进程。
- 27 个 Skill 可查询、已安装并启用。

## 一致性

源码 A、软件 A 内置运行时和 AppData 活跃运行时的以下关键文件 SHA-256 完全一致：

- `clinvexa/src/clinvexa/main.py`
- `clinvexa/src/clinvexa/consultations.py`
- `skills/clinvexa/catalog.json`
- `tools/transcription_tools.py`
- `tools/computer_use/tool.py`

## 最终入口

`D:\N260 Hermes+CLINVEXA\hermes-agent-main\apps\desktop\release\win-unpacked\CLINVEXA.exe`

当前软件 A 已保持运行，可直接进行人工功能测试。
