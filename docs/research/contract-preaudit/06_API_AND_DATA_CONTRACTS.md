# 接口与数据契约

## 现有接口

合同服务位于 `127.0.0.1:8001`，以下业务路径都以 `/clinvexa/contracts` 为前缀。注册见 `clinvexa/src/clinvexa/contract_api.py:263`。

| 方法与路径 | 已有行为 |
| --- | --- |
| `GET ""`、`GET /{id}` | 本地台账、模板、模型/OA 配置状态和单份记录 |
| `POST /extract?name=...` | 流式写临时文件后提取纯文本和字段。未留存原件；不支持扫描文字识别 |
| `PUT /{id}` | `revision=0` 建档，现有草稿走版本检查 |
| `POST /{id}/review` | 同步规则预审，可选院内模型。输入 `revision` 和 `use_model`，返回更新后的合同 |
| `POST /{id}/submit`、`/receipt`、`/resolve-submission` | 建 E9 测试流程、经办人登记回执、核实后解除不确定状态 |
| `POST /{id}/legal-review` | 进程为法务工作区才允许写入意见 |
| `GET /{id}/versions`、`/compare`、`/pdf`，`GET /ledger.csv`、`/risks.csv` | 快照、按行差异、合同 PDF 以及台账/风险 CSV |
| `POST /{id}/seal`、`/archive` | 登记用印件并按状态归档 |

当前 `Finding` 是 `level, source, issue, suggestion`，`ContractReview` 含 `findings, ai_status, legal_summary, suggested_revision`。它们缺少逐项结构化证据、模型/规则版本和复核记录。路由为本机访问设计，没有医院级身份认证。

## 院方 OA 文档和真实页面

- 《关于第三方系统调用E9创建流程接口说明文档（Restful）》描述 `POST /api/workflow/paService/doCreateRequest`，表单参数包括 `workflowId, requestName, mainData`，支持 `detailData`。成功返回 `code=SUCCESS` 与 `data.requestid`。认证头包含 `appid, token, userid`，具体注册和用户标识加密遵照院方说明。
- 文档提供附件字段的文件名与路径或 base64 形状，现有 `_oa_body` 未传附件。附件区、权限和大小限制待院内实测。状态回读当前由经办人核实登记。
- 业务合同1截图确认 `workflowid=273`。合同类型、资金来源在当前表单必填，标的额情况和是否确定金额有选项。现有 `OA_FIELDS` 没有这些键。界面标签不等同于 `fieldName` 和选项编码。还需确认合同编号生成、附件和审批读接口。
- 模拟用例的 workflow 42 与请求编号 123 是合成值。配置只放部署环境，交接文档不得包含凭据或真实合同内容。

## 建议 P0 接口（草案）

| 方法与路径 | 入参、响应和边界 |
| --- | --- |
| `POST /{id}/review-jobs` | `contract_revision`、材料文档 ID/哈希、规则集版本和模型配置引用。返回 202、`job_id`、输入标识。幂等键相同而输入不同返回冲突 |
| `GET /{id}/review-jobs/{job_id}` | 状态、阶段、诊断、已完成范围、发现项和复核摘要。按合同/岗位验证访问 |
| `PUT /{id}/review-jobs/{job_id}/findings/{finding_id}/decision` | `accepted/dismissed/needs_evidence`、理由、任务版本，身份由服务端取得。冲突返回 409 |
| `GET /{id}/review-jobs/{job_id}/report` | 按权限导出绑定任务快照的清单，带规则版本和人工结论 |

数据契约草案示例全部为合成值。

```json
{
  "job_id": "review-test-01",
  "contract_revision": 3,
  "status": "needs_review",
  "coverage": {"contract": "complete", "award": "manual_verified", "response": "not_checked"},
  "documents": [{"id": "doc-test-01", "kind": "contract", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "parse_status": "complete", "parser_version": "p0"}],
  "elements": {"amount": {"value": "12500.00", "currency": "CNY", "evidence_ids": ["e-1"]}},
  "rule_set": {"id": "business-contracts", "version": "draft-1"},
  "model": {"reference": "approved-internal-model", "status": "skipped"},
  "findings": [{
    "id": "f-1", "level": "warning", "origin": "rule",
    "rule": {"id": "PAYMENT", "version": "1", "source_id": "approved-rules-fixture"},
    "issue": "付款条件有待核对", "suggestion": "明确验收与付款的对应条件",
    "evidence": [{"id": "e-1", "document_id": "doc-test-01", "page": 2, "start": 10, "end": 17, "quote": "验收后按约付款"}],
    "decision": {"status": "pending"}
  }]
}
```

生产契约中哈希须为 SHA256，偏移按该文档版本的规范文本计、区间左闭右开。PDF 页码从 1 起，Word 段落/表格位置单列。真实语义风险以证据验证和人审为准。任务状态至少覆盖 queued、running、needs_review、completed、partial、failed、cancelled；降级原因与进度可重开。
