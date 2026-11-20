---
name: todo
description: 查询、新建、更新和删除个人待办。
---

# 个人待办

- 查询：`delion query_todos '{"query":"报销","completed":false}'`。匹配标题和备注，可用 `offset` 和 `limit` 分页。
- 新建：`delion save_todo '{"title":"提交报销","dueAt":"2026-12-01T09:00:00Z"}'`。截止时间使用 UTC；不需要截止时间时省略 `dueAt`。
- 更新：用查询返回的 ID 调用 `save_todo`。保留标题，传 `"completed":true` 标为完成，传 `"dueAt":null` 清除截止时间。
- 删除：确认要删除的条目后，用其 ID 调用 `delion remove_todo '{"id":"待办 ID"}'`。
