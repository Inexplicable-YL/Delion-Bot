---
name: todo
description: Find, create, update, and delete personal tasks.
---

# Personal tasks

- Find items with `delion query_todos '{"query":"expenses","completed":false}'`. The query matches titles and notes. Use `offset` and `limit` for pagination.
- Create an item with `delion save_todo '{"title":"Submit expenses","dueAt":"2026-12-01T09:00:00Z"}'`. Use UTC for due dates. Omit `dueAt` when no due date is needed.
- Update an item with `save_todo` and the ID returned by the query. Preserve its title unless the user asks to change it. Pass `"completed":true` to mark it complete or `"dueAt":null` to clear the due date.
- Confirm which item to delete, then run `delion remove_todo '{"id":"<todo-id>"}'` with its ID.
