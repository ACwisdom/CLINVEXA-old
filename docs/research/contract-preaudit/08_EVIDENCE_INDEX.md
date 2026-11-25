# 证据索引

日期 2026-11-12（北京时间）。源码位置相对仓库根 `D:\C\CLINVEXA-source-2.0.10\source`，行号针对本轮工作树。原截图仅在当前用户会话内引用，未复制到调查目录。

| 证据 | 事实、出处及限制 |
| --- | --- |
| E01 Git | `git status --porcelain=v1 -uall` 与 `git log -3 --oneline`。HEAD e950733，原有 20 个变更路径。调查前后比较这些路径内容哈希，并核对最终状态仅多出 9 份调查 Markdown |
| E02 桌面与 HTTP 边界 | `apps/desktop/package.json:2/9/27/56`；`apps/desktop/electron/main.ts:9793/9884`；`apps/desktop/src/clinvexa/navigation.ts:8`、`clinvexa-desktop.tsx:188`、`contracts/api.ts:1/144`；`clinvexa/src/clinvexa/main.py:97/151/160/422` |
| E03 ASGI 与后端 | Python 3.11.9，隔离目录、去掉外部业务配置、无网络请求。FastAPI TestClient GET health 200，business_contracts=2。用交接 wheel 直接加载 pypdf 与 ReportLab，调用 `clinvexa/tests/test_contract_api.py` 的 5 个原测试函数，全部通过。OA 与模型 HTTP 由用例 mock |
| E04 前端测试 | 下方 Vitest 命令实测 3 个文件、6 个用例全部通过。验证合同保存和规则审查交互、差异比较和任务状态逻辑；合同测试拦截 fetch |
| E05 存储/规则/预审 | `clinvexa/src/clinvexa/contracts.py:54/76/136/181/232/239/319`；`contract_api.py:58/91/319/349/402`；`contract_documents.py:27/36`。金额不一致阻断、超时降级、法务输出过滤、演示隔离、用印归档在 E03 用例中覆盖 |
| E06 样本解析 | 用 `deterministic_skills.py:142 read_source_text` 实跑测试目录的三份 PDF 及需求 DOCX。招标 PDF 38,704 字、抽出项目编号；中标和响应件返回“扫描件需先 OCR”；需求 DOCX 835 字。测试文件封面和中标页已核对同项目，未在交接中转载正文或商业数值 |
| E07 相关通用基础 | `tools/read_extract.py:42/107`；`hermes_cli/clinvexa_copilot.py:192/210/356/495/508/566`；`agent/auxiliary_client.py:5656`；`run_agent.py:412/7543`；`mcp_serve.py:590`；`tools/mcp_tool.py:6537`；`cron/jobs.py:1246`。证明代码存在，尚未运行合同集成 |
| E08 VDI | 本轮枚举 aDesk、恢复并重新绑定窗口，画面两次超时，AX 仅外层窗格。本机 TCP 8001 无监听，本机连接院内 OA 测试端口超时。用户 11-12 历史截图证实 Build 17763 x64、映射盘和 C 盘复制 SHA256 成功。未将本机测试视为云桌面验收 |
| E09 OA 界面 | 用户 11-12 的两张截图（文件标识以 `829694bf`、`50fa5598` 开头）显示合同审批管理入口、业务合同1、workflowid=273、表单上半部。截图未提供附件区、节点和已有流程详情。院方《院方要求.docx》包含入口示意 |
| E10 E9 文档 | `D:\AAAKN\瑞金医院\第三方系统与OA\关于第三方系统调用E9创建流程接口说明文档（Restful）.docx` 中的流程创建及附件说明。实现对应 `contract_api.py:37/128/150/364/386`；实际接口授权和成功回执尚未核验 |
| E11 需求与部署 | `D:\AAAKN\瑞金医院\开发关键信息\合同管理.png` 与《数智化办公AI建设内容.docx》。打包见 `deploy/clinvexa/electron-builder.cjs`、`apps/desktop/scripts/clinvexa-installer.iss:58`。发布目录存在 17763 LTSC 完整包及升级包，远端 GUI 尚未实测 |

## 运行入口

前端命令已实测。

```powershell
Set-Location -LiteralPath 'D:\C\CLINVEXA-source-2.0.10\source'
npm.cmd run test --workspace apps/desktop -- src/clinvexa/contracts/workspace.test.tsx src/clinvexa/copilot/compare.test.ts src/clinvexa/task-state.test.ts
```

后端在有完整项目依赖与 pytest 的 Python 环境可运行以下命令。当前本机默认 pytest 缺失，旧临时目录没有可执行入口，因此本轮用下面说明的隔离适配执行原有断言，未安装依赖。

```powershell
Set-Location -LiteralPath 'D:\C\CLINVEXA-source-2.0.10\source'
$env:PYTHONPATH='D:\C\CLINVEXA-source-2.0.10\source\clinvexa\src;D:\C\CLINVEXA-source-2.0.10\source'
$env:PYTHONDONTWRITEBYTECODE='1'
python -m pytest -q -p no:cacheprovider clinvexa/tests/test_contract_api.py
```

隔离适配以 `importlib.util.spec_from_file_location` 加载同一个测试文件，向 `tmp_path` 提供临时目录，使用 `unittest.mock.patch.dict` 和 `patch.object` 实现测试所需的 setenv、delenv、setattr。通过 `sys.path` 从交接 wheelhouse 直接加载 pypdf、ReportLab。每个用例还原环境和补丁，测试根目录在退出时清除。通过的用例是 `test_demo_workflow_is_isolated_and_reaches_archive`、`test_import_reads_utf8_and_extracts_amount_without_retaining_the_file`、`test_model_redraft_and_legal_note_are_visible_only_to_legal`、`test_review_blocks_mismatch_then_oa_receipt_can_be_archived`、`test_timeout_keeps_rule_review_and_prevents_duplicate_oa_submission`。
