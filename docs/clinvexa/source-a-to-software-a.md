# 从唯一源码 A 到唯一软件 A

## 唯一位置

- 源码 A：`D:\N260 Hermes+CLINVEXA\hermes-agent-main`
- 软件 A：`D:\N260 Hermes+CLINVEXA\hermes-agent-main\apps\desktop\release\win-unpacked\CLINVEXA.exe`
- 唯一安装包 A：`D:\N260 Hermes+CLINVEXA\hermes-agent-main\apps\desktop\release\CLINVEXA-0.17.2-win-x64.exe`

不要再启动其他目录中的 CLINVEXA、旧安装目录或 `win-unpacked.bak`。

## 日常使用：只需双击

日常使用不需要打开终端，也不需要手动启动任何 Python、Skill 或语音服务。

1. 首次使用双击唯一安装包 A 完成安装。
2. 此后只双击桌面的 **CLINVEXA** 图标；正式入口固定为 `%LOCALAPPDATA%\Programs\CLINVEXA\CLINVEXA.exe`。
3. 等待 CLINVEXA 主界面进入可用状态。

软件会自动完成：

- 加载 CLINVEXA 主界面；
- 同步本次构建携带的最新源码 A（仅在版本变化时执行）；
- 启动 Agent 网关；
- 启动 8001 医疗与 Skill 服务；
- 加载 27 个内置医疗 Skill 和 `skill-creator`；
- 检查中文语音转写运行时；
- 检查 Computer Use 运行时。

同步过程在后台异步执行，不会阻塞窗口。软件版本没有变化时会直接跳过同步。

## 源码更新后：重新生成软件 A

仅开发人员修改源码后执行。打开 PowerShell：

```powershell
Set-Location 'D:\N260 Hermes+CLINVEXA\hermes-agent-main'
.\deploy\clinvexa\build-windows.ps1
```

命令必须运行到出现以下验证信息后才算构建成功：

- `verified 27 bundled CLINVEXA medical Skills`
- `verified bundled Chinese voice model and cua-driver`
- `removed obsolete rollback software after successful build`

构建完成后开发验收副本为：

```text
D:\N260 Hermes+CLINVEXA\hermes-agent-main\apps\desktop\release\win-unpacked\CLINVEXA.exe
```

正式用户只分发并安装 `CLINVEXA-0.17.2-win-x64.exe`。`build-windows.ps1` 会从源码 A 重新构建界面和 Electron 主进程，将 CLINVEXA Python 运行源码、医疗 Skill、中文语音模型、Computer Use 驱动和离线依赖装入同一个软件 A，并清理旧的 `win-unpacked.bak`。完整离线包超过 NSIS 映射限制，因此规范化脚本使用 Inno Setup 6 生成唯一单文件安装包。

## 快速检查

软件打开后，可在 PowerShell 执行：

```powershell
Invoke-RestMethod 'http://127.0.0.1:8001/clinvexa/skills' | Measure-Object
```

正常结果的 `Count` 为 `27`。该检查只用于排障，正常使用不需要执行。

## 启动异常时

日志位置：

```text
C:\Users\home\AppData\Roaming\CLINVEXA\runtime\logs\desktop.log
```

正常启动日志最终应包含：

```text
startup closure: agent_gateway=ready medical_service=ready voice=ready computer_use=ready
```
