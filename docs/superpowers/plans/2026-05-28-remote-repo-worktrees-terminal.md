# Remote Repository Worktrees And Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable SSH remote repositories to manually refresh, read worktree status and commits, create remote worktrees, and open embedded Goblin terminals in remote worktree directories.

**Architecture:** Keep `RepoState.kind === 'remote'` as the product boundary and add remote equivalents behind `rpc.remote.*`. The renderer continues to use existing repo resources (`fetch`, `snapshot`, `status`, `logsByBranch`, `branchAction`) while main owns SSH command construction, validation, timeouts, and cancellation.

**Tech Stack:** TypeScript, React, Zustand, tRPC/valibot, Electron IPC, OpenSSH via `execa`, node-pty, Vitest.

---

Project instruction override: AGENTS.md explicitly says not to plan or execute git commits unless the user requests them. This plan therefore omits commit steps.

## Scope Check

This feature touches main SSH/RPC, renderer repo state, UI affordances, and terminal IPC. These pieces are sequentially dependent and produce one coherent vertical feature: a remote repository stays on the SSH host while Goblin exposes a small local-equivalent workflow. Splitting into separate specs would create unusable partial states, so this remains one implementation plan.

## File Structure

- Modify `src/main/ssh/commands.ts`: add fixed remote command kinds for fetch, worktree list, status, log, worktree add, and interactive terminal invocation.
- Modify `src/main/ssh/commands.test.ts`: verify argv/script generation, quoting, identity-file behavior, and remote terminal command shape.
- Modify `src/main/ssh/git.ts`: implement remote fetch, remote snapshot with worktrees, remote status, remote log, and remote worktree creation.
- Modify `src/main/ssh/git.test.ts`: test parser/runner behavior without real SSH.
- Modify `src/shared/rpc.ts`: add remote RPC handler types and valibot schemas for fetch/status/log/createWorktree.
- Modify `src/main/rpc.ts`: wire remote RPC handlers to `src/main/ssh/git.ts`.
- Modify `src/main/rpc.test.ts`: verify router accepts new remote procedures and rejects invalid inputs.
- Modify `src/shared/terminal.ts`: make terminal open/restart inputs a local/remote discriminated union and add remote prune input.
- Modify `src/main/terminal.ts`: validate remote terminal targets and open/prune remote terminal sessions.
- Modify `src/main/terminal.test.ts`: test remote terminal open/restart/prune and local compatibility.
- Modify `src/renderer/components/terminal/types.ts`: add remote-aware terminal descriptor/base types.
- Modify `src/renderer/components/terminal/terminal-session-utils.ts`: add local/remote group keys, session keys, and live checks.
- Modify `src/renderer/components/terminal/terminal-session-utils.test.ts`: cover remote keys and live checks.
- Modify `src/renderer/components/terminal/ManagedTerminalSession.ts`: send local or remote terminal input based on descriptor kind.
- Modify `src/renderer/components/terminal/ManagedTerminalSession.test.ts`: verify remote open/restart payloads.
- Modify `src/renderer/components/terminal/TerminalSlot.tsx`: accept local and remote terminal bases.
- Modify `src/renderer/components/branch-detail/BranchDetailContent.tsx`: pass remote target into `TerminalSlot`.
- Modify `src/renderer/stores/repos/refresh.ts`: route remote snapshot/status/log/sync to `rpc.remote.*`.
- Modify `src/renderer/stores/repos/refresh-workflows.ts`: skip PR refresh for remote repos and prune terminal sessions with local/remote scope.
- Modify `src/renderer/stores/repos/sync-state.ts`: allow manual remote fetch while keeping background fetch disabled.
- Modify `src/renderer/stores/repos/branch-actions.ts`: allow only remote `createWorktree`; keep all other remote branch actions unavailable.
- Modify `src/renderer/stores/repos/refresh.test.ts`: replace Phase 1 remote skip tests with remote support tests.
- Modify `src/renderer/stores/repos/branch-actions.test.ts`: verify remote createWorktree path and other remote actions blocked.
- Modify `src/renderer/components/CreateWorktreeDialog.tsx`: support remote default path and remote path display.
- Modify `src/renderer/lib/paths.ts`: add pure remote worktree path helper if keeping the path logic out of the component keeps it simpler.
- Modify `src/renderer/components/repo-toolbar/RepoToolbarActions.tsx`: show Refresh and New worktree for remote repos, retaining diagnostics retry.
- Create `src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx`: verify remote toolbar affordances.
- Modify `src/renderer/components/repo-sync/model.ts`: allow remote manual refresh presentation.
- Modify `src/main/i18n/en.ts`, `src/main/i18n/zh.ts`, `src/main/i18n/ja.ts`, `src/main/i18n/ko.ts`: add any missing remote worktree/terminal copy.

## Task 1: Remote SSH Command Primitives

**Files:**

- Modify: `src/main/ssh/commands.ts`
- Test: `src/main/ssh/commands.test.ts`

- [ ] **Step 1: Write failing command builder tests**

Add tests under `describe('remote ssh command runner', () => { ... })`:

```ts
test('builds remote fetch and worktree commands with quoted paths', async () => {
  const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

  const fetch = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitFetch',
    path: "/srv/team's app",
  })
  const worktrees = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitWorktreeList',
    path: "/srv/team's app",
  })

  expect(fetch.script).toBe("git -C '/srv/team'\\''s app' fetch --all --prune")
  expect(worktrees.script).toBe("git -C '/srv/team'\\''s app' worktree list --porcelain")
})

test('builds remote status and log commands with bounded numeric args', async () => {
  const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

  const status = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitStatus',
    path: '/srv/goblin-linked',
  })
  const log = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitLog',
    path: '/srv/goblin',
    branch: 'feature/x',
    count: 30,
    skip: 60,
  })

  expect(status.script).toBe("git -C '/srv/goblin-linked' status --porcelain -z")
  expect(log.script).toContain("git -C '/srv/goblin' log")
  expect(log.script).toContain('--max-count=30')
  expect(log.script).toContain('--skip=60')
  expect(log.script).toContain("'feature/x'")
})

test('builds remote worktree add command with branch and path quoting', async () => {
  const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

  const invocation = buildRemoteCommandInvocation(MANUAL_TARGET, {
    type: 'gitWorktreeAdd',
    path: '/srv/goblin',
    worktreePath: "/srv/goblin-feature's",
    newBranch: 'feature/new',
    baseBranch: 'main',
  })

  expect(invocation.script).toBe(
    "git -C '/srv/goblin' worktree add -b 'feature/new' -- '/srv/goblin-feature'\\''s' 'main'",
  )
})

test('builds interactive remote terminal invocation', async () => {
  const { buildRemoteTerminalInvocation } = await import('#/main/ssh/commands.ts')

  const invocation = buildRemoteTerminalInvocation(MANUAL_TARGET, "/srv/team's app", { cols: 100, rows: 30 })

  expect(invocation.command).toBe('ssh')
  expect(invocation.args).toEqual(
    expect.arrayContaining(['-tt', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-p', '2222']),
  )
  expect(invocation.args).toContain('deploy@prod.example.com')
  expect(invocation.script).toContain("cd '/srv/team'\\''s app'")
  expect(invocation.script).toContain('exec "${SHELL:-/bin/sh}" -l')
})
```

- [ ] **Step 2: Run command tests and verify red**

Run:

```sh
bun run test "src/main/ssh/commands.test.ts"
```

Expected: FAIL because the new command kinds and `buildRemoteTerminalInvocation` are not defined.

- [ ] **Step 3: Add command kinds and builders**

Update the type and builder in `src/main/ssh/commands.ts`:

```ts
export type RemoteCommandKind =
  | { type: 'printHome' }
  | { type: 'checkShell' }
  | { type: 'checkGit' }
  | { type: 'testDirectory'; path: string }
  | { type: 'revParseTopLevel'; path: string }
  | { type: 'listDirectories'; path: string; limit?: number }
  | { type: 'gitSnapshot'; path: string }
  | { type: 'gitFetch'; path: string }
  | { type: 'gitWorktreeList'; path: string }
  | { type: 'gitStatus'; path: string }
  | { type: 'gitLog'; path: string; branch: string; count?: number; skip?: number }
  | { type: 'gitWorktreeAdd'; path: string; worktreePath: string; newBranch: string; baseBranch: string }
```

Add the interactive builder below `buildRemoteCommandInvocation`:

```ts
export function buildRemoteTerminalInvocation(
  target: RemoteRepoTarget,
  remotePath: string,
  size: { cols: number; rows: number },
): RemoteCommandInvocation {
  const script = `cd ${shellQuote(remotePath)} && exec "\${SHELL:-/bin/sh}" -l`
  const args = ['-tt', '-o', 'StrictHostKeyChecking=yes', '-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SEC}`]
  const destination = target.alias ?? `${target.user}@${target.host}`
  if (target.identityFile) args.push('-i', expandIdentityFile(target.identityFile))
  if (!target.alias) args.push('-p', String(target.port))
  args.push('--', destination, `sh -lc ${shellQuote(script)}`)
  return { command: 'ssh', args, script }
}
```

Add cases in `scriptForCommand`:

```ts
case 'gitFetch':
  return `git -C ${shellQuote(command.path)} fetch --all --prune`
case 'gitWorktreeList':
  return `git -C ${shellQuote(command.path)} worktree list --porcelain`
case 'gitStatus':
  return `git -C ${shellQuote(command.path)} status --porcelain -z`
case 'gitLog': {
  const count = Math.max(1, Math.min(1000, Math.floor(command.count ?? 100)))
  const skip = Math.max(0, Math.floor(command.skip ?? 0))
  const format = ['%H', '%h', '%s', '%an', '%aI'].join(FIELD_SEP)
  return [
    `git -C ${shellQuote(command.path)} log`,
    `--format=${shellQuote(format)}`,
    `--max-count=${count}`,
    `--skip=${skip}`,
    '--',
    shellQuote(command.branch),
  ].join(' ')
}
case 'gitWorktreeAdd':
  return `git -C ${shellQuote(command.path)} worktree add -b ${shellQuote(command.newBranch)} -- ${shellQuote(
    command.worktreePath,
  )} ${shellQuote(command.baseBranch)}`
```

- [ ] **Step 4: Run command tests and verify green**

Run:

```sh
bun run test "src/main/ssh/commands.test.ts"
```

Expected: PASS.

## Task 2: Remote Git Backend Functions

**Files:**

- Modify: `src/main/ssh/git.ts`
- Test: `src/main/ssh/git.test.ts`

- [ ] **Step 1: Write failing backend tests**

Append tests to `src/main/ssh/git.test.ts`:

```ts
test('remote snapshot merges worktree metadata and dirty counts', async () => {
  const { getRemoteSnapshot } = await import('#/main/ssh/git.ts')
  const run = vi.fn(async (command) => {
    if (command.type === 'gitSnapshot') {
      return {
        ok: true,
        stderr: '',
        stdout: [
          '__GOBLIN_REMOTE_CURRENT__',
          'main',
          '__GOBLIN_REMOTE_DEFAULT__',
          'main',
          '__GOBLIN_REMOTE_BRANCHES__',
          ['main', 'abc1234', 'initial commit', '2026-05-28T10:00:00Z', 'Ada', 'origin/main', ''].join(FIELD_SEP),
          ['feature/x', 'def5678', 'feature work', '2026-05-28T11:00:00Z', 'Lin', '', ''].join(FIELD_SEP),
        ].join('\n'),
      }
    }
    if (command.type === 'gitWorktreeList') {
      return {
        ok: true,
        stderr: '',
        stdout: [
          'worktree /srv/goblin',
          'HEAD abc1234',
          'branch refs/heads/main',
          '',
          'worktree /srv/goblin-feature-x',
          'HEAD def5678',
          'branch refs/heads/feature/x',
        ].join('\n'),
      }
    }
    if (command.type === 'gitStatus' && command.path === '/srv/goblin-feature-x') {
      return { ok: true, stderr: '', stdout: ' M file.txt\\0?? new.txt\\0' }
    }
    return { ok: true, stderr: '', stdout: '' }
  })

  const snapshot = await getRemoteSnapshot(TARGET, { run })

  expect(snapshot?.branches.find((branch) => branch.name === 'main')).toMatchObject({
    worktreePath: '/srv/goblin',
    worktreeIsPrimary: true,
    worktreeDirty: false,
    worktreeChangeCount: 0,
  })
  expect(snapshot?.branches.find((branch) => branch.name === 'feature/x')).toMatchObject({
    worktreePath: '/srv/goblin-feature-x',
    worktreeIsPrimary: false,
    worktreeDirty: true,
    worktreeChangeCount: 2,
  })
})

test('reads remote status for all non-bare worktrees', async () => {
  const { getRemoteStatus } = await import('#/main/ssh/git.ts')
  const run = vi.fn(async (command) => {
    if (command.type === 'gitWorktreeList') {
      return {
        ok: true,
        stderr: '',
        stdout: [
          'worktree /srv/goblin',
          'HEAD abc1234',
          'branch refs/heads/main',
          '',
          'worktree /srv/goblin-feature-x',
          'HEAD def5678',
          'branch refs/heads/feature/x',
        ].join('\n'),
      }
    }
    if (command.type === 'gitStatus' && command.path === '/srv/goblin-feature-x') {
      return { ok: true, stderr: '', stdout: ' M file.txt\\0?? new.txt\\0' }
    }
    return { ok: true, stderr: '', stdout: '' }
  })

  await expect(getRemoteStatus(TARGET, { run })).resolves.toEqual([
    { path: '/srv/goblin', entries: [] },
    {
      path: '/srv/goblin-feature-x',
      entries: [
        { x: ' ', y: 'M', path: 'file.txt' },
        { x: '?', y: '?', path: 'new.txt' },
      ],
    },
  ])
})

test('runs remote fetch and worktree creation as ExecResult operations', async () => {
  const { createRemoteWorktree, fetchRemoteRepository } = await import('#/main/ssh/git.ts')
  const run = vi.fn(async () => ({ ok: true, stdout: '', stderr: '' }))

  await expect(fetchRemoteRepository(TARGET, { run })).resolves.toEqual({ ok: true, message: 'ok' })
  await expect(
    createRemoteWorktree(TARGET, {
      worktreePath: '/srv/goblin-feature-x',
      newBranch: 'feature/x',
      baseBranch: 'main',
      run,
    }),
  ).resolves.toEqual({ ok: true, message: 'ok' })

  expect(run).toHaveBeenCalledWith({ type: 'gitFetch', path: '/srv/goblin' }, TARGET, { signal: undefined })
  expect(run).toHaveBeenCalledWith(
    {
      type: 'gitWorktreeAdd',
      path: '/srv/goblin',
      worktreePath: '/srv/goblin-feature-x',
      newBranch: 'feature/x',
      baseBranch: 'main',
    },
    TARGET,
    { signal: undefined, timeoutMs: 180_000 },
  )
})

test('reads remote logs with pagination args', async () => {
  const { getRemoteLog } = await import('#/main/ssh/git.ts')
  const run = vi.fn(async () => ({
    ok: true,
    stderr: '',
    stdout: ['hash1', 'h1', 'message', 'Ada', '2026-05-28T10:00:00Z'].join(FIELD_SEP),
  }))

  await expect(getRemoteLog(TARGET, 'feature/x', 30, 60, { run })).resolves.toEqual([
    {
      hash: 'hash1',
      shortHash: 'h1',
      message: 'message',
      author: 'Ada',
      date: '2026-05-28T10:00:00Z',
    },
  ])
  expect(run).toHaveBeenCalledWith(
    { type: 'gitLog', path: '/srv/goblin', branch: 'feature/x', count: 30, skip: 60 },
    TARGET,
    { signal: undefined },
  )
})
```

- [ ] **Step 2: Run backend tests and verify red**

Run:

```sh
bun run test "src/main/ssh/git.test.ts"
```

Expected: FAIL because `getRemoteStatus`, `fetchRemoteRepository`, `createRemoteWorktree`, and `getRemoteLog` do not exist, and snapshot does not merge worktrees.

- [ ] **Step 3: Implement remote Git helpers**

Add functions to `src/main/ssh/git.ts`:

```ts
import { parseBranches, parseLog, parseStatus, parseWorktrees } from '#/main/git/parsers.ts'
import type { ExecResult, WorktreeStatus } from '#/shared/git-types.ts'

const REMOTE_WORKTREE_OP_TIMEOUT_MS = 180_000
const REMOTE_WORKTREE_STATUS_CONCURRENCY = 8

export async function fetchRemoteRepository(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<ExecResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'gitFetch', path: target.remotePath }, target, { signal: options.signal })
  return remoteExecResult(result)
}

export async function getRemoteLog(
  target: RemoteRepoTarget,
  branch: string,
  count?: number,
  skip?: number,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<LogEntry[]> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'gitLog', path: target.remotePath, branch, count, skip }, target, {
    signal: options.signal,
  })
  return result.ok ? parseLog(result.stdout) : []
}

export async function createRemoteWorktree(
  target: RemoteRepoTarget,
  input: { worktreePath: string; newBranch: string; baseBranch: string; signal?: AbortSignal; run?: RemoteGitRunner },
): Promise<ExecResult> {
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    {
      type: 'gitWorktreeAdd',
      path: target.remotePath,
      worktreePath: input.worktreePath,
      newBranch: input.newBranch,
      baseBranch: input.baseBranch,
    },
    target,
    { signal: input.signal, timeoutMs: REMOTE_WORKTREE_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}

function remoteExecResult(result: RemoteCommandResult): ExecResult {
  if (result.ok) return { ok: true, message: result.stdout || result.stderr || 'ok' }
  return { ok: false, message: result.message || result.stderr || 'error.unknown' }
}
```

Update `getRemoteSnapshot` to fetch worktrees before `parseRemoteSnapshot`:

```ts
export async function getRemoteSnapshot(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<RemoteRepoSnapshot | null> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const [snapshotResult, worktrees] = await Promise.all([
    run({ type: 'gitSnapshot', path: target.remotePath }, target, { signal: options.signal }),
    getRemoteWorktrees(target, { signal: options.signal, run }),
  ])
  if (!snapshotResult.ok) return null
  return parseRemoteSnapshot(snapshotResult.stdout, worktrees)
}
```

Add status/worktree helpers:

```ts
async function getRemoteWorktrees(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<WorktreeInfo[]> {
  const result = await options.run({ type: 'gitWorktreeList', path: target.remotePath }, target, {
    signal: options.signal,
  })
  if (!result.ok) return []
  const worktrees = parseWorktrees(result.stdout)
  await mapWithConcurrency(
    worktrees,
    REMOTE_WORKTREE_STATUS_CONCURRENCY,
    async (worktree) => {
      if (worktree.isBare) return
      const status = await options.run({ type: 'gitStatus', path: worktree.path }, target, { signal: options.signal })
      if (!status.ok) {
        worktree.isDirty = undefined
        return
      }
      const entries = parseStatus(status.stdout)
      worktree.isDirty = entries.length > 0
      worktree.changeCount = entries.length
    },
    options.signal,
  )
  return worktrees
}

export async function getRemoteStatus(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<WorktreeStatus[]> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'gitWorktreeList', path: target.remotePath }, target, { signal: options.signal })
  if (!result.ok) return []
  const worktrees = parseWorktrees(result.stdout).filter((worktree) => !worktree.isBare)
  const statuses: WorktreeStatus[] = []
  await mapWithConcurrency(
    worktrees,
    REMOTE_WORKTREE_STATUS_CONCURRENCY,
    async (worktree) => {
      const status = await run({ type: 'gitStatus', path: worktree.path }, target, { signal: options.signal })
      statuses.push({ path: worktree.path, entries: status.ok ? parseStatus(status.stdout) : [] })
    },
    options.signal,
  )
  return statuses.sort((a, b) => a.path.localeCompare(b.path))
}
```

Change `parseRemoteSnapshot` signature:

```ts
export function parseRemoteSnapshot(output: string, worktrees: WorktreeInfo[] = []): RemoteRepoSnapshot | null {
  const sections = splitSnapshotSections(output)
  if (!sections) return null
  const current = firstLine(sections.current)
  const defaultBranch = firstLine(sections.defaultBranch)
  const branchOutput = sections.branches.join('\n')
  const branches = parseBranches(branchOutput, current, worktrees)
  const markedBranches = markDefaultBranch(branches, defaultBranch)
  return { branches: prioritizeDefaultBranch(markedBranches, defaultBranch), current }
}
```

Add local `mapWithConcurrency` or extract a small shared helper only if duplication grows. Keep it private in `ssh/git.ts` for now.

- [ ] **Step 4: Run backend tests and verify green**

Run:

```sh
bun run test "src/main/ssh/git.test.ts"
```

Expected: PASS.

## Task 3: Remote RPC Schema And Main Handlers

**Files:**

- Modify: `src/shared/rpc.ts`
- Modify: `src/main/rpc.ts`
- Test: `src/main/rpc.test.ts`

- [ ] **Step 1: Write failing router tests**

Add tests near existing remote RPC boundary tests in `src/main/rpc.test.ts`:

```ts
test('accepts remote fetch, status, log, and create worktree procedures', async () => {
  await expect(
    invokeRpc('remote.fetch', {
      target: REMOTE_TARGET,
    }),
  ).resolves.toMatchObject({ ok: true })

  await expect(
    invokeRpc('remote.status', {
      target: REMOTE_TARGET,
    }),
  ).resolves.toMatchObject({ ok: true })

  await expect(
    invokeRpc('remote.log', {
      target: REMOTE_TARGET,
      branch: 'feature/x',
      count: 30,
      skip: 0,
    }),
  ).resolves.toMatchObject({ ok: true })

  await expect(
    invokeRpc('remote.createWorktree', {
      target: REMOTE_TARGET,
      worktreePath: '/srv/goblin-feature-x',
      newBranch: 'feature/x',
      baseBranch: 'main',
    }),
  ).resolves.toMatchObject({ ok: true })
})

test('rejects invalid remote worktree create arguments at the router boundary', async () => {
  const result = await invokeRpc('remote.createWorktree', {
    target: REMOTE_TARGET,
    worktreePath: 'relative/path',
    newBranch: 'feature/x',
    baseBranch: 'main',
  })

  expect(result.ok).toBe(false)
})
```

If `REMOTE_TARGET` is not exported in the test file, define it using the same shape as other remote tests:

```ts
const REMOTE_TARGET = {
  id: 'ssh://deploy@prod:22/srv/goblin',
  alias: null,
  host: 'prod',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}
```

- [ ] **Step 2: Run RPC tests and verify red**

Run:

```sh
bun run test "src/main/rpc.test.ts"
```

Expected: FAIL because the remote procedures do not exist.

- [ ] **Step 3: Add shared RPC contracts**

In `src/shared/rpc.ts`, extend `AppRpcHandlers['remote']`:

```ts
fetch: (input: { target: RemoteRepoTarget }) => Promise<ExecResult>
status: (input: { target: RemoteRepoTarget }) => Promise<WorktreeStatus[]>
log: (input: { target: RemoteRepoTarget; branch: string; count?: number; skip?: number }) => Promise<LogEntry[]>
createWorktree: (input: { target: RemoteRepoTarget; worktreePath: string; newBranch: string; baseBranch: string }) =>
  Promise<ExecResult>
```

Add router procedures under `remote: t.router({ ... })`:

```ts
fetch: p.input(v.object({ target: RemoteTargetSchema })).mutation(({ input }) => handlers.remote.fetch(input)),
status: p.input(v.object({ target: RemoteTargetSchema })).query(({ input }) => handlers.remote.status(input)),
log: p
  .input(
    v.object({
      target: RemoteTargetSchema,
      branch: v.string(),
      count: v.optional(FiniteNumber),
      skip: v.optional(FiniteNumber),
    }),
  )
  .query(({ input }) => handlers.remote.log(input)),
createWorktree: p
  .input(
    v.object({
      target: RemoteTargetSchema,
      worktreePath: v.string(),
      newBranch: v.string(),
      baseBranch: v.string(),
    }),
  )
  .mutation(({ input }) => handlers.remote.createWorktree(input)),
```

- [ ] **Step 4: Wire main handlers with validation**

In `src/main/rpc.ts`, import:

```ts
import {
  createRemoteWorktree,
  fetchRemoteRepository,
  getRemoteLog,
  getRemoteSnapshot,
  getRemoteStatus,
} from '#/main/ssh/git.ts'
```

Add helpers near remote handlers:

```ts
function normalizedRemoteTargetOrThrow(target: RemoteRepoTarget): RemoteRepoTarget {
  const normalized = normalizeRemoteTarget(target)
  if (!normalized || normalized.id !== target.id) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid remote repository target' })
  }
  return normalized
}

function isValidRemoteAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.includes('\0')
}
```

Use them in remote handlers:

```ts
fetch: async ({ target }) => fetchRemoteRepository(normalizedRemoteTargetOrThrow(target), { signal: currentRpcSignal() }),
status: async ({ target }) => getRemoteStatus(normalizedRemoteTargetOrThrow(target), { signal: currentRpcSignal() }),
log: async ({ target, branch, count, skip }) => {
  if (!isValidBranch(branch)) return []
  return getRemoteLog(normalizedRemoteTargetOrThrow(target), branch, count, skip, { signal: currentRpcSignal() })
},
createWorktree: async ({ target, worktreePath, newBranch, baseBranch }) => {
  if (!isValidRemoteAbsolutePath(worktreePath) || !isValidBranch(newBranch) || !isValidBranch(baseBranch)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  return createRemoteWorktree(normalizedRemoteTargetOrThrow(target), {
    worktreePath,
    newBranch,
    baseBranch,
    signal: currentRpcSignal(),
  })
},
```

Refactor existing `testRepository`, `snapshot`, `home`, and `listDirectory` to use `normalizedRemoteTargetOrThrow` for DRY validation.

- [ ] **Step 5: Run RPC tests and verify green**

Run:

```sh
bun run test "src/main/rpc.test.ts"
```

Expected: PASS.

## Task 4: Renderer Remote Refresh, Status, And Logs

**Files:**

- Modify: `src/renderer/stores/repos/refresh.ts`
- Modify: `src/renderer/stores/repos/refresh-workflows.ts`
- Modify: `src/renderer/stores/repos/sync-state.ts`
- Test: `src/renderer/stores/repos/refresh.test.ts`

- [ ] **Step 1: Replace remote Phase 1 skip tests with failing support tests**

In `src/renderer/stores/repos/refresh.test.ts`, replace the tests named `refreshSnapshot skips remote repositories during Phase 1` and `backgroundFetch skips remote repositories during Phase 1` with:

```ts
test('refreshSnapshot loads remote repositories through remote RPC', async () => {
  const token = seedRemoteRepo()
  const remoteSnapshots: string[] = []
  rpcHandlers['remote.snapshot'] = async ({ target }: { target: RemoteRepoTarget }) => {
    remoteSnapshots.push(target.id)
    return { branches: [branch('feature/remote')], current: 'feature/remote' }
  }

  await useReposStore.getState().refreshSnapshot(REMOTE_TARGET.id, { token })

  const repo = useReposStore.getState().repos[REMOTE_TARGET.id]
  expect(remoteSnapshots).toEqual([REMOTE_TARGET.id])
  expect(repo?.data.branches.map((item) => item.name)).toEqual(['feature/remote'])
  expect(repo?.ui.selectedBranch).toBe('feature/remote')
  expect(repo?.resources.snapshot.phase).toBe('idle')
})

test('refreshStatus loads remote worktree status through remote RPC', async () => {
  const token = seedRemoteRepo()
  const status: WorktreeStatus[] = [{ path: '/srv/goblin-feature', entries: [{ x: ' ', y: 'M', path: 'a.txt' }] }]
  rpcHandlers['remote.status'] = async ({ target }: { target: RemoteRepoTarget }) => {
    expect(target.id).toBe(REMOTE_TARGET.id)
    return status
  }

  await useReposStore.getState().refreshStatus(REMOTE_TARGET.id, { token })

  const repo = useReposStore.getState().repos[REMOTE_TARGET.id]
  expect(repo?.data.status).toEqual(status)
  expect(repo?.data.statusLoaded).toBe(true)
})

test('refreshBranchLog loads remote commits through remote RPC', async () => {
  const token = seedRemoteRepo()
  useReposStore.setState((s) => ({
    repos: {
      ...s.repos,
      [REMOTE_TARGET.id]: replaceRepo(s.repos[REMOTE_TARGET.id]!, (repo) => {
        repo.data.branches = [branch('feature/remote')]
        repo.ui.selectedBranch = 'feature/remote'
      }),
    },
  }))
  rpcHandlers['remote.log'] = async ({ target, branch: branchName, count, skip }: any) => {
    expect(target.id).toBe(REMOTE_TARGET.id)
    expect(branchName).toBe('feature/remote')
    expect(count).toBe(INITIAL_LOG_COUNT + 1)
    expect(skip).toBe(0)
    return [logEntry(1)]
  }

  await useReposStore.getState().refreshBranchLog(REMOTE_TARGET.id, undefined, { token })

  expect(useReposStore.getState().repos[REMOTE_TARGET.id]?.data.logsByBranch['feature/remote']?.entries).toEqual([
    logEntry(1),
  ])
})

test('backgroundFetch still skips remote repositories', async () => {
  seedRemoteRepo()
  let fetchCalls = 0
  rpcHandlers['remote.fetch'] = async () => {
    fetchCalls += 1
    return { ok: true, message: 'ok' }
  }

  await useReposStore.getState().backgroundFetch(REMOTE_TARGET.id)

  expect(fetchCalls).toBe(0)
  expect(useReposStore.getState().repos[REMOTE_TARGET.id]?.resources.fetch.loadedAt).toBeNull()
})
```

- [ ] **Step 2: Add failing manual remote sync test**

Add:

```ts
test('manual sync fetches remote repositories and refreshes remote data', async () => {
  const token = seedRemoteRepo()
  const calls: string[] = []
  rpcHandlers['remote.fetch'] = async ({ target }: { target: RemoteRepoTarget }) => {
    calls.push(`fetch:${target.id}`)
    return { ok: true, message: 'ok' }
  }
  rpcHandlers['remote.snapshot'] = async () => {
    calls.push('snapshot')
    return { branches: [branch('feature/remote')], current: 'feature/remote' }
  }
  rpcHandlers['remote.status'] = async () => {
    calls.push('status')
    return []
  }

  await useReposStore.getState().syncAndRefresh(REMOTE_TARGET.id, { token })

  expect(calls).toContain(`fetch:${REMOTE_TARGET.id}`)
  expect(calls).toContain('snapshot')
  expect(calls).toContain('status')
  expect(useReposStore.getState().repos[REMOTE_TARGET.id]?.resources.fetch.loadedAt).not.toBeNull()
})
```

- [ ] **Step 3: Run refresh tests and verify red**

Run:

```sh
bun run test "src/renderer/stores/repos/refresh.test.ts"
```

Expected: FAIL because remote refresh paths still bail out or call local RPC.

- [ ] **Step 4: Split local availability checks by capability**

In `src/renderer/stores/repos/refresh.ts`, replace `localRepoAvailable` checks with helpers:

```ts
function repoAvailable(repo: { kind: string } | undefined): boolean {
  return !!repo
}

function localRepoAvailable(repo: { kind: string } | undefined): boolean {
  return !!repo && repo.kind !== 'remote'
}

function remoteRepoTarget(
  repo: { kind: string; remoteTarget?: RemoteRepoTarget | null } | undefined,
): RemoteRepoTarget | null {
  return repo?.kind === 'remote' ? (repo.remoteTarget ?? null) : null
}
```

Use `repoAvailable` for snapshot/status/log and choose the RPC task by `repo.kind`:

```ts
const snapshotTask =
  repoBefore.kind === 'remote'
    ? repoBefore.remoteTarget
      ? (signal: AbortSignal) => rpc.remote.snapshot.query({ target: repoBefore.remoteTarget! }, { signal })
      : null
    : (signal: AbortSignal) => rpc.repo.snapshot.query({ cwd: id }, { signal })
```

For `refreshBranchLogPage`, choose:

```ts
const logTask =
  repoBefore.kind === 'remote' && repoBefore.remoteTarget
    ? (signal: AbortSignal) =>
        rpc.remote.log.query(
          { target: repoBefore.remoteTarget!, branch, count: requestCount, skip: loaded },
          { signal },
        )
    : repoBefore.kind !== 'remote'
      ? (signal: AbortSignal) => rpc.repo.log.query({ cwd: id, branch, count: requestCount, skip: loaded }, { signal })
      : null
if (!logTask) return
```

For `refreshStatus`, choose:

```ts
const statusTask =
  repoBefore.kind === 'remote' && repoBefore.remoteTarget
    ? (signal: AbortSignal) => rpc.remote.status.query({ target: repoBefore.remoteTarget! }, { signal })
    : repoBefore.kind !== 'remote'
      ? (signal: AbortSignal) => rpc.repo.status.query({ cwd: id }, { signal })
      : null
if (!statusTask) return
```

- [ ] **Step 5: Allow manual remote sync but keep background fetch local-only**

In `src/renderer/stores/repos/sync-state.ts`, replace the remote blanket block:

```ts
export function canStartManualFetch(repo: RepoState | undefined): repo is RepoState {
  if (!repo) return false
  return (
    !resourceBusy(repo.resources.fetch) &&
    !resourceBusy(repo.resources.branchAction) &&
    !resourceBusy(repo.resources.snapshot) &&
    !resourceBusy(repo.resources.status) &&
    !repoOperationBusy(repo.id, 'fetch') &&
    !repoOperationBusy(repo.id, 'branchAction') &&
    !repoOperationBusy(repo.id, 'snapshot') &&
    !repoOperationBusy(repo.id, 'status')
  )
}

export function canStartRemoteFetch(repo: RepoState | undefined): repo is RepoState {
  return !!repo && repo.kind !== 'remote' && canStartManualFetch(repo)
}
```

Update `src/renderer/stores/repos/sync-state.test.ts` imports:

```ts
import { canStartManualFetch, canStartRemoteFetch, isRemoteFetchDue } from '#/renderer/stores/repos/sync-state.ts'
```

Add this test under `describe('canStartRemoteFetch', ...)`:

```ts
test('allows manual fetch checks for remote repos but keeps background remote fetch blocked', () => {
  const remote = repo()
  remote.kind = 'remote'

  expect(canStartManualFetch(remote)).toBe(true)
  expect(canStartRemoteFetch(remote)).toBe(false)
  expect(isRemoteFetchDue(remote, 60_000, 100_000)).toBe(false)
})
```

In `refresh.ts`, import `canStartManualFetch` and use it in `syncAndRefresh`:

```ts
if (!canStartManualFetch(repoBefore)) return
const fetchTask =
  repoBefore.kind === 'remote' && repoBefore.remoteTarget
    ? (signal: AbortSignal) => rpc.remote.fetch.mutate({ target: repoBefore.remoteTarget! }, { signal })
    : repoBefore.kind !== 'remote'
      ? (signal: AbortSignal) => rpc.repo.fetch.mutate({ cwd: id }, { signal })
      : null
if (!fetchTask) return
result = await runNetworkTask(id, fetchTask, { token, reason: 'user-fetch', priority: 100 })
```

Keep `backgroundFetch` using `canStartRemoteFetch`, so remote background fetch remains skipped.

- [ ] **Step 6: Skip PR refresh for remote repos**

In `src/renderer/stores/repos/refresh-workflows.ts`, guard PR calls:

```ts
function localRepoFresh(get: ReposGet, id: string, token: number): boolean {
  const repo = get().repos[id]
  return !!repo && repo.kind !== 'remote' && repo.instanceToken === token
}
```

Use `localRepoFresh` before `refreshPullRequestsAfterSnapshot`, `runSelectedBranchChangedWorkflow`, `runSelectedBranchStatusWorkflow`, and the status-tab PR fetch. Keep commit and status refresh behavior for remote repos.

- [ ] **Step 7: Run refresh tests and verify green**

Run:

```sh
bun run test "src/renderer/stores/repos/refresh.test.ts" "src/renderer/stores/repos/sync-state.test.ts"
```

Expected: PASS.

## Task 5: Remote Worktree Creation In Store And Dialog

**Files:**

- Modify: `src/renderer/stores/repos/branch-actions.ts`
- Modify: `src/renderer/components/CreateWorktreeDialog.tsx`
- Modify: `src/renderer/lib/paths.ts`
- Test: `src/renderer/stores/repos/branch-actions.test.ts`
- Test: create or modify `src/renderer/components/CreateWorktreeDialog.test.tsx`

- [ ] **Step 1: Write failing branch action tests**

Add to `src/renderer/stores/repos/branch-actions.test.ts`:

```ts
const REMOTE_TARGET = {
  id: 'ssh://deploy@prod:22/srv/goblin',
  alias: null,
  host: 'prod',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

test('allows remote create worktree and refreshes remote snapshot/status', async () => {
  resetReposStore()
  const remote = emptyRepo(REMOTE_TARGET.id, REMOTE_TARGET.displayName, {
    kind: 'remote',
    remoteTarget: REMOTE_TARGET,
  })
  useReposStore.setState({
    repos: { [REMOTE_TARGET.id]: remote },
    order: [REMOTE_TARGET.id],
    activeId: REMOTE_TARGET.id,
    sessionReady: true,
  })
  const calls: string[] = []
  installGoblinTestBridge({
    'remote.createWorktree': async ({ target, worktreePath, newBranch, baseBranch }: any) => {
      calls.push(`${target.id}:${worktreePath}:${newBranch}:${baseBranch}`)
      return { ok: true, message: 'ok' }
    },
    'remote.snapshot': async () => ({ branches: [], current: '' }),
    'remote.status': async () => [],
    'repo.abort': async () => false,
  })

  const result = await useReposStore.getState().runBranchAction(REMOTE_TARGET.id, {
    kind: 'createWorktree',
    worktreePath: '/srv/goblin-feature-x',
    newBranch: 'feature/x',
    baseBranch: 'main',
  })

  expect(result).toEqual({ ok: true, message: 'ok' })
  expect(calls).toEqual([`${REMOTE_TARGET.id}:/srv/goblin-feature-x:feature/x:main`])
})

test('keeps non-create remote branch actions unavailable', async () => {
  resetReposStore()
  const remote = emptyRepo(REMOTE_TARGET.id, REMOTE_TARGET.displayName, {
    kind: 'remote',
    remoteTarget: REMOTE_TARGET,
  })
  useReposStore.setState({
    repos: { [REMOTE_TARGET.id]: remote },
    order: [REMOTE_TARGET.id],
    activeId: REMOTE_TARGET.id,
    sessionReady: true,
  })

  const result = await useReposStore.getState().runBranchAction(REMOTE_TARGET.id, {
    kind: 'push',
    branch: 'feature/x',
  })

  expect(result).toEqual({ ok: false, message: 'error.remote-unavailable' })
})
```

- [ ] **Step 2: Write failing path helper tests**

Create `src/renderer/components/CreateWorktreeDialog.test.tsx` with:

```ts
import { describe, expect, test } from 'vitest'
import { defaultRemoteWorktreePath, isRemoteAbsolutePath } from '#/renderer/lib/paths.ts'

describe('remote worktree paths', () => {
  test('uses a sibling path based on remote repository path and branch slug', () => {
    expect(defaultRemoteWorktreePath('/srv/goblin', 'feat/new-ui')).toBe('/srv/goblin-feat-new-ui')
    expect(defaultRemoteWorktreePath('/srv/goblin/', 'bugfix/JIRA-123')).toBe('/srv/goblin-bugfix-JIRA-123')
    expect(defaultRemoteWorktreePath('/', 'feat/root')).toBe('/feat-root')
  })

  test('validates remote absolute paths without local filesystem assumptions', () => {
    expect(isRemoteAbsolutePath('/srv/goblin-feature')).toBe(true)
    expect(isRemoteAbsolutePath('srv/goblin-feature')).toBe(false)
    expect(isRemoteAbsolutePath('/bad\\0path')).toBe(false)
  })
})
```

- [ ] **Step 3: Run branch action and dialog tests and verify red**

Run:

```sh
bun run test "src/renderer/stores/repos/branch-actions.test.ts" "src/renderer/components/CreateWorktreeDialog.test.tsx"
```

Expected: FAIL because remote createWorktree is blocked and path helpers do not exist.

- [ ] **Step 4: Add remote path helpers**

In `src/renderer/lib/paths.ts`, add:

```ts
export function isRemoteAbsolutePath(value: string): boolean {
  return value.startsWith('/') && !value.includes('\0')
}

export function defaultRemoteWorktreePath(remoteRepoPath: string, branchName: string): string {
  const normalizedRepoPath = remoteRepoPath.trim().replace(/\/+$/, '') || '/'
  const branchSlug = branchName
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!branchSlug) return normalizedRepoPath
  if (normalizedRepoPath === '/') return `/${branchSlug}`
  return `${normalizedRepoPath}-${branchSlug}`
}
```

- [ ] **Step 5: Make CreateWorktreeDialog remote-aware**

Update props:

```ts
interface Props {
  open: boolean
  repo: RepoState
  onClose: () => void
  onCreate: (request: CreateWorktreeRequest) => void | Promise<void>
}
```

Use a remote-aware default:

```ts
const defaultPath =
  repo.kind === 'remote' && repo.remoteTarget
    ? defaultRemoteWorktreePath(repo.remoteTarget.remotePath, branchTrimmed)
    : defaultWorktreePath(repo.id, branchTrimmed)
const pathValid = repo.kind === 'remote' ? isRemoteAbsolutePath(effectivePath) : effectivePath.length > 0
const displayDefaultPath = repo.kind === 'remote' ? defaultPath : tildify(defaultPath)
const displayEffectivePath = repo.kind === 'remote' ? effectivePath : tildify(effectivePath)
const canSubmit = branchTrimmed.length > 0 && !branchError && pathValid && base.length > 0
```

Keep local behavior unchanged.

- [ ] **Step 6: Route remote createWorktree in branch actions**

In `src/renderer/stores/repos/branch-actions.ts`, replace the blanket remote block:

```ts
if (repoBefore.kind === 'remote' && action.kind !== 'createWorktree') {
  return { ok: false, message: 'error.remote-unavailable' }
}
```

In `runBranchActionRpc`, route createWorktree by repo kind:

```ts
function runBranchActionRpc(action: RepoBranchAction, repo: RepoState, signal?: AbortSignal): Promise<ExecResult> {
  if (repo.kind === 'remote') {
    if (action.kind !== 'createWorktree' || !repo.remoteTarget) {
      return Promise.resolve({ ok: false, message: 'error.remote-unavailable' })
    }
    return rpc.remote.createWorktree.mutate(
      {
        target: repo.remoteTarget,
        worktreePath: action.worktreePath,
        newBranch: action.newBranch,
        baseBranch: action.baseBranch,
      },
      { signal },
    )
  }
  // existing local switch remains here
}
```

Adjust the call site:

```ts
task: (signal) => runBranchActionRpc(action, repoBefore, signal),
```

- [ ] **Step 7: Run tests and verify green**

Run:

```sh
bun run test "src/renderer/stores/repos/branch-actions.test.ts" "src/renderer/components/CreateWorktreeDialog.test.tsx"
```

Expected: PASS.

## Task 6: Remote Terminal Input Types And Main IPC

**Files:**

- Modify: `src/shared/terminal.ts`
- Modify: `src/main/terminal.ts`
- Test: `src/main/terminal.test.ts`

- [ ] **Step 1: Write failing terminal IPC tests**

Add to `src/main/terminal.test.ts`:

```ts
const REMOTE_TARGET = {
  id: 'ssh://deploy@prod:22/srv/goblin',
  alias: null,
  host: 'prod',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

test('opens a remote terminal session without local worktree probing', async () => {
  const result = await invoke<TerminalOpenInput>('goblin:terminal-open', {
    kind: 'remote',
    target: REMOTE_TARGET,
    branch: 'feature',
    worktreePath: '/srv/goblin-feature',
    terminalId: 'terminal-1',
    cols: 80,
    rows: 24,
  })

  expect(result).toMatchObject({ ok: true, sessionId: 'term_123456789012' })
  expect(getWorktrees).not.toHaveBeenCalled()
  expect(openTerminalSession).toHaveBeenCalledWith({
    ownerWebContentsId: 1,
    scope: 'ssh://deploy@prod:22/srv/goblin',
    key: 'remote\0ssh://deploy@prod:22/srv/goblin\0/srv/goblin-feature\0terminal-1',
    cwd: expect.any(String),
    cols: 80,
    rows: 24,
    forceNew: false,
    command: expect.objectContaining({ command: 'ssh' }),
  })
})

test('rejects invalid remote terminal worktree paths', async () => {
  const result = await invoke<TerminalOpenInput>('goblin:terminal-open', {
    kind: 'remote',
    target: REMOTE_TARGET,
    branch: 'feature',
    worktreePath: 'relative',
    terminalId: 'terminal-1',
    cols: 80,
    rows: 24,
  })

  expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
  expect(openTerminalSession).not.toHaveBeenCalled()
})

test('prunes remote terminal sessions by remote scope', () => {
  expect(
    invoke('goblin:terminal-prune-repo', {
      kind: 'remote',
      repoId: REMOTE_TARGET.id,
      worktreePaths: ['/srv/goblin-feature'],
    }),
  ).toBe(true)
})
```

- [ ] **Step 2: Run terminal tests and verify red**

Run:

```sh
bun run test "src/main/terminal.test.ts"
```

Expected: FAIL because shared terminal inputs are local-only and `openTerminalSession` does not accept a command override.

- [ ] **Step 3: Extend shared terminal types**

In `src/shared/terminal.ts`, replace `TerminalOpenInput` with:

```ts
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

export type LocalTerminalOpenInput = {
  kind?: 'local'
  repoRoot: string
  branch: string
  worktreePath: string
  terminalId: string
  cols: number
  rows: number
}

export type RemoteTerminalOpenInput = {
  kind: 'remote'
  target: RemoteRepoTarget
  branch: string
  worktreePath: string
  terminalId: string
  cols: number
  rows: number
}

export type TerminalOpenInput = LocalTerminalOpenInput | RemoteTerminalOpenInput
export type TerminalRestartInput = TerminalOpenInput

export type TerminalPruneRepoInput =
  | { kind?: 'local'; repoRoot: string; worktreePaths: string[] }
  | { kind: 'remote'; repoId: string; worktreePaths: string[] }
```

- [ ] **Step 4: Add command override to terminal core**

In `src/main/terminal-core.ts`, extend input:

```ts
export interface TerminalCommandSpec {
  command: string
  args: string[]
}

export interface TerminalOpenSessionInput {
  ownerWebContentsId: number
  scope: string
  key: string
  cwd: string
  cols: number
  rows: number
  forceNew?: boolean
  command?: TerminalCommandSpec
}
```

Use it in spawn:

```ts
const command = input.command ?? {
  command: process.env.SHELL || (process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : '/bin/zsh'),
  args: process.platform === 'win32' ? [] : ['-l'],
}
session.pty = pty.spawn(command.command, command.args, {
  name: 'xterm-256color',
  cols: size.cols,
  rows: size.rows,
  cwd,
  env,
})
```

Existing local tests should still pass because `command` is optional.

- [ ] **Step 5: Implement remote terminal IPC routing**

In `src/main/terminal.ts`, import:

```ts
import os from 'node:os'
import { buildRemoteTerminalInvocation } from '#/main/ssh/commands.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
```

Route in `openGoblinWorktreeTerminal`:

```ts
if (input?.kind === 'remote') {
  return openGoblinRemoteTerminal(ownerWebContentsId, input, options)
}
return openGoblinLocalWorktreeTerminal(ownerWebContentsId, input, options)
```

Add:

```ts
async function openGoblinRemoteTerminal(
  ownerWebContentsId: number,
  input: Extract<TerminalOpenInput, { kind: 'remote' }>,
  options: { restart?: boolean } = {},
): Promise<TerminalOpenResult> {
  const target = normalizeRemoteTarget(input?.target)
  if (
    !target ||
    target.id !== input.target.id ||
    !isValidBranch(input.branch) ||
    !isValidRemoteAbsolutePath(input.worktreePath) ||
    !isValidTerminalId(input.terminalId) ||
    !isValidTerminalSize(input.cols, input.rows)
  ) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const invocation = buildRemoteTerminalInvocation(target, input.worktreePath, { cols: input.cols, rows: input.rows })
  return openTerminalSession({
    ownerWebContentsId,
    scope: target.id,
    key: remoteSessionKey(target.id, input.worktreePath, input.terminalId),
    cwd: os.homedir(),
    cols: input.cols,
    rows: input.rows,
    forceNew: options.restart === true,
    command: { command: invocation.command, args: invocation.args },
  })
}

function isValidRemoteAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.includes('\0')
}

function remoteSessionKey(repoId: string, worktreePath: string, terminalId?: string): string {
  return terminalId ? `remote\0${repoId}\0${worktreePath}\0${terminalId}` : `remote\0${repoId}\0${worktreePath}`
}
```

Update prune:

```ts
if (input?.kind === 'remote') {
  if (!isValidRemoteRepoId(input.repoId) || !isValidTerminalWorktreePathList(input.worktreePaths)) return false
  pruneRemoteRepoSessions(event.sender.id, input.repoId, input.worktreePaths)
  return true
}
```

Add:

```ts
export function pruneRemoteRepoSessions(ownerWebContentsId: number, repoId: string, worktreePaths: string[]): void {
  const liveKeys = new Set(worktreePaths.filter(isValidRemoteAbsolutePath).map((p) => remoteSessionKey(repoId, p)))
  pruneTerminalScope(ownerWebContentsId, repoId, liveKeys)
}
```

- [ ] **Step 6: Run terminal tests and verify green**

Run:

```sh
bun run test "src/main/terminal.test.ts" "src/main/terminal-core.test.ts"
```

Expected: PASS.

## Task 7: Renderer Remote Terminal Descriptors

**Files:**

- Modify: `src/renderer/components/terminal/types.ts`
- Modify: `src/renderer/components/terminal/terminal-session-utils.ts`
- Modify: `src/renderer/components/terminal/ManagedTerminalSession.ts`
- Modify: `src/renderer/components/terminal/TerminalSlot.tsx`
- Modify: `src/renderer/components/branch-detail/BranchDetailContent.tsx`
- Test: `src/renderer/components/terminal/terminal-session-utils.test.ts`
- Test: `src/renderer/components/terminal/ManagedTerminalSession.test.ts`

- [ ] **Step 1: Write failing terminal utility tests**

Extend `src/renderer/components/terminal/terminal-session-utils.test.ts`:

```ts
const REMOTE_TARGET = {
  id: 'ssh://deploy@prod:22/srv/goblin',
  alias: null,
  host: 'prod',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  displayName: 'prod:goblin',
}

test('builds isolated remote terminal keys', () => {
  expect(
    terminalSessionGroupKey({ kind: 'remote', repoId: REMOTE_TARGET.id, worktreePath: '/srv/goblin-feature' }),
  ).toBe('remote\0ssh://deploy@prod:22/srv/goblin\0/srv/goblin-feature')
  expect(
    terminalSessionKey({ kind: 'remote', repoId: REMOTE_TARGET.id, worktreePath: '/srv/goblin-feature' }, 'terminal-1'),
  ).toBe('remote\0ssh://deploy@prod:22/srv/goblin\0/srv/goblin-feature\0terminal-1')
})

test('checks remote terminal descriptor liveness by remote repo id and worktree path', () => {
  const descriptor = terminalDescriptor(
    {
      kind: 'remote',
      repoId: REMOTE_TARGET.id,
      target: REMOTE_TARGET,
      branch: 'feature',
      worktreePath: '/srv/goblin-feature',
    },
    'terminal-1',
    1,
  )

  expect(
    isTerminalDescriptorLive(
      {
        [REMOTE_TARGET.id]: {
          data: { branches: [{ name: 'feature', worktreePath: '/srv/goblin-feature' }] },
        } as any,
      },
      descriptor,
    ),
  ).toBe(true)
})
```

- [ ] **Step 2: Write failing ManagedTerminalSession remote payload test**

Add to `src/renderer/components/terminal/ManagedTerminalSession.test.ts`:

```ts
test('opens remote terminal sessions with remote target payload', async () => {
  const remoteDescriptor = {
    key: 'remote\0ssh://deploy@prod:22/srv/goblin\0/srv/goblin-feature\0terminal-1',
    groupKey: 'remote\0ssh://deploy@prod:22/srv/goblin\0/srv/goblin-feature',
    terminalId: 'terminal-1',
    index: 1,
    kind: 'remote' as const,
    repoId: 'ssh://deploy@prod:22/srv/goblin',
    target: {
      id: 'ssh://deploy@prod:22/srv/goblin',
      alias: null,
      host: 'prod',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/goblin',
      displayName: 'prod:goblin',
    },
    branch: 'feature',
    worktreePath: '/srv/goblin-feature',
  }
  terminalCalls.open.mockResolvedValue(openResult('session-1'))
  const host = document.createElement('div')
  document.body.appendChild(host)

  const session = new ManagedTerminalSession(remoteDescriptor, vi.fn())
  session.attach(host)

  await flushUntil(() => terminalCalls.open.mock.calls.length === 1)
  expect(terminalCalls.open).toHaveBeenCalledWith({
    kind: 'remote',
    target: remoteDescriptor.target,
    branch: 'feature',
    worktreePath: '/srv/goblin-feature',
    terminalId: 'terminal-1',
    cols: 100,
    rows: 30,
  })
})
```

- [ ] **Step 3: Run renderer terminal tests and verify red**

Run:

```sh
bun run test "src/renderer/components/terminal/terminal-session-utils.test.ts" "src/renderer/components/terminal/ManagedTerminalSession.test.ts"
```

Expected: FAIL because descriptors are local-only.

- [ ] **Step 4: Add remote-aware descriptor types**

In `src/renderer/components/terminal/types.ts`:

```ts
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

export type TerminalDescriptor = LocalTerminalDescriptor | RemoteTerminalDescriptor

export interface LocalTerminalDescriptor {
  key: string
  groupKey: string
  terminalId: string
  index: number
  kind: 'local'
  repoRoot: string
  branch: string
  worktreePath: string
}

export interface RemoteTerminalDescriptor {
  key: string
  groupKey: string
  terminalId: string
  index: number
  kind: 'remote'
  repoId: string
  target: RemoteRepoTarget
  branch: string
  worktreePath: string
}

export type TerminalSessionBase =
  | { kind?: 'local'; repoRoot: string; branch: string; worktreePath: string }
  | { kind: 'remote'; repoId: string; target: RemoteRepoTarget; branch: string; worktreePath: string }
```

- [ ] **Step 5: Update terminal key utilities**

In `terminal-session-utils.ts`, change functions to accept a scope object:

```ts
export type TerminalSessionScope =
  | { kind?: 'local'; repoRoot: string; worktreePath: string }
  | { kind: 'remote'; repoId: string; worktreePath: string }

export function terminalSessionGroupKey(scope: TerminalSessionScope): string {
  return scope.kind === 'remote'
    ? `remote\0${scope.repoId}\0${scope.worktreePath}`
    : `local\0${scope.repoRoot}\0${scope.worktreePath}`
}

export function terminalSessionKey(scope: TerminalSessionScope, terminalId: string): string {
  return `${terminalSessionGroupKey(scope)}\0${terminalId}`
}

export function terminalDescriptor(base: TerminalSessionBase, terminalId: string, index: number): TerminalDescriptor {
  if (base.kind === 'remote') {
    const scope = { kind: 'remote' as const, repoId: base.repoId, worktreePath: base.worktreePath }
    return {
      ...base,
      groupKey: terminalSessionGroupKey(scope),
      terminalId,
      index,
      key: terminalSessionKey(scope, terminalId),
    }
  }
  const scope = { kind: 'local' as const, repoRoot: base.repoRoot, worktreePath: base.worktreePath }
  return {
    ...base,
    kind: 'local',
    groupKey: terminalSessionGroupKey(scope),
    terminalId,
    index,
    key: terminalSessionKey(scope, terminalId),
  }
}

export function isTerminalDescriptorLive(repos: ReposStore['repos'], descriptor: TerminalDescriptor): boolean {
  const repoId = descriptor.kind === 'remote' ? descriptor.repoId : descriptor.repoRoot
  const repo = repos[repoId]
  return !!repo?.data.branches.some((branch) => branch.worktreePath === descriptor.worktreePath)
}
```

Update all callers from `terminalSessionGroupKey(repoRoot, worktreePath)` to object form.

- [ ] **Step 6: Send remote terminal payloads**

In `ManagedTerminalSession.ts`, update input builders:

```ts
private terminalOpenInput(term: XTermTerminal): TerminalOpenInput {
  if (this.descriptor.kind === 'remote') {
    return {
      kind: 'remote',
      target: this.descriptor.target,
      branch: this.descriptor.branch,
      worktreePath: this.descriptor.worktreePath,
      terminalId: this.descriptor.terminalId,
      cols: term.cols,
      rows: term.rows,
    }
  }
  return {
    kind: 'local',
    repoRoot: this.descriptor.repoRoot,
    branch: this.descriptor.branch,
    worktreePath: this.descriptor.worktreePath,
    terminalId: this.descriptor.terminalId,
    cols: term.cols,
    rows: term.rows,
  }
}
```

Make `terminalRestartInput` return `this.terminalOpenInput(term)`.

- [ ] **Step 7: Pass remote terminal base from branch detail**

In `TerminalSlot.tsx`, replace props with:

```ts
interface TerminalSlotProps {
  base: TerminalSessionBase
}
```

Compute:

```ts
const groupKey = terminalSessionGroupKey(
  base.kind === 'remote'
    ? { kind: 'remote', repoId: base.repoId, worktreePath: base.worktreePath }
    : { kind: 'local', repoRoot: base.repoRoot, worktreePath: base.worktreePath },
)
```

In `BranchDetailContent.tsx`, update `BranchTerminalTab`:

```tsx
function BranchTerminalTab({
  detailId,
  repo,
  branch,
}: {
  detailId: string
  repo: RepoState
  branch: BranchDetailBranch
}) {
  if (!branch.worktreePath) return null
  const base =
    repo.kind === 'remote' && repo.remoteTarget
      ? {
          kind: 'remote' as const,
          repoId: repo.id,
          target: repo.remoteTarget,
          branch: branch.name,
          worktreePath: branch.worktreePath,
        }
      : { kind: 'local' as const, repoRoot: repo.id, branch: branch.name, worktreePath: branch.worktreePath }
  return (
    <BranchTabPanel detailId={detailId} tabId="terminal">
      <TerminalSlot base={base} />
    </BranchTabPanel>
  )
}
```

Update caller from `<BranchTerminalTab detailId={detailId} repoId={repo.id} branch={branch} />` to `<BranchTerminalTab detailId={detailId} repo={repo} branch={branch} />`.

- [ ] **Step 8: Run renderer terminal tests and verify green**

Run:

```sh
bun run test "src/renderer/components/terminal/terminal-session-utils.test.ts" "src/renderer/components/terminal/ManagedTerminalSession.test.ts"
```

Expected: PASS.

## Task 8: Remote Toolbar And UI Visibility

**Files:**

- Modify: `src/renderer/components/repo-toolbar/RepoToolbarActions.tsx`
- Modify: `src/renderer/components/repo-sync/RepoSyncControl.tsx`
- Modify: `src/renderer/components/repo-sync/model.ts`
- Modify: `src/renderer/components/branch-detail/BranchDetailToolbar.tsx`
- Test: create `src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx`
- Test: modify `src/renderer/hooks/branch-action-state.test.ts`

- [ ] **Step 1: Write failing toolbar tests**

Create `src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { RepoToolbarActions } from '#/renderer/components/repo-toolbar/RepoToolbarActions.tsx'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

vi.mock('#/renderer/stores/repos/store.ts', () => ({
  useReposStore: (selector: any) =>
    selector({
      runBranchAction: vi.fn(),
      refreshRemoteDiagnostics: vi.fn(),
      syncAndRefresh: vi.fn(),
    }),
}))

describe('RepoToolbarActions', () => {
  test('shows refresh and new worktree for remote repositories', () => {
    const repo = emptyRepo('ssh://deploy@prod:22/srv/goblin', 'prod:goblin', {
      kind: 'remote',
      remoteTarget: {
        id: 'ssh://deploy@prod:22/srv/goblin',
        alias: null,
        host: 'prod',
        user: 'deploy',
        port: 22,
        remotePath: '/srv/goblin',
        displayName: 'prod:goblin',
      },
    })

    const html = renderToStaticMarkup(<RepoToolbarActions repo={repo} />)

    expect(html).toContain('action.refresh')
    expect(html).toContain('action.create-worktree')
    expect(html).toContain('action.retry')
  })
})
```

- [ ] **Step 2: Run toolbar tests and verify red**

Run:

```sh
bun run test "src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx"
```

Expected: FAIL because remote toolbar currently only shows retry diagnostics.

- [ ] **Step 3: Show remote refresh and create worktree**

In `RepoToolbarActions.tsx`, remove the remote early return that only shows retry. Render:

```tsx
<RepoSyncControl repo={repo} />
<Tip label={createTip}>
  <span className="inline-flex">
    <Button
      variant="ghost"
      onClick={() => {
        if (!branchActionBusy && repo.remoteTarget) setCreateOpen(true)
      }}
      disabled={branchActionBusy || (repo.kind === 'remote' && !repo.remoteTarget)}
      aria-label={createTip}
    >
      <FolderPlus />
      {t('action.create-worktree')}
    </Button>
  </span>
</Tip>
{repo.kind === 'remote' && (
  <Tip label={retryTip}>
    <span className="inline-flex">
      <Button
        variant="ghost"
        onClick={() => {
          if (!diagnosticsBusy) void refreshRemoteDiagnostics(repo.id, { token: repo.instanceToken })
        }}
        disabled={diagnosticsBusy}
        aria-label={retryTip}
      >
        <RefreshCw />
        {t('action.retry')}
      </Button>
    </span>
  </Tip>
)}
```

Keep the existing `CreateWorktreeDialog` for both local and remote repos.

- [ ] **Step 4: Allow remote sync control presentation**

In `repo-sync/model.ts`, make `isRepoSyncBlocked` call `canStartManualFetch` instead of `canStartRemoteFetch`:

```ts
import { canStartManualFetch } from '#/renderer/stores/repos/sync-state.ts'

export function isRepoSyncBlocked(repo: RepoState): boolean {
  return !canStartManualFetch(repo)
}
```

- [ ] **Step 5: Keep remote branch action bar hidden**

Keep `repoBranchActionsAvailable(repo)` unchanged:

```ts
export function repoBranchActionsAvailable(repo: RepoState): boolean {
  return repo.kind !== 'remote'
}
```

Verify `src/renderer/hooks/branch-action-state.test.ts` contains this assertion in `keeps local branch actions available and hides them for remote repos`:

```ts
expect(repoBranchActionsAvailable(remote)).toBe(false)
```

- [ ] **Step 6: Run UI tests and verify green**

Run:

```sh
bun run test "src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx" "src/renderer/hooks/branch-action-state.test.ts" "src/renderer/components/repo-sync/model.test.ts"
```

Expected: PASS.

## Task 9: Terminal Prune Workflow For Remote Repos

**Files:**

- Modify: `src/renderer/stores/repos/refresh-workflows.ts`
- Modify: `src/renderer/terminal.ts`
- Modify: `src/preload/preload.cjs`
- Test: `src/renderer/stores/repos/refresh.test.ts`

- [ ] **Step 1: Write failing remote prune test**

Add to `src/renderer/stores/repos/refresh.test.ts`:

```ts
test('remote snapshot refresh prunes remote terminal sessions to current remote worktree paths', async () => {
  const token = seedRemoteRepo()
  const pruneCalls: TerminalPruneRepoInput[] = []
  overrideTerminalBridge({
    pruneRepo: async (input) => {
      pruneCalls.push(input)
      return true
    },
  })
  rpcHandlers['remote.snapshot'] = async () => ({
    branches: [
      branch('main', undefined, { worktreePath: '/srv/goblin' }),
      branch('feature/x', undefined, { worktreePath: '/srv/goblin-feature-x' }),
    ],
    current: 'main',
  })

  await useReposStore.getState().refreshSnapshot(REMOTE_TARGET.id, { token })

  expect(pruneCalls).toEqual([
    {
      kind: 'remote',
      repoId: REMOTE_TARGET.id,
      worktreePaths: ['/srv/goblin', '/srv/goblin-feature-x'],
    },
  ])
})
```

- [ ] **Step 2: Run refresh tests and verify red**

Run:

```sh
bun run test "src/renderer/stores/repos/refresh.test.ts"
```

Expected: FAIL because prune currently sends local `{ repoRoot, worktreePaths }`.

- [ ] **Step 3: Send local/remote prune inputs from workflow**

In `runSnapshotSuccessWorkflow`, inspect repo kind:

```ts
const repo = get().repos[options.id]
const pruneInput =
  repo?.kind === 'remote'
    ? { kind: 'remote' as const, repoId: options.id, worktreePaths: options.worktreePaths }
    : { kind: 'local' as const, repoRoot: options.id, worktreePaths: options.worktreePaths }
void terminalBridge.pruneRepo(pruneInput).catch((err) => {
  console.warn('[terminal] failed to prune repo sessions', err)
})
```

No preload changes are needed if it forwards opaque input, but keep this task's file list because the type exposed through `Window['goblin']['terminal']` may require generated TypeScript awareness.

- [ ] **Step 4: Run refresh tests and verify green**

Run:

```sh
bun run test "src/renderer/stores/repos/refresh.test.ts"
```

Expected: PASS.

## Task 10: Final Typecheck And Focused Regression Suite

**Files:**

- Verification only.

- [ ] **Step 1: Run focused tests**

Run:

```sh
bun run test \
  "src/main/ssh/commands.test.ts" \
  "src/main/ssh/git.test.ts" \
  "src/main/rpc.test.ts" \
  "src/main/terminal.test.ts" \
  "src/main/terminal-core.test.ts" \
  "src/renderer/stores/repos/refresh.test.ts" \
  "src/renderer/stores/repos/branch-actions.test.ts" \
  "src/renderer/components/CreateWorktreeDialog.test.tsx" \
  "src/renderer/components/repo-toolbar/RepoToolbarActions.test.tsx" \
  "src/renderer/components/terminal/terminal-session-utils.test.ts" \
  "src/renderer/components/terminal/ManagedTerminalSession.test.ts"
```

Expected: PASS.

- [ ] **Step 2: Run full unit tests**

Run:

```sh
bun run test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```sh
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Manual smoke test in dev app**

Run:

```sh
bun run dev
```

Expected: Vite and Electron start. In the app:

- Add/open a remote SSH repository.
- Click Refresh and confirm it fetches without background remote fetch.
- Create a new remote worktree from a remote branch.
- Select the new worktree branch and open Terminal tab.
- Confirm the terminal opens in the remote worktree directory.
- Confirm branch action buttons remain hidden for remote repos.

Stop the dev server after the smoke test.

## Self-Review

Spec coverage:

- Manual remote refresh is covered by Tasks 3, 4, 8, and 10.
- Remote snapshot/status/log are covered by Tasks 1 through 4.
- Remote worktree creation is covered by Tasks 3, 5, and 8.
- Embedded remote terminal is covered by Tasks 1, 6, 7, and 9.
- UI boundaries and hidden dangerous actions are covered by Tasks 5 and 8.
- Background remote fetch remains skipped in Task 4.
- Safety boundaries are covered by command builder tests, RPC validation, terminal validation, and keeping destructive actions out of scope.

Red flag scan: no incomplete sections are intentionally left for implementers.

Type consistency:

- Remote RPC names are `remote.fetch`, `remote.status`, `remote.log`, and `remote.createWorktree`.
- Terminal remote descriptors use `kind: 'remote'`, `repoId`, `target`, `branch`, and `worktreePath`.
- Terminal local descriptors use `kind: 'local'`, `repoRoot`, `branch`, and `worktreePath`.
- Remote prune input uses `{ kind: 'remote', repoId, worktreePaths }`; local prune input uses `{ kind: 'local', repoRoot, worktreePaths }`.
