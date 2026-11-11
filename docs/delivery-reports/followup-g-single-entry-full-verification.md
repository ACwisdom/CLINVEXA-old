# CLINVEXA 唯一入口与全服务闭环验证报告

验证日期：2026-08-09

## 唯一交付物

- 唯一源码 A：`D:\N260 Hermes+CLINVEXA\hermes-agent-main`
- 唯一软件 A：`D:\N260 Hermes+CLINVEXA\hermes-agent-main\apps\desktop\release\win-unpacked\CLINVEXA.exe`
- CLINVEXA 本地服务端口：`127.0.0.1:8001`

本次先终止旧 CLINVEXA、旧网关和旧本地服务进程，再仅从上述软件 A 启动。Electron 当前只有 1 个主进程；GPU/Renderer 子进程属于该主进程，不是第二套软件入口。

## 源码与运行时一致性

下列关键文件已逐一计算 SHA-256，源码 A、软件 A 内置运行时、当前 AppData 活跃运行时三者完全一致：

- `clinvexa/src/clinvexa/consultations.py`
- `clinvexa/src/clinvexa/main.py`
- `skills/clinvexa/catalog.json`
- `tools/transcription_tools.py`
- `tools/computer_use/tool.py`

软件 A 的 `app.asar` 同时包含“开始问诊记录”“患者已知情并同意本次问诊记录”“简体中文问诊记录”及 `$outpatient-note-draft`，确认界面来自最新源码 A。

## 一键拉起服务结果

- CLINVEXA Agent/桌面网关：已启动。
- CLINVEXA 医疗本地服务：已启动。
- 8001 端口：监听正常，且仅有 1 个监听入口。
- Skill 广场：返回 27 个 Skill，27 个均已安装、已启用。
- `skill-creator`、`outpatient-note-draft`、`record-structuring`：均存在且可查找。
- 中文语音转写运行时：已通过真实 WAV 闭环调用。
- Computer Use：使用正式运行时完成软件启动及界面捕获。

## 自动化验证结果

- CLINVEXA 后端：103/103 通过。
- CLINVEXA 界面、中文语音与问诊记录：57/57 通过。
- Word/PDF/Excel 附件与预览：41/41 通过。
- TypeScript 类型检查：通过。
- 唯一软件发布目录清理测试：1/1 通过。

Electron 上游全集另含 POSIX/SSH/Linux 专用用例以及仍断言旧 Hermes 文案的历史测试；这些不属于 Windows CLINVEXA 产品有效验收集，未作为本次产品阻断项。产品有效测试集全部通过。

## 真实运行态闭环

### Skill 广场

调用 `outpatient-note-draft` 成功，运行指令包含：

- `CLINVEXA Skill：门诊病历草稿`
- 使用场景与功能说明
- 当前医生任务

### 模拟 HIS

`GET /clinvexa/simulated-his` 返回 HTTP 200，页面包含 CLINVEXA 固定模拟 HIS、患者检索、打开患者和提交病历控件。

### 中文问诊记录

使用脱敏测试患者与中文合成录音完成：

1. 医生确认患者知情同意后开始记录；
2. 记录中添加“重点内容”标记；
3. 结束后识别为简体中文；
4. 自动生成门诊病历草稿；
5. 草稿保留来源证据并设置 `requires_human_review=true`。

实测识别文本包含咳嗽三天、低热、最高体温 37.8 度、无胸痛、无药物过敏。

### Computer Use

正式软件 A 的当前活跃运行时完成：

- 应用枚举；
- 窗口枚举；
- CLINVEXA AX/SOM 界面捕获；
- 启动记事本；
- 捕获新启动记事本窗口及 20 个可交互元素；
- 关闭测试用记事本，不影响 CLINVEXA。

辅助视觉模型未配置时，额外的视觉语义增强会跳过；AX/SOM 捕获和实际桌面操作不受影响。

## 交付结论

唯一源码 A、唯一软件 A 与当前活跃运行时一致。旧进程已关闭，最新软件 A 已启动并保持运行，核心服务、Skill、中文语音、问诊记录、附件预览、模拟 HIS 和 Computer Use 均已完成闭环验证，可进入人工功能测试。
