# CLINVEXA 阶段 3 交付报告

**阶段：** Skill 广场  
**交付日期：** 2026-08-04  
**结论：** **Go**  
**下一阶段：** 允许进入阶段 4（HIS RPA 与综合交付验收）

## 1. 交付范围

本阶段在一个 CLINVEXA Python 服务、一个 Hermes Runtime 和现有 Desktop 内实现本地/院内 Skill 广场，没有引入额外数据库、消息队列或微服务。

- 提供 20 个内置医疗 Skills，覆盖平台、科室和医生个人三种标签。
- 支持浏览、搜索、安装、启用、禁用、卸载和版本切换。
- 安装结果直接同步至当前 Hermes Profile 的 Skills 目录，并刷新 Hermes Skill 发现缓存。
- CLINVEXA 侧边栏可打开 Skill 广场，并以 `$skill-name 任务` 形式走现有 Hermes 对话路径运行已启用 Skill。
- 缺少依赖、缺少 `SKILL.md`、元数据不一致、重复安装和不可用版本均返回明确原因，不伪造成功状态。
- CLINVEXA 本地服务固定监听 `127.0.0.1:8001`。

## 2. 已完成任务

- [x] 实现本地/院内 Skill 目录、搜索、分类和详情展示。
- [x] 实现安装、启用、禁用、卸载和版本切换，并同步到 Hermes Skills 目录。
- [x] 支持平台、科室和个人标签，允许医生从侧边栏快速运行已启用 Skill。
- [x] Skill 缺少依赖或安装失败时显示明确原因，不影响其他 Skills 和主会话。
- [x] 创建并校验 20 个内置医疗 Skills 及统一目录清单。
- [x] 完成 Python API、Desktop UI、Hermes 原生发现、100 次生命周期和异常包自动化验收。

## 3. 交付功能

### Skill 目录与生命周期

- 稳定目录顺序、关键词搜索及平台/科室/个人范围标签。
- 原子安装与版本替换；失败时不覆盖已安装版本。
- 禁用目录位于 Hermes `skills` 树之外，避免被原生递归发现。
- 安装、启停、切换和卸载后立即失效 Hermes Skill 缓存，新会话无需重装客户端。
- 仅删除经过直接子目录校验的 CLINVEXA 管理目录。

### Desktop 与 API

- Skill 广场列表、搜索、安装、启停、卸载、版本选择和运行入口。
- 所有 UI 操作调用 `http://127.0.0.1:8001/clinvexa/skills`，不使用伪造的前端状态。
- 服务不可用或操作失败时展示服务返回的具体错误文本。

### 20 个内置 Skills

1. 病历结构化
2. 病历质量检查
3. 门诊摘要
4. 出院小结
5. 随访计划
6. 患者宣教
7. 患者一页摘要
8. 检验趋势复核
9. 用药核对
10. 过敏冲突检查
11. 诊断确定性检查
12. 临床知识检索
13. 指南证据摘要
14. 文献初筛
15. 科研数据提取
16. 会诊记录草稿
17. 转诊记录草稿
18. 护理交班摘要
19. 知情同意解释
20. 医学翻译

所有内置 Skills 均要求基于输入证据、保留医生复核，不虚构不可用工具的执行结果。

## 4. 主要交付文件

### Python 服务

- `clinvexa/src/clinvexa/skills.py`
- `clinvexa/src/clinvexa/main.py`
- `clinvexa/tests/test_skill_install.py`
- `clinvexa/pyproject.toml`

### Desktop

- `apps/desktop/src/clinvexa/skill-plaza/api.ts`
- `apps/desktop/src/clinvexa/skill-plaza/index.tsx`
- `apps/desktop/src/clinvexa/skill-plaza/index.test.tsx`
- `apps/desktop/src/clinvexa/clinvexa-desktop.tsx`
- `apps/desktop/src/clinvexa/sidebar/index.tsx`
- `apps/desktop/src/clinvexa/clinvexa-shell.test.tsx`

### Skill 包

- `medical-skills/catalog.json`
- `medical-skills/*/SKILL.md`（20 个）
- `medical-skills/*/agents/openai.yaml`（20 个）

## 5. 阶段门禁结果

| 通过标准 | 实测结果 | 判定 |
|---|---:|---|
| 至少 20 个内置 Skills 可浏览、安装和执行，完整操作成功率 100% | 20/20 可浏览、安装、由 Hermes 原生发现并生成显式调用，100% | 通过 |
| 启用/禁用后无需重装客户端即可在新会话生效 | 禁用后从 Hermes `skills_list` 消失，启用后立即恢复 | 通过 |
| 连续 100 次安装、卸载和版本切换无残留、重复条目和启动失败 | 100/100 循环通过；每轮安装条目为 1、卸载后为 0，最终无目标目录 | 通过 |
| 损坏、缺少 `SKILL.md` 或依赖不可用的包被拒绝并显示具体原因 | 分别返回名称不一致、`missing SKILL.md`、`missing dependency` | 通过 |

## 6. 验证记录

| 验证项 | 结果 |
|---|---|
| CLINVEXA Python 全量测试 | 58 passed，0 failed |
| Skill 生命周期专项测试 | 6 passed，0 failed |
| CLINVEXA Desktop UI 测试 | 23 passed，0 failed |
| TypeScript 类型检查 | 通过 |
| Ruff | `All checks passed!` |
| 20 个 Skill 官方格式校验 | 20/20 `Skill is valid!` |
| Desktop 生产构建 | 通过，产物完整性检查通过 |
| CLINVEXA 旧工作端口语义扫描 | 0 命中 |
| CLINVEXA 凭据模式扫描 | 0 命中 |

100 次完整生命周期测试所在专项文件本轮耗时 44.1 秒；该时间还包含其余五项 Skill/API 测试及测试进程启动，不作为模型推理性能指标。

## 7. 已知限制与遗留风险

- V1 Skill 仓库为可信的本地/院内静态目录，不包含公开社区、支付、评论或排行榜，符合已确认的精简范围。
- 当前依赖检查使用目录中声明的运行时标识；未来加入需要 Python/系统包的 Skill 时，必须显式注入已验证依赖清单。
- Hermes 未提供公开的 Skill 缓存失效 API，CLINVEXA 在生命周期边界清理其内部缓存；若升级 Hermes，需要将此项列入回归检查。
- 当前源码目录缺少 `.git` 元数据，生产构建使用占位提交号；正式打包前必须恢复可追溯 Git checkout。
- npm 与 Vite 输出存在上游弃用警告，但测试、类型检查、生产构建和产物完整性检查均未失败。
- N260 稳定性、真实或模拟 HIS 自动操作和全链路 E2E 属于阶段 4，未在本阶段声明通过。

## 8. Go/No-Go 结论

阶段 3 的全部交付任务和硬性通过标准均有本轮自动化测试、Hermes 原生发现验证及生产构建证据，未发现阻止进入下一阶段的缺陷。

**最终结论：Go。允许进入阶段 4，开始 HIS RPA 与综合交付验收。**
