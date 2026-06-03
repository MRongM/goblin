# Worktree Path Row Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show full worktree paths in left branch-list rows, above the existing commit metadata line.

**Architecture:** Keep the change inside `BranchRow`. The component already receives `branch.worktree.path`, so the implementation only adds conditional rendering and focused tests.

**Tech Stack:** TypeScript, React, Vitest, renderer component tests.

---

## Project Constraint

The project instructions say not to plan or execute git commits unless the user explicitly asks. This plan intentionally omits commit steps.

## File Structure

- Modify `src/renderer/components/branch-list/BranchRow.test.tsx`
  - Add focused tests for the new worktree path line.
- Modify `src/renderer/components/branch-list/BranchRow.tsx`
  - Render full `branch.worktree.path` as a dedicated line above commit metadata.

## Task 1: Branch Row Worktree Path Line

**Files:**

- Modify: `src/renderer/components/branch-list/BranchRow.test.tsx`
- Modify: `src/renderer/components/branch-list/BranchRow.tsx`

- [x] **Step 1: Write the failing test**

Add a test that renders a worktree row with `worktreePath: '/Users/example/project-feature'` and commit text `Fix branch status`. Assert that the path and commit message are rendered in separate spans and that the path span appears before the commit span.

- [x] **Step 2: Run the focused test to verify it fails**

Run:

```sh
bun run test src/renderer/components/branch-list/BranchRow.test.tsx
```

Expected: FAIL because the row does not yet render a dedicated worktree path line.

- [x] **Step 3: Implement the minimal row rendering change**

In `BranchRow.tsx`, compute:

```ts
const worktreePath = branch.worktree?.path ?? ''
```

Then render this path between the first branch-name row and the existing commit metadata row only when `worktreePath` is non-empty:

```tsx
{worktreePath && (
  <span
    className={cn(
      'col-start-2 min-w-0 truncate font-mono text-xs',
      isSelected ? 'text-selected-muted-foreground' : 'text-muted-foreground',
    )}
    title={worktreePath}
    data-worktree-path
  >
    {worktreePath}
  </span>
)}
```

Keep the existing commit metadata row unchanged except that it naturally becomes the next grid row.

- [x] **Step 4: Run the focused test to verify it passes**

Run:

```sh
bun run test src/renderer/components/branch-list/BranchRow.test.tsx
```

Expected: PASS.

- [x] **Step 5: Run broader verification**

Run:

```sh
bun run typecheck
```

Expected: PASS.
