# Clinvexa 项目本体调查

调查日期为 2026-11-12（北京时间）。实际 Git 根目录是 `D:\C\CLINVEXA-source-2.0.10\source`，外层目录另有交接资料和离线运行资源。分支 `main` 跟踪 `origin/main`，HEAD 为 `e950733`（导入 2.0.10 源码快照）。调查前已有 9 个跟踪文件修改和 11 个未跟踪文件，包含 2.0.11 的合同功能和 Windows 打包改动。以下判断基于实际工作树，不能直接从 HEAD 复现。

证据等级统一使用 **已验证、代码支持、合理推断、未知**。已验证的范围随证据注明，例如隔离测试、样本实测或用户截图。

| 子系统 | 技术栈、职责和入口 | 调查结果 |
| --- | --- | --- |
| Windows 桌面 | Electron 主进程 `apps/desktop/electron/main.ts`，preload 桥接 `preload.ts`，React/TypeScript/Vite 渲染，包版本 2.0.11，入口 `dist/electron-main.mjs` | **已验证**三组前端测试。Electron 完整 GUI 启动及本轮 VDI 运行未验证 |
| 本地 Clinvexa HTTP 服务 | Python 3.11–3.13、FastAPI、Pydantic、Uvicorn。`clinvexa/main.py:97 create_app`，`:422 main` 启动在 `127.0.0.1:8001`。Electron `main.ts:9793 startCLINVEXAService`，`:9884` 派生进程 | **已验证** ASGI 隔离应用健康接口返回 200，`business_contracts=2`。本轮探测本机 8001 无监听，尚无桌面启动证据 |
| 合同工作区 | `navigation.ts:8` 注册入口，`clinvexa-desktop.tsx:188` 渲染 `contracts/workspace.tsx:54 ContractWorkspace`，`contracts/api.ts:1` 直接调用本地服务 | **已验证**保存后以服务端版本号执行预审的渲染测试。浏览器 fetch 在测试中被替换 |
| 合同数据及服务 | `contracts.py:54 ContractDraft`、`:76 Finding`、`:96 ContractRecord`、`:239 ContractStore`。SQLite 内含当前记录、版本快照及用印件 BLOB，修改以 revision 检查并写入快照。默认在 Hermes home 的 `clinvexa/contracts` | **已验证**规则、模型降级、模拟 OA、演示隔离、版本冲突与导出等既有用例。多用户共享和正式环境数据规模未知 |
| Hermes Agent 与网关 | 上游 Hermes CLI、TUI、消息/API 网关在同一仓库。核心 `run_agent.py:412 AIAgent`、`:7543 run_conversation`，`gateway/platforms/api_server.py:1297 APIServerAdapter`，`:1957` 注册 OpenAI 兼容入口。会话 SQLite 见 `hermes_state.py:1770 SessionDB` 与 `hermes_state_schema.py:35` | **代码支持**。没有为本轮启动网关或调用模型，合同规则链不经过 Agent |
| 技能、工具与调度 | `clinvexa/skills.py:73 CLINVEXASkillPlaza` 管理目录和已安装技能，`main.py:188/234/261` 为目录/调用/流式入口。MCP 服务 `mcp_serve.py:590`，客户端状态 `tools/mcp_tool.py:6537`。定时任务 `cron/jobs.py:1246`、`cron/scheduler.py:2771/4120` | **代码支持**。合同预审当前未接 Agent、Skill、MCP 或任务调度，定时任务并非即用型审查队列 |
| 医疗副驾、知识和屏幕 | `hermes_cli/clinvexa_copilot.py:28` 路由，`:192` 存储，`:210` 读知识库，`:356` 调用辅助模型，`:495/508` 列出和新增知识。Electron `clinvexa-copilot-runtime.ts:82–88` 桥接。另有问诊、语音、HIS RPA | **代码支持**。副驾使用本地知识条目和有限提示词预算，不能据此认定有合同检索、法规索引或通用 OCR。HIS RPA 的患者/窗口绑定与确认逻辑有领域耦合 |
| Windows 发布 | `deploy/clinvexa/electron-builder.cjs:11` 资源装配，`apps/desktop/scripts/after-pack.mjs` 校验离线资源，`clinvexa-installer.iss:58` 最低版本可配置 | **已验证**仓库发布目录存在 LTSC 完整包和升级包。此前截图显示完整包已复制并校验，VDI 安装/启动未知 |

`README.md` 和 `README.zh-CN.md` 描述上游 Hermes 的能力，Clinvexa 业务功能以实际代码和 [业务合同说明](../../clinvexa-business-contracts.md) 为准。本机此次使用 Python 3.11.9、Node v24.14.0、npm 11.9.0。系统 Python 可导入 FastAPI/HTTPX/Pydantic，旧临时 pytest 目录缺入口文件。后端通过既有用例的隔离适配执行，读取交接包自带 wheel，未安装依赖。执行详情见 [证据索引](08_EVIDENCE_INDEX.md)。
