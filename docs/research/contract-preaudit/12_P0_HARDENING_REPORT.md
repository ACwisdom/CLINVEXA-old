# Clinvexa P0 预审加固报告

2026-11-12（北京时间）。工作树为 `D:\C\CLINVEXA-source-2.0.10\source`，`main` 的 HEAD 为 `e950733`。本轮接续工作树内未提交的 2.0.11 合同预审和打包改动，阅读 01–11、Git 差异及合同和桌面启动入口。现场步骤和试点阻塞分别见 [13](13_REAL_ENVIRONMENT_ACCEPTANCE.md) 与 [14](14_HOSPITAL_DELIVERY_BLOCKERS.md)。

## 门禁与业务边界

现有 `/review` 更新合同状态，正式 `/submit` 仍执行原送审前检查。P0 的 `/review-jobs` 保存独立任务。桌面「预审准入演练」调用 `POST /clinvexa/contracts/{id}/submission-rehearsal`。后端按合同 ID、精确的已保存版本、最新创建的对应任务和最新复核决定判断。规则任务、合并后的模型高风险及覆盖情况都参与判断。切换到新合同版本后需重新预审。演练接口不修改合同状态，也不调用 OA。

| 策略值 | 判断依据 |
| --- | --- |
| `not_reviewed` | 当前版本没有对应的预审任务 |
| `high_risk_pending` | 阻断等级的规则或模型发现仍待复核或补证 |
| `high_risk_confirmed` | 阻断等级发现最近一次决定为确认 |
| `needs_materials` | 存在补证决定，或适用的招采材料覆盖未完成 |
| `review_incomplete` | 任务运行中、失败或部分完成 |
| `model_incomplete` | 模型未执行或未完成，响应同时给出细分状态，包括超时 |

运行目录 `config.yaml` 的 `contract_preaudit.block` 显式列出演练阻断项，默认空列表。院方是否将模型设为必需由 `model_incomplete` 决定。纯规则任务完成且无相关风险时，可以在纯规则策略下通过。演练返回准入结果、全部诊断原因、命中的阻断原因、任务 ID、复核版本和模型状态。配置无效时演练接口返回 503。

模拟例外须同时具备隔离演示工作区、进程法务权限和 `allow_exception: true`。以演练接口提交 `revision` 及非空 `exception_reason`，记录原判断、策略、时间、操作者和待补审状态。同一合同版本重复提交同理由返回已有记录。通过 `POST /clinvexa/contracts/{id}/submission-rehearsal/{exception_id}/followup` 传 `revision`，补审需为放行后创建、同一版本的已完成任务，并解决原策略和现策略的阻断项。审计保留放行和补审的任务/复核版本。该权限仅代表本机演练权限。

## 启动与安全

- Electron 使用产品运行时的 Python 自动启动 Uvicorn。现有 Python 就绪时提前启动，首次安装可在依赖完成后重试。健康校验匹配合同能力和当前桌面会话证明，避免复用其他 8001 服务。启动重试有退避和上限，子进程异常退出由客户端重拉。
- 语音校验从 HTTP 监听启动移出，记录缺清单、校验失败或完成。现有离线清单 84 个文件的 SHA256 均一致。打包仍通过离线语音资源校验，语音本身的远端可用性待现场核验。
- 合同全路由需要 Electron 主进程注入的随机会话凭据。仅本机主窗口认可的顶层页面发出的请求可获注入。合同响应禁止缓存，服务关闭 Uvicorn 访问日志，合同参数错误和未知异常使用脱敏提示，PDF 解析器原始告警不输出到桌面日志。合同 ID 与原件、任务、报告和例外均按所属记录核对。
- 复核拒收请求提供的复核人或角色。服务取操作系统登录名，读取失败则记录本机服务账号标识。历史自由登记记录仍可读。原合同的法务摘要、修订建议和法务意见继续按进程角色过滤。会话认证、对象 ID 归属检查和服务写入姓名的测试覆盖局部缺陷，医院身份及跨用户授权仍需现场接入。
- 数据仍位于单用户明文 SQLite，原件 BLOB、工作快照、复核和报告均受该目录的 OS 权限保护。具备同账号调试/文件权限的进程或管理员仍处于该信任边界内。试点需由院方明确统一身份、密钥、ACL、加密、备份恢复、导出和留存要求。

## 模型与 2234 OCR

真实验收环境按用户要求为瑞金云桌面。资料目录有「开发关键信息 / 院内模型.txt」及其 HTTP 端点信息。此次 aDesk 仅可见外层窗格，未从远端读取配置、探测 TCP、验证认证或发送合成推理请求。无真实模型名、返回、延时或成功证据可签收。已有规则审查可独立使用。合成模型响应测试覆盖引文校验、错误类型、超时降级和去重。本机另以回环 HTTP 模拟端点验证实际请求封装和一条合成发现的引文。本轮在真实调用路径加入模型耗时与可用时的 HTTP 状态，CSV 导出耗时。

| 本机只读解析 | 实测结果 |
| --- | --- |
| 2234 招标文件 | 63 页，62 页可读，38,704 字，第 1 页需 OCR，状态部分完成 |
| 2234 中标通知书 | 1 页无可提取文本，需 OCR |
| 2234 技术响应文件 | 422 页无可提取文本，需 OCR |

本机 Windows 能枚举 WinRT PDF 与简体中文 OCR 语言，瑞金 17763 上的组件、权限和识别质量未验证。本轮提供 `ContractOcr` 可注入适配接口，默认不加载引擎。每份 PDF 向适配器提供最多 24 个缺文本页的 1 起始页码，约束文本总量，适配器负责限制执行时间并省略低质量页。只接收请求页的结果，保留原件 SHA256，证据落到对应页码和 Unicode 偏移，标为 OCR 待核验。OCR、混合未核验或人工摘录材料不触发同项目中标字段自动比对。用合成件验证回填、失败后保留原生页和异项目防护。未引入 OCR 大型依赖。

## 代码与验证

| 范围 | 路径与结果 |
| --- | --- |
| 演练策略与审计 | `contract_gate.py`、`contract_review_store.py`、`contract_review_api.py` |
| 认证、启动及独立入口 | `clinvexa/main.py`、`electron/main.ts`、桌面首次使用页与合同工作区 |
| OCR 接缝 | `contract_evidence.py`、合同路由装配、预审证据界面 |
| 自动化验证 | Python 52 项通过。覆盖旧送审、策略读取、各门禁状态、例外持久化与补审、跨合同读取拒绝、裸请求 401、伪造复核姓名拒绝、OCR 适配及降级。模型和 OA 上游响应为模拟。TypeScript 类型检查、桌面构建和 6 个 Vitest 文件共 20 项通过。 |
| 本地源码客户端 | 在 Windows x64 Build 19045、Electron 40.10.2、隔离运行目录和已有开发 Python 下，以空端口和测试进程占用 8001 两种场景各跑一次。未配置模型、未预启 Uvicorn、无语音清单时可从首次使用页进入合同管理。合成合同导入、保存、规则审查、准入、引文高亮、复核、CSV 下载、进程中断后重拉、台账及报告重开通过。裸 HTTP 合同请求返回 401。 |
| 本地打包客户端 | 在 Build 19045 直接运行本轮 `win-unpacked/CLINVEXA.exe`。全新隔离运行目录，无开发 Python 覆盖、无模型配置、未预启服务。应用使用离线包展开 Python 3.11.15、Git 和锁定依赖，首次引导约 3 分 39 秒，随后自动启动 Uvicorn。真实 HTTP、SQLite、合成合同导入至报告下载和重开通过。终止本轮服务后 PID 从 31496 变为 33568，恢复后裸请求仍为 401。首次测试脚本在引导完成前结束，延长测试等待后用新的空目录复跑通过。 |
| Windows 构建与交付物 | Electron x64 解包构建通过，包内合同 Python 模块与当前源码的 SHA256 一致。Inno Setup 以 `MinimumWindowsVersion=10.0.17763` 成功编译完整包。产物为 `handoff/p0-hardening/CLINVEXA-2.0.11-p0-hardening-vdi-win1809-x64.exe`，3,795,022,682 字节，SHA256 为 `30be279eb77b8b28cd4faaef4e1ca9efbeaa451862dfa0f6bb9c0db40d16ffe6`，二次核对一致。试验包未签名，安装器在 17763 上尚未运行。 |
| 瑞金 17763 | 无法验证。未安装、未启动远端应用，未操作真实合同、审批或生产数据 |

本轮未提交 Git、未部署生产，暂存区为空，测试耗时缓存已恢复。交付目录的首次打包临时备份 `win-unpacked.bak` 仍在，自动执行策略拒绝对该目录执行递归清理。现场签收要求见 [13](13_REAL_ENVIRONMENT_ACCEPTANCE.md)。

本机自动化复跑命令使用已有的隔离测试环境。

```powershell
Set-Location -LiteralPath 'D:\C\CLINVEXA-source-2.0.10\source'
$env:HERMES_PYTHON=(Join-Path $env:TEMP 'clinvexa-p0-venv/Scripts/python.exe').Replace('\','/')
$env:PYTHONDONTWRITEBYTECODE='1'
& 'D:\Git\bin\bash.exe' scripts/run_tests.sh clinvexa/tests/test_contract_api.py clinvexa/tests/test_contract_preaudit.py clinvexa/tests/test_skill_install.py tests/tools/test_read_extract.py -q -p no:cacheprovider
npm.cmd run typecheck --workspace apps/desktop
npm.cmd run test --workspace apps/desktop -- src/clinvexa/contracts/preaudit.test.tsx src/clinvexa/contracts/workspace.test.tsx src/clinvexa/copilot/compare.test.ts src/clinvexa/task-state.test.ts src/clinvexa/clinvexa-shell.test.tsx src/components/onboarding/index.test.tsx
npm.cmd run build --workspace apps/desktop
```

## 生产部署执行状态（2026-11-12）

用户已明确要求部署生产，本轮转为执行瑞金 aDesk 部署。交付包本机复核：`CLINVEXA-2.0.11-p0-hardening-vdi-win1809-x64.exe`，3,795,022,682 字节，SHA256 `30BE279EB77B8B28CD4FAAEF4E1CA9EFBEAA451862DFA0F6BB9C0DB40D16FFE6`，Authenticode 状态 `NotSigned`。本机 C 盘余量 18.07 GiB，不代表远端 C 盘空间。aDesk 窗口仍可枚举，但激活后画面采集超时；重新枚举并重试后仍超时。本轮未向云桌面传包、未运行安装器、未改生产配置或数据库。因此生产部署未完成，也未声称远端 17763 验收通过。需要现场人员在瑞金云桌面按 [13](13_REAL_ENVIRONMENT_ACCEPTANCE.md) 完成校验安装与合成闭环。
