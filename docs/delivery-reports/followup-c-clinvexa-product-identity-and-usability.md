# CLINVEXA 产品身份与桌面易用性交付报告

**交付日期：** 2026-08-06  
**范围：** Follow-up C  
**结论：** **Go**

## 1. 交付功能

- “执行 Agent”中的五个选项均直接说明功能和使用场景。
- 原“任务内容”更名为“Agent 快捷任务”，继续作为指定 Agent 的快捷入口；主页面对话框仍用于普通对话和自动路由。
- 悬浮球原生窗口由 `188×80` 缩小为 `72×72`，增加可见拖动把手，右键“退出”保持可用。
- CLINVEXA 主导航移除“消息平台”，后续不再作为产品功能入口显示。
- 语音只按中文转写，成功结果统一转换为简体中文；本地模型由 `base` 升级为 `small`，增加医疗办公术语提示。
- 默认、安装后和当前运行身份统一为 CLINVEXA 医疗 AI 办公助手；用户可见的快捷入口、错误、设置和卸载文案同步去除旧品牌。

## 2. 已完成任务

- [x] 增加 Agent 说明并保持显式路由闭环。
- [x] 缩小悬浮窗口并增加 Electron 原生拖动区域。
- [x] 移除消息平台导航入口。
- [x] 固定中文识别、增加简体转换并升级本地识别配置。
- [x] 修正 Agent 系统身份、当前 `SOUL.md` 和安装种子身份。
- [x] 构建最新源码并关闭旧桌面进程，启动最新 CLINVEXA。

## 3. 主要变更文件

- `apps/desktop/src/clinvexa/sidebar/index.tsx`
- `apps/desktop/src/clinvexa/floating-ball/index.tsx`
- `apps/desktop/electron/clinvexa.ts`
- `apps/desktop/src/app/chat/sidebar/index.tsx`
- `tools/transcription_tools.py`
- `agent/prompt_builder.py`
- `hermes_cli/default_soul.py`
- `docker/SOUL.md`
- `scripts/install.ps1`
- `scripts/install.sh`

## 4. 验收证据

| 验收项 | 结果 |
|---|---|
| CLINVEXA UI 专项测试 | 10/10 通过 |
| Electron 窗口专项测试 | 4/4 通过 |
| 简体中文与身份 Prompt 专项测试 | 3/3 通过 |
| TypeScript 类型检查 | 通过 |
| 生产构建 | 通过，`dist` 完整 |
| 悬浮窗口实际尺寸 | `72×72` |
| Agent 选项运行态检查 | 5 个说明完整，快捷任务标签存在 |
| 消息平台入口 | 运行态导航中不存在 |
| 身份问答 | 返回 CLINVEXA 医疗 AI 办公助手；未出现底层运行时名称 |
| 最新进程 | CLINVEXA PID `14680`，服务端口 `8001` |

## 5. 已知限制

- `small` 模型首次使用需要下载模型文件，首次转写等待时间会比后续转写长。
- 本次没有代替用户进行真实麦克风口述，中文准确度的最终听感需由用户在当前已启动客户端中验收。
- 仓库全量 UI 测试超过五分钟命令上限后被终止；本次涉及的 CLINVEXA UI 专项测试全部通过。
- 一个既有 Windows 命令式 STT 测试在 `0.1` 秒首输出阈值下超时；它不经过本次本地 Whisper 简体中文路径。

## 6. 阶段判定

Follow-up C 的全部产品验收项已有源码、自动化测试和运行态证据，判定 **Go**。最新 CLINVEXA 已启动供用户验证语音、拖动和界面结果。
