# Branch Write Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Commit / Merge / Checkout-to / Reset --hard operations to the branch `...` menu in the sidebar, available in both the branch list and worktree list views.

**Architecture:** Three new system git functions (commit, merge, reset) are added under `src/system/git/`. Four new HTTP endpoints plus client functions expose these to the frontend. A new `useBranchWriteActions` hook manages dialog state and assembles menu items, merged into the existing `useBranchActionItems` hook so both views inherit the new operations automatically.

**Tech Stack:** vitest (tests), execa via `gitResultWithOptions` (git commands), Hono (routes), React + Dialog/AlertDialog (UI), Zustand (state), react-i18next (strings)

---

## File Map

| Action | Path |
|---|---|
| Create | `src/system/git/commit.ts` |
| Create | `src/system/git/commit.test.ts` |
| Create | `src/system/git/merge.ts` |
| Create | `src/system/git/merge.test.ts` |
| Create | `src/system/git/reset.ts` |
| Create | `src/system/git/reset.test.ts` |
| Modify | `src/server/modules/repo-write-paths.ts` |
| Modify | `src/server/routes/repo.ts` |
| Modify | `src/web/repo-client.ts` |
| Modify | `src/shared/i18n/en.ts` |
| Modify | `src/shared/i18n/zh.ts` |
| Modify | `src/shared/i18n/ko.ts` |
| Modify | `src/shared/i18n/ja.ts` |
| Modify | `src/web/hooks/branch-action-state.ts` |
| Create | `src/web/components/branch-list/BranchWriteDialogs.tsx` |
| Create | `src/web/hooks/useBranchWriteActions.tsx` |
| Modify | `src/web/hooks/useBranchActionItems.ts` |

---

## Task 1: System git — commit.ts

**Files:**
- Create: `src/system/git/commit.ts`
- Create: `src/system/git/commit.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/system/git/commit.test.ts
import { beforeEach, describe, expect, test } from 'vitest'
import { vi } from 'vitest'
import { commitAllChanges } from '#/system/git/commit.ts'

const gitResultWithOptionsMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/helper.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/git/helper.ts')>('#/system/git/helper.ts')
  return {
    ...actual,
    gitResultWithOptions: vi.fn((cwd: string, opts: unknown, ...args: string[]) =>
      gitResultWithOptionsMock(cwd, opts, ...args),
    ),
  }
})

describe('commitAllChanges', () => {
  beforeEach(() => {
    gitResultWithOptionsMock.mockReset()
    gitResultWithOptionsMock.mockResolvedValue({ ok: true, message: '' })
  })

  test('calls git add -A then git commit -m with correct args', async () => {
    const signal = new AbortController().signal
    await commitAllChanges('/repo/worktree', 'feat: add thing', signal)

    expect(gitResultWithOptionsMock).toHaveBeenNthCalledWith(
      1, '/repo/worktree', { signal }, 'add', '-A',
    )
    expect(gitResultWithOptionsMock).toHaveBeenNthCalledWith(
      2, '/repo/worktree', { signal }, 'commit', '-m', 'feat: add thing',
    )
  })

  test('short-circuits if git add fails', async () => {
    gitResultWithOptionsMock.mockResolvedValueOnce({ ok: false, message: 'permission denied' })

    const result = await commitAllChanges('/repo/worktree', 'msg')

    expect(result).toEqual({ ok: false, message: 'permission denied' })
    expect(gitResultWithOptionsMock).toHaveBeenCalledTimes(1)
  })

  test('returns commit result on success', async () => {
    gitResultWithOptionsMock
      .mockResolvedValueOnce({ ok: true, message: '' })
      .mockResolvedValueOnce({ ok: true, message: '[main abc1234] feat: add thing' })

    const result = await commitAllChanges('/repo/worktree', 'feat: add thing')

    expect(result).toEqual({ ok: true, message: '[main abc1234] feat: add thing' })
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
bun run test src/system/git/commit.test.ts
```

Expected: error "Cannot find module '#/system/git/commit.ts'"

- [ ] **Step 3: Implement**

```typescript
// src/system/git/commit.ts
import { gitResultWithOptions } from '#/system/git/helper.ts'
import type { ExecResult } from '#/shared/git-types.ts'

/**
 * Stage all changes and commit with the given message.
 * Runs `git add -A && git commit -m <message>` in the given working directory.
 * The cwd should be the worktree path, not the repo root.
 */
export async function commitAllChanges(
  cwd: string,
  message: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  const addResult = await gitResultWithOptions(cwd, { signal }, 'add', '-A')
  if (!addResult.ok) return addResult
  return gitResultWithOptions(cwd, { signal }, 'commit', '-m', message)
}
```

- [ ] **Step 4: Run to confirm passing**

```bash
bun run test src/system/git/commit.test.ts
```

Expected: 3 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/system/git/commit.ts src/system/git/commit.test.ts
git commit -m "feat(git): add commitAllChanges system function"
```

---

## Task 2: System git — merge.ts

**Files:**
- Create: `src/system/git/merge.ts`
- Create: `src/system/git/merge.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/system/git/merge.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { mergeBranch } from '#/system/git/merge.ts'

const gitResultWithOptionsMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/helper.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/git/helper.ts')>('#/system/git/helper.ts')
  return {
    ...actual,
    gitResultWithOptions: vi.fn((cwd: string, opts: unknown, ...args: string[]) =>
      gitResultWithOptionsMock(cwd, opts, ...args),
    ),
  }
})

describe('mergeBranch', () => {
  beforeEach(() => {
    gitResultWithOptionsMock.mockReset()
    gitResultWithOptionsMock.mockResolvedValue({ ok: true, message: '' })
  })

  test('calls git merge -- <branch> with correct args', async () => {
    const signal = new AbortController().signal
    await mergeBranch('/repo/worktree', 'feature/x', signal)

    expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
      '/repo/worktree', { signal }, 'merge', '--', 'feature/x',
    )
  })

  test('rejects unsafe branch names before calling git', async () => {
    const result = await mergeBranch('/repo/worktree', '../evil')
    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(gitResultWithOptionsMock).not.toHaveBeenCalled()
  })

  test('passes through git error on conflict', async () => {
    gitResultWithOptionsMock.mockResolvedValue({ ok: false, message: 'CONFLICT (content)' })
    const result = await mergeBranch('/repo/worktree', 'main')
    expect(result).toEqual({ ok: false, message: 'CONFLICT (content)' })
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
bun run test src/system/git/merge.test.ts
```

Expected: error "Cannot find module '#/system/git/merge.ts'"

- [ ] **Step 3: Implement**

```typescript
// src/system/git/merge.ts
import { isSafeBranchName } from '#/shared/refnames.ts'
import { gitResultWithOptions } from '#/system/git/helper.ts'
import type { ExecResult } from '#/shared/git-types.ts'

/**
 * Merge the given local branch into the current branch of the worktree at cwd.
 * Runs `git merge -- <branch>`. On conflict the caller receives the git stderr.
 */
export async function mergeBranch(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (!isSafeBranchName(branch)) return { ok: false, message: 'error.invalid-arguments' }
  return gitResultWithOptions(cwd, { signal }, 'merge', '--', branch)
}
```

- [ ] **Step 4: Run to confirm passing**

```bash
bun run test src/system/git/merge.test.ts
```

Expected: 3 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/system/git/merge.ts src/system/git/merge.test.ts
git commit -m "feat(git): add mergeBranch system function"
```

---

## Task 3: System git — reset.ts

**Files:**
- Create: `src/system/git/reset.ts`
- Create: `src/system/git/reset.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/system/git/reset.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { resetHardToPreviousCommit } from '#/system/git/reset.ts'

const gitResultWithOptionsMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/helper.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/git/helper.ts')>('#/system/git/helper.ts')
  return {
    ...actual,
    gitResultWithOptions: vi.fn((cwd: string, opts: unknown, ...args: string[]) =>
      gitResultWithOptionsMock(cwd, opts, ...args),
    ),
  }
})

describe('resetHardToPreviousCommit', () => {
  beforeEach(() => {
    gitResultWithOptionsMock.mockReset()
    gitResultWithOptionsMock.mockResolvedValue({ ok: true, message: 'HEAD is now at abc1234 previous commit' })
  })

  test('calls git reset --hard HEAD~1 with correct cwd', async () => {
    const signal = new AbortController().signal
    await resetHardToPreviousCommit('/repo/worktree', signal)

    expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
      '/repo/worktree', { signal }, 'reset', '--hard', 'HEAD~1',
    )
  })

  test('passes through success result', async () => {
    const result = await resetHardToPreviousCommit('/repo/worktree')
    expect(result).toEqual({ ok: true, message: 'HEAD is now at abc1234 previous commit' })
  })

  test('passes through git error', async () => {
    gitResultWithOptionsMock.mockResolvedValue({ ok: false, message: 'fatal: ambiguous argument' })
    const result = await resetHardToPreviousCommit('/repo/worktree')
    expect(result).toEqual({ ok: false, message: 'fatal: ambiguous argument' })
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
bun run test src/system/git/reset.test.ts
```

Expected: error "Cannot find module '#/system/git/reset.ts'"

- [ ] **Step 3: Implement**

```typescript
// src/system/git/reset.ts
import { gitResultWithOptions } from '#/system/git/helper.ts'
import type { ExecResult } from '#/shared/git-types.ts'

/**
 * Run `git reset --hard HEAD~1` in the given working directory.
 * Discards all uncommitted changes and moves HEAD back one commit.
 * The cwd should be the worktree path, not the repo root.
 */
export async function resetHardToPreviousCommit(
  cwd: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return gitResultWithOptions(cwd, { signal }, 'reset', '--hard', 'HEAD~1')
}
```

- [ ] **Step 4: Run to confirm passing**

```bash
bun run test src/system/git/reset.test.ts
```

Expected: 3 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/system/git/reset.ts src/system/git/reset.test.ts
git commit -m "feat(git): add resetHardToPreviousCommit system function"
```

---

## Task 4: Server module + routes + client functions

**Files:**
- Modify: `src/server/modules/repo-write-paths.ts`
- Modify: `src/server/routes/repo.ts`
- Modify: `src/web/repo-client.ts`

- [ ] **Step 1: Add imports and four module functions to `repo-write-paths.ts`**

At the top of `repo-write-paths.ts`, add these imports after the existing system imports:

```typescript
import { checkoutBranch } from '#/system/git/branches.ts'
import { commitAllChanges } from '#/system/git/commit.ts'
import { mergeBranch } from '#/system/git/merge.ts'
import { resetHardToPreviousCommit } from '#/system/git/reset.ts'
```

Then append these four exported functions at the end of the file:

```typescript
export async function checkoutWorktreeBranch(
  repoId: string,
  worktreePath: string,
  branch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  if (!isValidCwd(worktreePath)) return { ok: false, message: 'error.invalid-arguments' }
  const result = await checkoutBranch(worktreePath, branch, signal)
  if (result.ok) publishRepoSnapshotInvalidation(repoId, sourceToken)
  return result
}

export async function commitRepositoryChanges(
  repoId: string,
  worktreePath: string,
  message: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  if (!isValidCwd(worktreePath)) return { ok: false, message: 'error.invalid-arguments' }
  const result = await commitAllChanges(worktreePath, message, signal)
  if (result.ok) publishRepoSnapshotInvalidation(repoId, sourceToken)
  return result
}

export async function mergeRepositoryBranch(
  repoId: string,
  worktreePath: string,
  branch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  if (!isValidCwd(worktreePath)) return { ok: false, message: 'error.invalid-arguments' }
  const result = await mergeBranch(worktreePath, branch, signal)
  if (result.ok) publishRepoSnapshotInvalidation(repoId, sourceToken)
  return result
}

export async function resetRepositoryHard(
  repoId: string,
  worktreePath: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  if (!isValidCwd(worktreePath)) return { ok: false, message: 'error.invalid-arguments' }
  const result = await resetHardToPreviousCommit(worktreePath, signal)
  if (result.ok) publishRepoSnapshotInvalidation(repoId, sourceToken)
  return result
}
```

- [ ] **Step 2: Import the new module functions in `repo.ts`**

In `src/server/routes/repo.ts`, find the destructured import from `'#/server/modules/repo-write-paths.ts'` and add the four new names:

```typescript
import {
  // ... existing imports ...
  checkoutWorktreeBranch,
  commitRepositoryChanges,
  mergeRepositoryBranch,
  resetRepositoryHard,
} from '#/server/modules/repo-write-paths.ts'
```

- [ ] **Step 3: Add four routes to `repo.ts`**

Insert these four routes inside `createRepoRoutes()` before the closing `return app`:

```typescript
app.post('/checkout-in-worktree', async (c) => {
  const body = await c.req.json().catch(() => null)
  const repoId = typeof body?.repoId === 'string' ? body.repoId : ''
  const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : ''
  const branch = typeof body?.branch === 'string' ? body.branch : ''
  const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
  return c.json(
    await jsonOr(
      () => checkoutWorktreeBranch(repoId, worktreePath, branch, c.req.raw.signal, sourceToken),
      { ok: false, message: 'error.failed-read-repo' },
      'checkout-in-worktree',
    ),
  )
})

app.post('/commit', async (c) => {
  const body = await c.req.json().catch(() => null)
  const repoId = typeof body?.repoId === 'string' ? body.repoId : ''
  const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : ''
  const message = typeof body?.message === 'string' ? body.message : ''
  const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
  return c.json(
    await jsonOr(
      () => commitRepositoryChanges(repoId, worktreePath, message, c.req.raw.signal, sourceToken),
      { ok: false, message: 'error.failed-read-repo' },
      'commit',
    ),
  )
})

app.post('/merge', async (c) => {
  const body = await c.req.json().catch(() => null)
  const repoId = typeof body?.repoId === 'string' ? body.repoId : ''
  const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : ''
  const branch = typeof body?.branch === 'string' ? body.branch : ''
  const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
  return c.json(
    await jsonOr(
      () => mergeRepositoryBranch(repoId, worktreePath, branch, c.req.raw.signal, sourceToken),
      { ok: false, message: 'error.failed-read-repo' },
      'merge',
    ),
  )
})

app.post('/reset-hard', async (c) => {
  const body = await c.req.json().catch(() => null)
  const repoId = typeof body?.repoId === 'string' ? body.repoId : ''
  const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : ''
  const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
  return c.json(
    await jsonOr(
      () => resetRepositoryHard(repoId, worktreePath, c.req.raw.signal, sourceToken),
      { ok: false, message: 'error.failed-read-repo' },
      'reset-hard',
    ),
  )
})
```

- [ ] **Step 4: Add four client functions to `repo-client.ts`**

Append at the end of `src/web/repo-client.ts`:

```typescript
export async function checkoutBranchInWorktree(
  repoId: string,
  worktreePath: string,
  branch: string,
): Promise<ExecResult> {
  return postServerJson('/api/repo/checkout-in-worktree', { repoId, worktreePath, branch })
}

export async function commitRepositoryChanges(
  repoId: string,
  worktreePath: string,
  message: string,
): Promise<ExecResult> {
  return postServerJson('/api/repo/commit', { repoId, worktreePath, message })
}

export async function mergeRepositoryBranch(
  repoId: string,
  worktreePath: string,
  branch: string,
): Promise<ExecResult> {
  return postServerJson('/api/repo/merge', { repoId, worktreePath, branch })
}

export async function resetRepositoryHard(
  repoId: string,
  worktreePath: string,
): Promise<ExecResult> {
  return postServerJson('/api/repo/reset-hard', { repoId, worktreePath })
}
```

- [ ] **Step 5: Run all tests to verify no regressions**

```bash
bun run test
```

Expected: all existing tests pass, no new failures

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/repo-write-paths.ts src/server/routes/repo.ts src/web/repo-client.ts
git commit -m "feat(server): add commit, merge, reset-hard, checkout-in-worktree endpoints"
```

---

## Task 5: i18n strings + BranchActionItemId

**Files:**
- Modify: `src/shared/i18n/en.ts`
- Modify: `src/shared/i18n/zh.ts`
- Modify: `src/shared/i18n/ko.ts`
- Modify: `src/shared/i18n/ja.ts`
- Modify: `src/web/hooks/branch-action-state.ts`

- [ ] **Step 1: Add strings to `en.ts`**

Find the block of `action.*` keys in `src/shared/i18n/en.ts` and add after the last `action.*` entry:

```typescript
  'action.checkout-to': 'Checkout to…',
  'action.checkout-to-title': 'Switch this worktree to a different branch',
  'action.checkout-to-warning': 'You have uncommitted changes. Git may refuse this checkout.',
  'action.checkout-to-placeholder': 'Select a branch',
  'action.merge-branch': 'Merge branch…',
  'action.merge-branch-title': 'Merge a local branch into this worktree',
  'action.merge-branch-placeholder': 'Select a branch to merge',
  'action.commit-changes': 'Commit all changes',
  'action.commit-changes-title': 'Stage all changes and create a commit',
  'action.commit-message-placeholder': 'Commit message',
  'action.commit-files-changed': '{n} file changed',
  'action.commit-files-changed-plural': '{n} files changed',
  'action.reset-hard': 'Reset to previous commit',
  'action.reset-hard-title': 'Discard changes and reset HEAD to HEAD~1',
  'action.reset-hard-confirm-title': 'Reset to previous commit?',
  'action.reset-hard-confirm-message': 'This will discard all uncommitted changes and reset to HEAD~1. This cannot be undone.',
  'action.reset-hard-confirm-button': 'Reset',
```

- [ ] **Step 2: Add the same keys to `zh.ts`**

```typescript
  'action.checkout-to': '切换到分支…',
  'action.checkout-to-title': '将此工作区切换到其他分支',
  'action.checkout-to-warning': '有未提交的更改，Git 可能会拒绝此操作。',
  'action.checkout-to-placeholder': '选择分支',
  'action.merge-branch': '合并分支…',
  'action.merge-branch-title': '将本地分支合并到此工作区',
  'action.merge-branch-placeholder': '选择要合并的分支',
  'action.commit-changes': '提交所有更改',
  'action.commit-changes-title': '暂存所有更改并创建提交',
  'action.commit-message-placeholder': '提交信息',
  'action.commit-files-changed': '已更改 {n} 个文件',
  'action.commit-files-changed-plural': '已更改 {n} 个文件',
  'action.reset-hard': '重置到上一次提交',
  'action.reset-hard-title': '丢弃更改并将 HEAD 重置到 HEAD~1',
  'action.reset-hard-confirm-title': '重置到上一次提交？',
  'action.reset-hard-confirm-message': '这将丢弃所有未提交的更改并重置到 HEAD~1，此操作无法撤销。',
  'action.reset-hard-confirm-button': '重置',
```

- [ ] **Step 3: Add the same keys to `ko.ts`**

```typescript
  'action.checkout-to': '브랜치로 체크아웃…',
  'action.checkout-to-title': '이 워크트리를 다른 브랜치로 전환',
  'action.checkout-to-warning': '커밋되지 않은 변경 사항이 있습니다. Git이 거부할 수 있습니다.',
  'action.checkout-to-placeholder': '브랜치 선택',
  'action.merge-branch': '브랜치 병합…',
  'action.merge-branch-title': '로컬 브랜치를 이 워크트리에 병합',
  'action.merge-branch-placeholder': '병합할 브랜치 선택',
  'action.commit-changes': '모든 변경 사항 커밋',
  'action.commit-changes-title': '모든 변경 사항을 스테이징하고 커밋 생성',
  'action.commit-message-placeholder': '커밋 메시지',
  'action.commit-files-changed': '{n}개 파일 변경됨',
  'action.commit-files-changed-plural': '{n}개 파일 변경됨',
  'action.reset-hard': '이전 커밋으로 재설정',
  'action.reset-hard-title': '변경 사항을 삭제하고 HEAD를 HEAD~1로 재설정',
  'action.reset-hard-confirm-title': '이전 커밋으로 재설정할까요?',
  'action.reset-hard-confirm-message': '커밋되지 않은 모든 변경 사항이 삭제되고 HEAD~1로 재설정됩니다. 되돌릴 수 없습니다.',
  'action.reset-hard-confirm-button': '재설정',
```

- [ ] **Step 4: Add the same keys to `ja.ts`**

```typescript
  'action.checkout-to': 'ブランチへチェックアウト…',
  'action.checkout-to-title': 'このワークツリーを別のブランチに切り替え',
  'action.checkout-to-warning': 'コミットされていない変更があります。Gitが拒否する可能性があります。',
  'action.checkout-to-placeholder': 'ブランチを選択',
  'action.merge-branch': 'ブランチをマージ…',
  'action.merge-branch-title': 'ローカルブランチをこのワークツリーにマージ',
  'action.merge-branch-placeholder': 'マージするブランチを選択',
  'action.commit-changes': 'すべての変更をコミット',
  'action.commit-changes-title': 'すべての変更をステージしてコミットを作成',
  'action.commit-message-placeholder': 'コミットメッセージ',
  'action.commit-files-changed': '{n}ファイル変更',
  'action.commit-files-changed-plural': '{n}ファイル変更',
  'action.reset-hard': '前のコミットにリセット',
  'action.reset-hard-title': '変更を破棄してHEADをHEAD~1にリセット',
  'action.reset-hard-confirm-title': '前のコミットにリセットしますか？',
  'action.reset-hard-confirm-message': 'コミットされていない変更がすべて破棄され、HEAD~1にリセットされます。元に戻すことはできません。',
  'action.reset-hard-confirm-button': 'リセット',
```

- [ ] **Step 5: Extend `BranchActionItemId` in `branch-action-state.ts`**

Find and replace the `BranchActionItemId` type:

```typescript
export type BranchActionItemId =
  | 'copyPatch'
  | 'checkout'
  | 'pull'
  | 'push'
  | 'remote'
  | 'terminal'
  | 'editor'
  | 'deleteBranch'
  | 'removeWorktree'
  | 'checkoutTo'
  | 'mergeBranch'
  | 'commitChanges'
  | 'resetHard'
```

- [ ] **Step 6: Run all tests**

```bash
bun run test
```

Expected: all passing

- [ ] **Step 7: Commit**

```bash
git add src/shared/i18n/en.ts src/shared/i18n/zh.ts src/shared/i18n/ko.ts src/shared/i18n/ja.ts
git add src/web/hooks/branch-action-state.ts
git commit -m "feat(i18n): add branch write action strings and extend BranchActionItemId"
```

---

## Task 6: BranchWriteDialogs component

**Files:**
- Create: `src/web/components/branch-list/BranchWriteDialogs.tsx`

This file contains four dialog components. Checkout-to and Merge share a `BranchSelectDialog` sub-component. Commit has a textarea. Reset uses the existing `ConfirmDialog`.

- [ ] **Step 1: Create `BranchWriteDialogs.tsx`**

```tsx
// src/web/components/branch-list/BranchWriteDialogs.tsx
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/web/components/ui/dialog.tsx'
import { DialogError } from '#/web/components/ui/dialog-error.tsx'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'

// ── Checkout-to dialog ───────────────────────────────────────────────────────

interface CheckoutToDialogProps {
  open: boolean
  branch: RepoBranchState
  allBranches: RepoBranchState[]
  isDirty: boolean
  onClose: () => void
  onCheckout: (targetBranch: string) => Promise<void>
}

export function CheckoutToDialog({
  open,
  branch,
  allBranches,
  isDirty,
  onClose,
  onCheckout,
}: CheckoutToDialogProps) {
  const t = useT()
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { isPending, run } = useAsyncPending<'checkout'>()

  const candidates = allBranches.filter((b) => b.name !== branch.name)

  async function handleConfirm() {
    if (!selected) return
    setError(null)
    await run('checkout', async () => {
      await onCheckout(selected)
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }

  function handleOpenChange(o: boolean) {
    if (!o && !isPending) {
      setSelected('')
      setError(null)
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('action.checkout-to')}</DialogTitle>
        </DialogHeader>
        {isDirty && (
          <p className="text-xs text-muted-foreground">{t('action.checkout-to-warning')}</p>
        )}
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">{t('action.checkout-to-placeholder')}</option>
          {candidates.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
        {error && <DialogError>{error}</DialogError>}
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={isPending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button size="sm" disabled={!selected || isPending} onClick={handleConfirm}>
            {isPending && <Loader2 className="animate-spin" />}
            {t('action.checkout-to')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Merge dialog ─────────────────────────────────────────────────────────────

interface MergeDialogProps {
  open: boolean
  branch: RepoBranchState
  allBranches: RepoBranchState[]
  onClose: () => void
  onMerge: (sourceBranch: string) => Promise<void>
}

export function MergeDialog({ open, branch, allBranches, onClose, onMerge }: MergeDialogProps) {
  const t = useT()
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { isPending, run } = useAsyncPending<'merge'>()

  const candidates = allBranches.filter((b) => b.name !== branch.name)

  async function handleConfirm() {
    if (!selected) return
    setError(null)
    await run('merge', async () => {
      await onMerge(selected)
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }

  function handleOpenChange(o: boolean) {
    if (!o && !isPending) {
      setSelected('')
      setError(null)
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('action.merge-branch')}</DialogTitle>
        </DialogHeader>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">{t('action.merge-branch-placeholder')}</option>
          {candidates.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
        {error && <DialogError>{error}</DialogError>}
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={isPending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button size="sm" disabled={!selected || isPending} onClick={handleConfirm}>
            {isPending && <Loader2 className="animate-spin" />}
            {t('action.merge-branch')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Commit dialog ────────────────────────────────────────────────────────────

interface CommitDialogProps {
  open: boolean
  changeCount: number
  onClose: () => void
  onCommit: (message: string) => Promise<void>
}

export function CommitDialog({ open, changeCount, onClose, onCommit }: CommitDialogProps) {
  const t = useT()
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { isPending, run } = useAsyncPending<'commit'>()

  async function handleConfirm() {
    if (!message.trim()) return
    setError(null)
    await run('commit', async () => {
      await onCommit(message.trim())
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }

  function handleOpenChange(o: boolean) {
    if (!o && !isPending) {
      setMessage('')
      setError(null)
      onClose()
    }
  }

  const filesLabel =
    changeCount === 1
      ? t('action.commit-files-changed', { n: changeCount })
      : t('action.commit-files-changed-plural', { n: changeCount })

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('action.commit-changes')}</DialogTitle>
        </DialogHeader>
        {changeCount > 0 && (
          <p className="text-xs text-muted-foreground">{filesLabel}</p>
        )}
        <textarea
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none min-h-[80px]"
          placeholder={t('action.commit-message-placeholder')}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={isPending}
        />
        {error && <DialogError>{error}</DialogError>}
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={isPending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button size="sm" disabled={!message.trim() || isPending} onClick={handleConfirm}>
            {isPending && <Loader2 className="animate-spin" />}
            {t('action.commit-changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

Note: Reset --hard reuses the existing `ConfirmDialog` directly from `useBranchWriteActions` in Task 7 — no new component needed.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun run build 2>&1 | head -30
```

Expected: no TypeScript errors in the new file (or confirm with tsc check)

- [ ] **Step 3: Commit**

```bash
git add src/web/components/branch-list/BranchWriteDialogs.tsx
git commit -m "feat(ui): add CheckoutToDialog, MergeDialog, CommitDialog components"
```

---

## Task 7: useBranchWriteActions hook

**Files:**
- Create: `src/web/hooks/useBranchWriteActions.tsx`

- [ ] **Step 1: Create the hook**

```tsx
// src/web/hooks/useBranchWriteActions.tsx
import { createElement } from 'react'
import { GitBranch, GitMerge, RotateCcw, SendHorizontal } from 'lucide-react'
import type { BranchActionItem } from '#/web/hooks/useBranchActionItems.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useRetainedDialogState } from '#/web/hooks/useRetainedDialogState.ts'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import {
  CheckoutToDialog,
  CommitDialog,
  MergeDialog,
} from '#/web/components/branch-list/BranchWriteDialogs.tsx'
import {
  checkoutBranchInWorktree,
  commitRepositoryChanges,
  mergeRepositoryBranch,
  resetRepositoryHard,
} from '#/web/repo-client.ts'
import { getBranchWorktreeState } from '#/web/stores/repos/worktree-state.ts'
import { useT } from '#/web/stores/i18n.ts'
import { dispatchRepoUiAction } from '#/web/stores/repos/branch-action-write-paths.ts'

interface BranchWriteActions {
  mainItems: BranchActionItem[]
  destructiveItems: BranchActionItem[]
  dialogs: React.ReactNode
}

export function useBranchWriteActions(repo: BranchActionRepo, branch: RepoBranchState): BranchWriteActions {
  const t = useT()
  const setLastResult = useReposStore((s) => s.setLastResult)
  const allBranches = useReposStore((s) => s.repos[repo.id]?.data.branches ?? [])
  const worktreeState = getBranchWorktreeState(repo, branch)

  const worktreePath = branch.worktree?.path
  const hasWorktree = !!worktreePath
  const isDirty = worktreeState?.isDirty ?? false
  const changeCount = worktreeState?.changeCount ?? 0

  const checkoutToDialog = useRetainedDialogState<void>()
  const mergeDialog = useRetainedDialogState<void>()
  const commitDialog = useRetainedDialogState<void>()
  const resetDialog = useRetainedDialogState<void>()

  async function runAction(fn: () => Promise<{ ok: boolean; message: string }>) {
    const result = await fn()
    setLastResult(repo.id, repo.instanceToken, result)
  }

  async function handleCheckoutTo(targetBranch: string) {
    if (!worktreePath) return
    await runAction(() => checkoutBranchInWorktree(repo.id, worktreePath, targetBranch))
    checkoutToDialog.close()
  }

  async function handleMerge(sourceBranch: string) {
    if (!worktreePath) return
    await runAction(() => mergeRepositoryBranch(repo.id, worktreePath, sourceBranch))
    mergeDialog.close()
  }

  async function handleCommit(message: string) {
    if (!worktreePath) return
    await runAction(() => commitRepositoryChanges(repo.id, worktreePath, message))
    commitDialog.close()
  }

  async function handleResetHard() {
    if (!worktreePath) return
    await runAction(() => resetRepositoryHard(repo.id, worktreePath))
  }

  const mainItems: BranchActionItem[] = [
    {
      id: 'checkoutTo',
      label: t('action.checkout-to'),
      title: t('action.checkout-to-title'),
      disabled: false,
      visible: hasWorktree,
      icon: createElement(GitBranch),
      onSelect: () => checkoutToDialog.openWith(undefined as unknown as void),
    },
    {
      id: 'mergeBranch',
      label: t('action.merge-branch'),
      title: t('action.merge-branch-title'),
      disabled: false,
      visible: hasWorktree,
      icon: createElement(GitMerge),
      onSelect: () => mergeDialog.openWith(undefined as unknown as void),
    },
    {
      id: 'commitChanges',
      label: t('action.commit-changes'),
      title: t('action.commit-changes-title'),
      disabled: false,
      visible: hasWorktree,
      icon: createElement(SendHorizontal),
      onSelect: () => commitDialog.openWith(undefined as unknown as void),
    },
  ]

  const destructiveItems: BranchActionItem[] = [
    {
      id: 'resetHard',
      label: t('action.reset-hard'),
      title: t('action.reset-hard-title'),
      disabled: false,
      visible: hasWorktree,
      destructive: true,
      icon: createElement(RotateCcw),
      onSelect: () => resetDialog.openWith(undefined as unknown as void),
    },
  ]

  const dialogs = (
    <>
      <CheckoutToDialog
        open={checkoutToDialog.open}
        branch={branch}
        allBranches={allBranches}
        isDirty={isDirty}
        onClose={checkoutToDialog.close}
        onCheckout={handleCheckoutTo}
      />
      <MergeDialog
        open={mergeDialog.open}
        branch={branch}
        allBranches={allBranches}
        onClose={mergeDialog.close}
        onMerge={handleMerge}
      />
      <CommitDialog
        open={commitDialog.open}
        changeCount={changeCount}
        onClose={commitDialog.close}
        onCommit={handleCommit}
      />
      <ConfirmDialog
        open={resetDialog.open}
        title={t('action.reset-hard-confirm-title')}
        message={t('action.reset-hard-confirm-message')}
        confirmLabel={t('action.reset-hard-confirm-button')}
        destructive
        onCancel={resetDialog.close}
        onConfirm={handleResetHard}
      />
    </>
  )

  return { mainItems, destructiveItems, dialogs }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun run build 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/web/hooks/useBranchWriteActions.tsx
git commit -m "feat(hooks): add useBranchWriteActions hook"
```

---

## Task 8: Wire into useBranchActionItems

**Files:**
- Modify: `src/web/hooks/useBranchActionItems.ts`

- [ ] **Step 1: Import and merge write actions**

In `src/web/hooks/useBranchActionItems.ts`, add the import:

```typescript
import { useBranchWriteActions } from '#/web/hooks/useBranchWriteActions.tsx'
```

Inside `useBranchActionItems`, add the hook call after existing declarations:

```typescript
const writeActions = useBranchWriteActions(repo, branch)
```

Then update the return statement to merge items and dialogs:

```typescript
  return {
    patchItems,
    mainItems: [...mainItems, ...writeActions.mainItems],
    destructiveItems: [...destructiveItems, ...writeActions.destructiveItems],
    dialogs: (
      <>
        {dialogs}
        {writeActions.dialogs}
      </>
    ),
  }
```

- [ ] **Step 2: Run all tests**

```bash
bun run test
```

Expected: all passing

- [ ] **Step 3: Verify TypeScript compiles**

```bash
bun run build 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/web/hooks/useBranchActionItems.ts
git commit -m "feat: wire branch write actions into branch action menu"
```

---

## Self-review Checklist

After writing, verify against spec:

- [x] Checkout-to: dialog with local branch selector, excludes current branch, shows dirty warning → Task 6 + 7
- [x] Merge: dialog with local branch selector, excludes current branch, shows error on conflict → Task 6 + 7
- [x] Commit: auto-stage all + message input + disabled when empty → Task 1 + 6 + 7
- [x] Reset: `git reset --hard HEAD~1`, confirmation dialog with destructive styling → Task 3 + 7
- [x] All 4 operations visible only when `branch.worktree?.path` exists → Task 7
- [x] Works in both branch list and worktree list (shared BranchRow + useBranchActionItems) → Task 8
- [x] Error shown inside dialog, dialog stays open on failure → Task 6
- [x] Snapshot invalidation published after every success → Task 4
- [x] 4 language files updated → Task 5
