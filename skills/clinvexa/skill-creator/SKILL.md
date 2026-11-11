---
name: skill-creator
description: Use when creating or updating CLINVEXA skills.
---

# CLINVEXA Skill 创建器

创建可执行、可检索、可维护的 CLINVEXA Skill，并发布到 Skill 广场使用的同一目录。

## 创建流程

1. 从用户任务中确认 Skill 名称、触发场景、输入、输出和完成标准；名称使用小写字母、数字与连字符。
2. 只规划会重复使用的指令和必要资源，不创建 README、安装说明或变更日志。
3. 编写包含 `name` 与 `description` 的完整 `SKILL.md`；描述先写触发条件，并保持一句话。
4. 调用 `skill_manage(action="create", name="<name>", category="clinvexa", content="<完整 SKILL.md>")`。`category="clinvexa"` 不得省略，否则 Skill 不会进入 CLINVEXA Skill 广场目录。
5. 需要脚本、参考资料或模板时，使用 `skill_manage(action="write_file", ...)` 写入 `scripts/`、`references/` 或 `assets/`；没有实际需要时不创建。
6. 使用 `skill_view(name="<name>")` 重新读取结果，确认文件完整、名称一致且没有占位内容。
7. 使用新 Skill 完成一次真实任务；成功后告知用户可在 Skill 广场按名称检索并点击“运行”。

## 更新流程

先用 `skill_view` 读取现有内容。小范围修改使用 `skill_manage(action="patch", ...)`；只有整体结构需要重写时才使用 `edit`。修改完成后重新读取并执行一次真实任务。

## 失败处理

创建、写入、读取或真实任务验证任一步失败时，明确返回失败环节和工具错误，不得宣称 Skill 已发布。缺少 `skill_manage` 或 `skill_view` 时返回“当前环境无该工具可调用”。

## 质量要求

- 指令使用明确动作和可验证结果，不写产品宣传。
- 医疗 Skill 必须保留来源证据、标注不确定性，并要求医生复核。
- 不编造不存在的工具、数据源或接口；缺少工具时明确返回当前环境无该工具可调用。
- 创建结果必须位于 `skills/clinvexa/<skill-name>/`，以便 CLINVEXA 与 Skill 广场从同一来源发现。
