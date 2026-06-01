# Hide Remote Tracking Branches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide `origin/*` remote-tracking branches from the main branch list while keeping the toolbar checkout menu available.

**Architecture:** Keep `repo.data.branches` as the canonical snapshot, including remote-tracking branches. Add a renderer-only branch-list visibility rule in `branch-view-mode.ts` so the branch list, keyboard navigation, selection fallback, and drag reorder all agree on the same visible set. Leave `RepoToolbarActions` reading `repo.data.branches` directly for checkout menu items.

**Tech Stack:** TypeScript, React renderer store helpers, Zustand store state, Vitest.

---

## File Structure

- Modify: `src/renderer/stores/repos/branch-view-mode.test.ts`
  - Adds focused tests for hiding remote-tracking branches from visible branch sets and selection fallback.
- Modify: `src/renderer/stores/repos/branch-view-mode.ts`
  - Adds one local visibility helper and routes list/selection/reorder helpers through it.
- Verify existing behavior: `src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx`
  - Existing tests already assert toolbar checkout remains visible for remote-tracking branches.

No git commit step is included because the user explicitly requested no commit.

## Task 1: Lock Branch List Visibility With Tests

**Files:**
- Modify: `src/renderer/stores/repos/branch-view-mode.test.ts`
- Reference: `src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx`

- [ ] **Step 1: Add a remote-tracking branch helper to the test file**

Insert this helper after the existing `repo(...)` helper:

```ts
function remoteTrackingBranch(name: string): BranchInfo {
  const slash = name.indexOf('/')
  return branch(name, {
    remoteTracking: true,
    remoteName: slash > 0 ? name.slice(0, slash) : undefined,
    localName: slash > 0 ? name.slice(slash + 1) : undefined,
  })
}
```

- [ ] **Step 2: Add a failing visibleBranches test**

Append this test inside the existing `describe('visibleBranches', () => { ... })` block:

```ts
test('hides remote-tracking branches from every branch list view mode', () => {
  const branches = [
    branch('main', { worktreePath: '/repo' }),
    branch('feature/plain'),
    remoteTrackingBranch('origin/feature/x'),
  ]

  expect(visibleBranches(repo({ branches, branchViewMode: 'all' })).map((b) => b.name)).toEqual([
    'main',
    'feature/plain',
  ])
  expect(visibleBranches(repo({ branches, branchViewMode: 'worktrees' })).map((b) => b.name)).toEqual(['main'])
  expect(visibleBranches(repo({ branches, branchViewMode: 'no-worktree' })).map((b) => b.name)).toEqual([
    'feature/plain',
  ])
})
```

- [ ] **Step 3: Add a failing selection fallback test**

Append this test inside the existing `describe('selectedBranchForBranchSet', () => { ... })` block:

```ts
test('falls back when the selected branch is a hidden remote-tracking branch', () => {
  const branches = [
    branch('main', { worktreePath: '/repo' }),
    branch('feature/plain'),
    remoteTrackingBranch('origin/feature/x'),
  ]

  expect(
    selectedBranchForBranchSet({
      branches,
      currentBranch: 'main',
      selectedBranch: 'origin/feature/x',
      viewMode: 'all',
    }),
  ).toBe('main')
  expect(
    selectedBranchForBranchSet({
      branches,
      currentBranch: 'main',
      selectedBranch: 'origin/feature/x',
      viewMode: 'no-worktree',
    }),
  ).toBe('feature/plain')
})
```

- [ ] **Step 4: Add a failing reorder test**

Append this test inside the existing `describe('visibleBranches', () => { ... })` block after the manual order tests:

```ts
test('manual order ignores hidden remote-tracking branches in the visible list', () => {
  const branches = [
    branch('main'),
    remoteTrackingBranch('origin/feature/x'),
    branch('feature/a'),
    branch('feature/b'),
  ]

  expect(
    visibleBranches(
      repo({
        branches,
        branchViewMode: 'all',
        branchOrder: ['origin/feature/x', 'feature/b', 'main', 'feature/a'],
      }),
    ).map((b) => b.name),
  ).toEqual(['feature/b', 'main', 'feature/a'])
})
```

- [ ] **Step 5: Run the focused test and confirm it fails**

Run:

```bash
bun run test src/renderer/stores/repos/branch-view-mode.test.ts
```

Expected before implementation: FAIL. The new tests should show `origin/feature/x` still appearing in visible branch results or selection being kept.

## Task 2: Implement Renderer-Only Branch List Filtering

**Files:**
- Modify: `src/renderer/stores/repos/branch-view-mode.ts`

- [ ] **Step 1: Add a focused helper for list visibility**

Insert this helper after `branchMatchesViewMode`:

```ts
function branchVisibleInMainList(branch: BranchInfo, viewMode: BranchViewMode): boolean {
  return branch.remoteTracking !== true && branchMatchesViewMode(branch, viewMode)
}
```

- [ ] **Step 2: Route visibleBranches through the helper**

Replace `visibleBranches` with:

```ts
export function visibleBranches(repo: RepoState): BranchInfo[] {
  const branches = orderedBranches(repo.data.branches, repo.ui.branchOrder)
  return branches.filter((branch) => branchVisibleInMainList(branch, repo.ui.branchViewMode))
}
```

- [ ] **Step 3: Route drag reorder visibility through the helper**

In `reorderedBranchOrder`, replace:

```ts
.filter((branch) => branchMatchesViewMode(branch, viewMode))
```

with:

```ts
.filter((branch) => branchVisibleInMainList(branch, viewMode))
```

- [ ] **Step 4: Route selection fallback through the helper**

In `selectedBranchForBranchSet`, replace:

```ts
const visible = orderedBranches(branches, branchOrder).filter((branch) => branchMatchesViewMode(branch, viewMode))
```

with:

```ts
const visible = orderedBranches(branches, branchOrder).filter((branch) => branchVisibleInMainList(branch, viewMode))
```

- [ ] **Step 5: Run the focused tests**

Run:

```bash
bun run test src/renderer/stores/repos/branch-view-mode.test.ts src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx
```

Expected: PASS. The branch-view-mode tests confirm hidden main-list behavior, and the toolbar tests confirm remote-tracking checkout remains visible.

## Task 3: Final Verification

**Files:**
- Verify: `src/renderer/stores/repos/branch-view-mode.ts`
- Verify: `src/renderer/stores/repos/branch-view-mode.test.ts`

- [ ] **Step 1: Run the broader renderer store tests touched by selection behavior**

Run:

```bash
bun run test src/renderer/stores/repos/branch-view-mode.test.ts src/renderer/stores/repos/selection.test.ts src/renderer/components/BranchList.ui.test.tsx src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Inspect working tree without committing**

Run:

```bash
git status --short
```

Expected: the implementation files and docs may be modified, but no commit is created.

## Self-Review

- Spec coverage: The plan hides remote-tracking branches only from the main branch-list visibility path, keeps `repo.data.branches`, and preserves toolbar checkout behavior.
- Placeholder scan: No placeholder or fill-in-later steps are present.
- Type consistency: All code uses existing `BranchInfo`, `BranchViewMode`, `RepoState`, `visibleBranches`, and `selectedBranchForBranchSet` names.
