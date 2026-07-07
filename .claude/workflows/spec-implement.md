# /spec-implement

按以下步骤实现功能:

1. 读取 `specs/$ARGUMENTS/spec.md`，理解要做什么和验收标准
2. 读取 `specs/$ARGUMENTS/design.md`（如果存在）
3. 读取 `specs/$ARGUMENTS/tasks.md`
4. 按 tasks.md 逐条实现:
   - 每完成一条，勾选 `- [x]`
   - 每完成一条，确认 `npm run typecheck` 通过后，再继续下一条
5. 全部完成后，运行 `npm run typecheck && npm run lint`
6. 如果有测试，运行 `npm test`
7. 输出实现总结 + 未覆盖的边缘 case
