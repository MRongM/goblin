# Branch Write Actions Design

**Date:** 2026-06-12
**Scope:** Add commit / merge / checkout / reset operations to the branch `...` menu in both branch list and worktree list views.

---

## Overview

Each branch row in the sidebar has a `...` menu (`BranchActionsMenu`). This spec adds four write operations to that menu, available in both the branch list view and the worktree list view.

| Operation | Menu label | Style |
|---|---|---|
| Checkout | `Checkout to...` | normal |
| Merge | `Merge branch...` | normal |
| Commit | `Commit all changes` | normal |
| Reset | `Reset to previous commit` | destructive (red) |

---

## Architecture

### New files

- `src/web/hooks/useBranchWriteActions.ts` — action items + dialog state for the four write operations
- `src/web/components/branch-list/BranchWriteDialogs.tsx` — renders the dialog for the active operation
- `src/system/git/commit.ts` — `git add -A && git commit -m`
- `src/system/git/merge.ts` — `git merge <branch>`
- `src/system/git/reset.ts` — `git reset --hard HEAD~1`

### Modified files

- `src/web/hooks/useBranchActionItems.ts` — import and merge items from `useBranchWriteActions`
- `src/server/routes/repo.ts` (or `repo-write.ts`) — add `/commit`, `/merge`, `/reset-hard` routes
- Parent of `BranchRow` (branch list container) — render `<BranchWriteDialogs />`

### Data flow

```
BranchRow
  └─ BranchActionsMenu (existing)
       └─ useBranchActionItems (existing)
            └─ useBranchWriteActions (new)
                  ├─ items → merged into mainItems
                  └─ dialog state → BranchWriteDialogs (new, sibling of BranchRow)
```

Because `BranchRow` is shared between the branch list and worktree list views, both views get the new operations automatically with no additional wiring.

---

## Interaction Details

### Checkout
- Opens a Dialog with a searchable list of local branches, excluding the current branch.
- User selects a branch → calls existing `POST /checkout`.
- If the worktree has uncommitted changes, shows a warning ("You have uncommitted changes. Git may refuse this checkout.") but does not block the action.

### Merge
- Opens a Dialog with a searchable list of local branches, excluding the current branch.
- User selects a branch → calls `POST /merge`.
- On conflict: displays the git stderr in the dialog. Does not auto-resolve.

### Commit
- Opens a Dialog with:
  - A count of changed files as context ("N files changed")
  - A `textarea` for the commit message
  - Confirm button disabled when message is empty
- Calls `POST /commit` with `{ repoId, worktreeId, message }`.
- Executes `git add -A && git commit -m "<message>"` on the correct worktree path.

### Reset to previous commit
- Menu item styled as destructive (red).
- Opens a confirmation Dialog: _"This will discard all uncommitted changes and reset to the previous commit (HEAD~1). This cannot be undone."_
- User confirms → calls `POST /reset-hard`.
- Executes `git reset --hard HEAD~1` on the correct worktree path.

---

## Backend API

### Reused
- `POST /checkout` — already exists, no changes needed.

### New endpoints

**`POST /merge`**
```
body:    { repoId, worktreeId, branch }
runs:    git merge <branch>  (in worktree working dir)
200:     {}
400:     { error: "<git stderr>" }
```

**`POST /commit`**
```
body:    { repoId, worktreeId, message }
runs:    git add -A && git commit -m "<message>"  (in worktree working dir)
200:     { commitHash, shortHash }
400:     { error: "<git stderr>" }
```

**`POST /reset-hard`**
```
body:    { repoId, worktreeId }
runs:    git reset --hard HEAD~1  (in worktree working dir)
200:     { newHead }
400:     { error: "<git stderr>" }
```

Error handling: git stderr is passed through directly as the error message. No additional wrapping.

---

## Frontend State

```typescript
type DialogState =
  | { type: 'none' }
  | { type: 'checkout' }
  | { type: 'merge' }
  | { type: 'commit' }
  | { type: 'reset' }
```

`useBranchWriteActions` returns:
- `items: BranchActionItem[]` — merged into `useBranchActionItems` mainItems
- `dialog: DialogState`
- `closeDialog: () => void`

`BranchWriteDialogs` receives `dialog` and `closeDialog` as props, switches on `dialog.type` to render the appropriate dialog.

**Branch data for selectors:** checkout and merge read from the existing Zustand branches store — no extra fetch needed.

**Mutation flow:**
1. Menu item click → set `dialog` state
2. User fills in parameters → clicks confirm
3. TanStack Query mutation → loading state on confirm button
4. Success → close dialog + toast notification
5. Error → show error message inside dialog, keep dialog open

All UI patterns (Dialog style, toast, mutation wiring) follow existing conventions in the codebase.

---

## Worktree Correctness

All four operations run against the **worktree working directory**, not the repo root. The `worktreeId` field is passed in every request body. The system layer resolves the worktree path from `worktreeId` before running git commands — consistent with how existing write operations (e.g., push, pull) work.
