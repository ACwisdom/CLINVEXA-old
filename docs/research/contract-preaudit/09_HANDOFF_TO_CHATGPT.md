# Clinvexa 智能合同预审 P0 开发交接

## 项目和证据基线

这是瑞金医院数智化办公 AI 项目的 Clinvexa 业务合同预审。调查日期 2026-11-12。实际仓库 `D:\C\CLINVEXA-source-2.0.10\source`，分支 `main` 跟踪 `origin/main`，HEAD `e950733` 是 2.0.10 导入快照。当前工作树已有 2.0.11 合同功能和打包改动，调查前 9 个跟踪文件已改、11 个未跟踪文件。开发基于实际工作树并保全这些改动。需求基线位于 `D:\AAAKN\瑞金医院\开发关键信息`。调查仅增加 9 份文档。

## 已核验架构和相关代码

- Electron 主进程 `apps/desktop/electron/main.ts:9793/9884` 拉起 FastAPI 服务。React/TypeScript 的 `apps/desktop/src/clinvexa/navigation.ts:8` → `clinvexa-desktop.tsx:188` → `contracts/workspace.tsx:54 ContractWorkspace`，`contracts/api.ts:1` 直连同机 `127.0.0.1:8001`。
- `clinvexa/src/clinvexa/main.py:97/151/422` 装配并启动服务，`contract_api.py:263` 注册合同 API。`contracts.py:54/76/181/239/319` 提供草稿、发现项、规则与 SQLite 版本存储。`contract_documents.py:27/36` 提供行差异和合同 PDF。`deterministic_skills.py:142` 解析 TXT、DOCX、文本 PDF。
- 隔离 FastAPI 健康接口 200、`business_contracts=2`。5 个既有后端测试函数通过，包括阻断金额错配、模拟 OA 回执、模型超时、法务展示、演示归档；OA 和模型请求均为模拟。Vitest 3 个文件、6 个用例通过。本机探测时 8001 无监听。本轮未实测桌面端到端启动。
- 当前已有同步预审、文本提取、草稿版本、规则校验、模型 JSON 候选、法务意见、风险 CSV、合同 PDF 和测试 OA 适配。当前扫描件无 OCR，发现项无稳定页段锚点/规则版本，权限是进程级，缺逐项复核、异步预审任务和独立预审报告。模型目前只收合同正文，输出所有发现按 warning 展示。
- Hermes 有通用 Agent、Skill、MCP、多模型和调度代码。医疗副驾知识源是有限文本注入。合同预审未接这些机制，不应把通用模块的存在当作合同 RAG、OCR 或 OA MCP 已可用。

## 瑞金云桌面和 OA

aDesk 独享桌面为 Windows 10 企业版 LTSC x64，Build 17763。院外构建 `vdi-win1809` 离线包，云桌面 C 盘安装和验收。用户截图已确认完整包复制及 SHA256 校验成功；安装和应用启动仍未知。本轮 Computer Use 恢复后远端画面超时，本机连院内 OA 端口超时。用户截图证实 OA 入口「合同管理 → 合同审批管理 → 业务合同1」，`workflowid=273`。已看到创建人、日期、部门，以及必填合同类型、资金来源和收入/支出/无金额、是否确定金额、标的金额。实际节点、附件区、字段编码和 2234 对应 OA 回执未证实。本轮未访问真实合同或提交审批。

院方 E9 文档提供 `POST /api/workflow/paService/doCreateRequest` 与 `workflowId/requestName/mainData`、成功 `requestid`。现适配器在 `contract_api.py:128/150/364/386`，只送已映射字段，状态人工登记。等院方提供 273 测试授权、字段及选项编码、附件规则和允许的读接口再联调。独立预审可以先做。

## P0 开发范围和数据契约

最小闭环为 **导入合同与可用材料 → 保存输入快照 → 提取页段和要素 → 执行规则与可选院内模型 → 产出有证据的清单 → 人工逐项复核 → 导出并重开记录**。重点是风险条款、必备项缺失、招采一致性及原文定位。审批、用印、全院台账与归档、MCP 放到后续联调。

复用合同页、本地 FastAPI、SQLite 版本检查、文本解析、确定性规则和导出工具。新增审查任务、规则版本、证据锚点、逐项复核和报告存储。扩展输入的 OA 金额方向、是否确定金额及资金来源，修正当前规则对所有合同一律要求金额的问题。保持原 `/review` 和已有数据兼容。可新增 `POST /clinvexa/contracts/{id}/review-jobs` 及查询、逐项复核和报告接口。输入绑定合同版本、文档哈希、规则集和模型标识。输出有风险等级、规则 ID/版本、证据文档及页段/偏移、原文、建议、覆盖范围和人工决定。模型引文与依据由服务端验证，超时保留规则结论并标记部分完成。

招采一致性首版条件纳入编号、相对方和金额。2234 的招标、响应、中标三份测试材料同项目，只有招标 PDF 可直接提取项目编号，另外两份需经批准的 OCR 或带页码人工核验。开发前补同项目脱敏合同及招采引用。证据缺失明确显示“未完成比对”。全文履约条款对照及实时 OA 附件联动继续保留在需求。

## 测试、阻塞与首轮交付

前端命令已实测。后端命令适用于装好项目依赖和 pytest 的 Python 环境。本轮本机默认 pytest 环境不完整，用交接 wheel 和临时目录隔离执行 5 个原有测试函数。证据与限制见 [08_EVIDENCE_INDEX.md](08_EVIDENCE_INDEX.md)。

```powershell
Set-Location -LiteralPath 'D:\C\CLINVEXA-source-2.0.10\source'
npm.cmd run test --workspace apps/desktop -- src/clinvexa/contracts/workspace.test.tsx src/clinvexa/copilot/compare.test.ts src/clinvexa/task-state.test.ts
```

```powershell
Set-Location -LiteralPath 'D:\C\CLINVEXA-source-2.0.10\source'
$env:PYTHONPATH='D:\C\CLINVEXA-source-2.0.10\source\clinvexa\src;D:\C\CLINVEXA-source-2.0.10\source'
$env:PYTHONDONTWRITEBYTECODE='1'
python -m pytest -q -p no:cacheprovider clinvexa/tests/test_contract_api.py
```

首轮先实现有定位的规则预审、可复核报告和失败降级，再加入经过验证的院内模型与 2234 关键字段校验。需院方提供脱敏样本、规则版本、法务标注、角色授权和模型/OCR 连通条件。建议验收文本关键字段准确率 ≥95%、关键风险召回 ≥90%、误报占已报发现 ≤15%、原文定位准确率 ≥95%、规则引用可追溯率 100%，全部为待确认目标，未实测达到。最后在 17763 云桌面跑完整预审闭环，OA 写入仅在获准测试环境单独验收。

补充材料：[本体](01_PROJECT_AUDIT.md)、[云桌面](02_CLOUD_DESKTOP_AUDIT.md)、[能力矩阵](03_CAPABILITY_MATRIX.md)、[架构](04_ARCHITECTURE_PROPOSAL.md)、[P0 范围](05_P0_SCOPE_AND_GAPS.md)、[接口](06_API_AND_DATA_CONTRACTS.md)、[准备度](07_DEVELOPMENT_READINESS.md)、[证据](08_EVIDENCE_INDEX.md)。
