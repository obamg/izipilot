---
name: Prefer parallel execution
description: User wants agents and independent tasks to run in parallel whenever possible
type: feedback
---

Run tasks in parallel when they have no dependencies between them. Don't serialize work that can be done concurrently.

**Why:** User explicitly asked for parallel execution — values speed and efficiency.

**How to apply:** When multiple agents or tasks are independent (no shared file conflicts, no data dependencies), launch them simultaneously using parallel Agent calls or parallel tool calls.
