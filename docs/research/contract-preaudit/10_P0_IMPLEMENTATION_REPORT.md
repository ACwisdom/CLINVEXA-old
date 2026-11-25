# Clinvexa 智能合同预审 P0 实施报告

实施日期为 2026-11-12（北京时间）。在现有 2.0.11 合同管理工作树加入文件导入、审查任务、原文定位、逐项复核、报告保存及历史重开。预审任务和报告独立于 OA 流转。

## 基线与需求

- 仓库为 D:\C\CLINVEXA-source-2.0.10\source，分支 main，HEAD e950733。实施前有 9 个已修改路径和 20 个未跟踪文件，暂存区无改动。将 29 个文件、Git 状态和二进制补丁备份至外层 handoff\preaudit-baseline-20261112-115624.zip，并逐文件核对 SHA256。备份包 SHA256 为 be60fa85ac2db49998ab08f1f74324ad2b6f5353bb259f99259ea89376d77405。
- 核对了本目录 01–09 调查材料、业务合同源码和医院需求目录的建设内容、合同范围图、OA 入口说明及 2234 招采文件。合同范围图要求风险位置、等级及建议。OA 表单证据见 02，当前业务范围支持收入、支出、不涉及金额及金额是否确定。表单枚举和规则仍需院方正式确认。
- 06 为接口草案。当前代码采用同步任务，返回 201，可查询运行记录并显式创建新任务补审。报告采用独立快照，JSON 用于读取，CSV 用于导出。范围和状态以本报告的接口及代码为准。

## 实现与兼容性

| 范围 | 实现 |
| --- | --- |
| 文档及要素 | TXT、DOCX、文本 PDF 复用现有读取能力。保留 TXT 行、DOCX 正文 XML 段落顺序（含表格段落）、PDF 实际页码及规范文本偏移。提取显式字段和多值候选。上传原件保存在本机 SQLite，绑定文件名、SHA256、读取状态及版本。编辑正文后使用独立的已保存文字和行号，原件仍可回查。 |
| 确定性规则 | 规则集 business-contracts / p0-1，检查合同类别、双方、金额方向、是否确定金额、资金来源、前置依据、常见条款及正文和卡片冲突。P0 仅在收入或支出且金额已确定时要求固定金额。旧接口兼容未填写新字段的旧记录，并接受显式无金额或未确定金额的合同。条款提示基于词项和类型，待经办或法务复核。 |
| 招采比对 | 只有已保存正文与上传合同原文一致，并且正文、合同卡片、材料有可核对项目号时，才判定同项目关系。招标和响应核对项目编号。中标材料归属确认后再核对相对方及适用的确定金额。部分可读材料只核对可读部分的项目号并标记部分完成。扫描件、人工摘录和歧义字段保留待核对状态。 |
| 模型 | 复用现有院内模型配置、请求及禁用重定向的连接封装。显式启用后发送分段正文、适用条款类别和必要字段。校验 JSON 结构、枚举、类型、规则类别和段内唯一逐字引文。按规则类别、范围和规范化问题内容去重，保留模型风险等级及出处。模型不可用、超时、超限、引文或结构错误时保留已保存的规则结果。 |
| 任务 | 启动时记录合同版本、输入快照和哈希、规则版本及模型名，规则执行完成后先落盘再调用模型。运行、完成、部分完成和失败可从历史查询。使用任务 UUID 重试同一请求，超过 120 秒的未终结任务在查询时标记中断，可另发任务。完成状态指本次请求覆盖范围内的执行状态，清单仍可能存在风险或待复核项。 |
| 复核 | 每条发现支持待复核、确认问题、驳回误报、补充材料。按任务复核版本检查并发写入，追加人员、决定、备注和时间。原始发现和证据可回查。操作者类型来自本机服务实例，姓名为本机登记，身份未核验。 |
| 报告 | 从任务状态生成不可变报告快照，包含合同信息、文件及解析版本、任务范围、风险、引文、模型状态、复核历史和生成时间。保存后可重新读取 JSON 并导出 UTF-8 CSV，导出沿用台账的公式注入防护。后续复核可生成新报告。 |
| 兼容 | 现有 /extract、/review、合同版本、OA、合同 PDF、台账 CSV 继续可用。工作区用能力字段选择新附件接口，旧后端继续走原上传路径。旧草稿的新字段使用默认值加载。P0 的高风险发现和人工决定只写入 P0 任务记录，送审继续使用原合同状态及送审前检查。 |

### 数据

- 同一 contracts.sqlite3 增加 contract_review_documents、contract_review_jobs、contract_review_reports。新增表按需创建，合同旧表沿用原版本机制。
- 原件归属合同 UUID。每次任务复制固定输入，记录原件或文字快照的 SHA256，发现引文的位置用 Unicode 字符偏移，起点包含、终点不包含。页、段和行从 1 开始。PDF 坐标是提取文本位置。
- 规则、模型和人工复核分别保存。报告 UUID 关联任务，保存当时的复核版本和决定历史。模型密钥和 URL 无需写入快照。原件和报告适用现有本机数据库的访问边界。

### 源码

| 文件 | 变化 |
| --- | --- |
| clinvexa/src/clinvexa/contract_evidence.py | 原件哈希、确定性解析、失败和需 OCR 状态、证据锚点 |
| clinvexa/src/clinvexa/contract_review_rules.py | 规则集、关键要素、冲突及招采比对 |
| clinvexa/src/clinvexa/contract_review_store.py | 文档、任务、复核和报告持久化 |
| clinvexa/src/clinvexa/contract_review_api.py | 独立任务、模型校验、报告和原件接口 |
| clinvexa/src/clinvexa/contract_api.py、contracts.py | 装配接口、兼容字段、旧规则金额修复 |
| tools/read_extract.py | 复用 DOCX 正文段落解析并保留旧文本提取接口 |
| apps/desktop/src/clinvexa/contracts/api.ts、workspace.tsx、workspace.css | 合同卡片、上传、服务调用、预审入口和样式 |
| apps/desktop/src/clinvexa/contracts/preaudit.tsx | 任务覆盖、证据、逐项复核、历史及报告 |
| clinvexa/tests/test_contract_preaudit.py、apps/desktop/src/clinvexa/contracts/preaudit.test.tsx | 新增后端及前端回归 |
| docs/clinvexa-business-contracts.md | 更新合同工作区使用说明 |

### 接口

路径前缀为 /clinvexa/contracts，{id} 为已保存的合同 UUID。

| 方法及路径 | 行为 |
| --- | --- |
| POST /{id}/review-documents?kind=…&name=… | 上传 application/octet-stream 原件。kind 为 contract、tender、response 或 award。返回解析状态、文本位置及可用字段。保存草稿时通过 preaudit_documents 关联文档 ID。 |
| GET /{id}/review-documents/{document_id}/original | 下载该合同的原件。 |
| POST /{id}/review-jobs | 输入 revision、可选 use_model、可选 job_id。同步执行并返回持久记录。 |
| GET /{id}/review-jobs 与 GET /{id}/review-jobs/{job_id} | 查询历史、覆盖范围、快照、证据及复核。 |
| PUT /{id}/review-jobs/{job_id}/findings/{finding_id}/decision | 提交 revision、status、reviewer、note。复核版本冲突返回 409。 |
| POST 与 GET /{id}/review-jobs/{job_id}/reports | 以 JSON 空对象创建报告，或读取报告目录。 |
| GET /{id}/review-jobs/{job_id}/reports/{report_id}?format=json 或 csv | 重开保存时的报告，或下载 CSV。 |

## 本地验证

| 项目 | 执行结果 |
| --- | --- |
| Python | 仓库脚本执行 3 个文件共 31 项。包含 5 个既有合同用例、15 个 P0 用例、11 个通用读取用例。测试使用真实 FastAPI TestClient、SQLite 和解析库。院内模型、OA 回执和中断时钟在指定用例中模拟。 |
| React | Vitest 5 个相关文件共 15 项通过。验证历史任务、部分完成、Unicode 引文、逐项决定及报告只读，HTTP 由测试替身提供。 |
| 构建 | 完整桌面 npm build 和 typecheck 通过。构建产物包括 Vite 渲染包、Electron 主进程和 preload。 |
| 真实文件 | 2234 招标文件抽取 38,704 字，可读页有项目号，第 1 页无文字。中标与技术响应文件无可提取文本，标记需 OCR。规范化后识别出一个唯一项目号。两份需求 DOCX 解析成功。目录内没有同项目脱敏合同，真实项目的金额与相对方比对待验。 |
| Windows 本地客户端 | Electron 40.10.2 源码客户端通过真实侧栏进入合同管理，实测建档、上传、规则运行、原文高亮、逐项复核、CSV 实际下载及刷新后重开任务与报告。使用合成合同、预先启动的本机 Uvicorn/FastAPI 和临时 SQLite，合同请求走真实 HTTP。隔离 Electron 渲染测试也通过同一闭环。 |
| 瑞金云桌面 | Computer Use 找到 aDesk 独享桌面窗口，辅助功能只返回外层窗格和水印控件，截图多次出现 window capture timed out。Build 17763 客户端安装、启动和预审闭环尚待现场核验。 |

后端复跑命令使用本轮建立的临时 Python 环境。

~~~powershell
Set-Location -LiteralPath 'D:\C\CLINVEXA-source-2.0.10\source'
$env:HERMES_PYTHON=(Join-Path $env:TEMP 'clinvexa-p0-venv/Scripts/python.exe').Replace('\','/')
$env:PYTHONDONTWRITEBYTECODE='1'
& 'D:\Git\bin\bash.exe' scripts/run_tests.sh clinvexa/tests/test_contract_api.py clinvexa/tests/test_contract_preaudit.py tests/tools/test_read_extract.py -q -p no:cacheprovider
~~~

~~~powershell
Set-Location -LiteralPath 'D:\C\CLINVEXA-source-2.0.10\source'
npm.cmd run test --workspace apps/desktop -- src/clinvexa/contracts/preaudit.test.tsx src/clinvexa/contracts/workspace.test.tsx src/clinvexa/copilot/compare.test.ts src/clinvexa/task-state.test.ts src/clinvexa/clinvexa-shell.test.tsx
~~~

~~~powershell
Set-Location -LiteralPath 'D:\C\CLINVEXA-source-2.0.10\source'
npm.cmd run typecheck --workspace apps/desktop
npm.cmd run build --workspace apps/desktop
~~~

## 演示路径

1. 进入合同管理，新建或从台账选择合同。导入授权的 TXT、DOCX 或文本 PDF。新建合同首次上传会先保存基本草稿。
2. 核对自动提取字段，选择合同类型、金额方向、金额确定性及资金来源。适用招采时分别上传招标、响应和中标文件。保存草稿。
3. 在「智能合同预审」创建规则任务。院内模型已配置时可选择规则与模型任务。查看已执行及未检查范围，展开具体引文定位。
4. 逐项填写复核决定、登记姓名与备注并保存。生成并保存报告，导出 CSV。
5. 重新打开合同，选择历史任务和已保存的报告。修改草稿并重新发起任务后，可按合同版本区分两次结果。

本地完整冷启动另行验证。初期 86% 对应等待本地网关端口，隔离环境中的 FastAPI 与 Starlette 版本不匹配及缺少 Windows 日志依赖已排查并补齐。网关实测就绪后，临时 Electron 外壳缺少离线语音资源清单，合同闭环测试使用预先启动的合同服务。测试环境的模型目录配置用于打开通用桌面界面，P0 合同测试运行确定性规则。

## 工作树检查

实施结束后按备份重新计算文件哈希。23 个基线文件逐字节一致，6 个既有文件只有本报告所列的有意修改，另有 10 个 P0 变更路径。HEAD 和暂存区与备份一致。新改动文件均按 UTF-8 验证，排除了测试耗时缓存、真实合同、凭据、数据库和临时导出文件。Git 差异检查使用 cr-at-eol 识别既有 Windows 换行。

## 上线前待验证

- 由院方确认业务类型、金额规则、资金来源、条款及严重度，补齐脱敏样本、相应标注和同项目招采对照。现有阈值、条款提示和规则版本用于 P0 试运行，样本准确率及风险召回尚待实测。
- 院内模型需确认端点、版本、JSON 输出支持、文本范围及延时。当前单次模型审查限定为 24,000 字和 1,500 个位置，长文显示未检查。OCR 尚未接入，后续可在解析入口扩充带页码、偏移和可靠性的数据，保持任务证据结构。
- 医院身份、角色、按合同授权、原件与审查数据的留存期限、存储加密和审计需要正式设计及验证。当前 SQLite 原件为本机明文 BLOB，人工复核姓名由操作者登记。
- Build 17763 的离线包、真实用户权限和同机服务需由院方验证。全文履约条款比对、OA 附件联动和正式 OA 审批属于后续联调。
