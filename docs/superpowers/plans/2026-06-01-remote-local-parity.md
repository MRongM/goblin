# Remote Local Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SSH remote commit detail support and upstream deletion parity with local repositories.

**Architecture:** Reuse the existing local commit detail UI and branch action state model. Add typed remote RPC endpoints that route to whitelisted SSH Git commands in `src/main/ssh/commands.ts`, with parsing and safety checks contained in `src/main/ssh/git.ts`.

**Tech Stack:** TypeScript, Electron main/renderer split, tRPC, Zustand, Vitest, Bun.

**Commit Policy:** Do not commit unless the user explicitly asks. The project instructions override the generic planning-skill habit of frequent commits.

---

## File Map

- Modify `src/main/ssh/commands.ts`: add whitelisted remote Git commands for commit metadata, commit file stats, and upstream branch deletion.
- Modify `src/main/ssh/commands.test.ts`: verify exact shell scripts for the new commands.
- Modify `src/main/ssh/git.ts`: add `getRemoteCommitDetail`, parse remote commit data, and add upstream deletion support to `deleteRemoteBranch` and `removeRemoteWorktree`.
- Modify `src/main/ssh/git.test.ts`: cover remote commit parsing and upstream deletion ordering/guards.
- Modify `src/shared/rpc.ts`: expose `remote.commit` and extend remote destructive action schemas with `alsoDeleteUpstream`.
- Modify `src/main/rpc.ts`: route `remote.commit`, pass `alsoDeleteUpstream`, and validate commit hashes.
- Modify `src/main/rpc.test.ts`: cover typed RPC routing and input validation.
- Modify `src/renderer/stores/repos/commit.ts`: dispatch `openCommit` by repo kind instead of blocking remote repos.
- Modify `src/renderer/stores/repos/selection.test.ts`: cover remote commit opening behavior.
- Modify `src/renderer/stores/repos/branch-actions.ts`: forward `alsoDeleteUpstream` through remote delete/remove actions.
- Modify `src/renderer/stores/repos/branch-actions.test.ts`: cover remote upstream option forwarding.

## Task 1: SSH Command Surface For Remote Commit And Upstream Delete

**Files:**
- Modify: `src/main/ssh/commands.ts`
- Test: `src/main/ssh/commands.test.ts`

- [ ] **Step 1: Add failing command-builder tests**

Append to `src/main/ssh/commands.test.ts` inside `describe('remote ssh command runner', ...)`:

```ts
  test('builds remote commit detail commands with quoted hashes and paths', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const meta = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitCommitMeta',
      path: "/srv/team's app",
      hash: 'abc123',
    })
    const files = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitCommitFileStats',
      path: "/srv/team's app",
      hash: 'abc123',
    })

    expect(meta.script).toBe(
      "git -C '/srv/team'\\''s app' show --no-patch --format='%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%s%x1f%b' 'abc123'",
    )
    expect(files.script).toBe("git -C '/srv/team'\\''s app' show --numstat --no-renames --format= -z 'abc123'")
  })

  test('builds remote upstream delete command with quoted remote and branch', async () => {
    const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

    const invocation = buildRemoteCommandInvocation(MANUAL_TARGET, {
      type: 'gitPushDelete',
      path: '/srv/goblin',
      remote: "origin's",
      branch: "feature/quote's",
    })

    expect(invocation.script).toBe(
      "git -C '/srv/goblin' push --delete -- 'origin'\\''s' 'feature/quote'\\''s'",
    )
  })
```

- [ ] **Step 2: Run command-builder tests and verify failure**

Run:

```bash
bun run test src/main/ssh/commands.test.ts
```

Expected: FAIL because `gitCommitMeta`, `gitCommitFileStats`, and `gitPushDelete` are not in `RemoteCommandKind`.

- [ ] **Step 3: Implement the new whitelisted commands**

In `src/main/ssh/commands.ts`, extend `RemoteCommandKind`:

```ts
  | { type: 'gitCommitMeta'; path: string; hash: string }
  | { type: 'gitCommitFileStats'; path: string; hash: string }
  | { type: 'gitPushDelete'; path: string; remote: string; branch: string }
```

Add cases to `scriptForCommand`:

```ts
    case 'gitCommitMeta':
      return [
        `git -C ${shellQuote(command.path)} show`,
        '--no-patch',
        `--format=${shellQuote('%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%s%x1f%b')}`,
        shellQuote(command.hash),
      ].join(' ')
    case 'gitCommitFileStats':
      return `git -C ${shellQuote(command.path)} show --numstat --no-renames --format= -z ${shellQuote(command.hash)}`
    case 'gitPushDelete':
      return `git -C ${shellQuote(command.path)} push --delete -- ${shellQuote(command.remote)} ${shellQuote(
        command.branch,
      )}`
```

- [ ] **Step 4: Run command-builder tests and verify pass**

Run:

```bash
bun run test src/main/ssh/commands.test.ts
```

Expected: PASS.

## Task 2: Remote Commit Detail In SSH Git Helper

**Files:**
- Modify: `src/main/ssh/git.ts`
- Test: `src/main/ssh/git.test.ts`

- [ ] **Step 1: Add failing tests for remote commit detail**

Add after the remote log tests in `src/main/ssh/git.test.ts`:

```ts
describe('remote git commit detail', () => {
  test('reads remote commit metadata and file stats', async () => {
    const { getRemoteCommitDetail } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async (command) => {
      if (command.type === 'gitCommitMeta') {
        return {
          ok: true,
          stderr: '',
          stdout: ['abc123', 'abc123', 'Ada', 'ada@example.com', '2026-05-28T10:00:00Z', 'parent1 parent2', 'Subject', 'Body'].join(
            '\x1f',
          ),
        }
      }
      if (command.type === 'gitCommitFileStats') {
        return { ok: true, stderr: '', stdout: '1\t2\tsrc/app.ts\0-\t-\tassets/logo.png\0' }
      }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(getRemoteCommitDetail(TARGET, 'abc123', { run })).resolves.toEqual({
      meta: {
        hash: 'abc123',
        shortHash: 'abc123',
        subject: 'Subject',
        body: 'Body',
        author: 'Ada',
        email: 'ada@example.com',
        date: '2026-05-28T10:00:00Z',
        parents: ['parent1', 'parent2'],
      },
      files: [
        { added: 1, deleted: 2, path: 'src/app.ts', binary: false },
        { added: 0, deleted: 0, path: 'assets/logo.png', binary: true },
      ],
    })
    expect(run).toHaveBeenCalledWith({ type: 'gitCommitMeta', path: '/srv/goblin', hash: 'abc123' }, TARGET, {
      signal: undefined,
      timeoutMs: 90_000,
    })
    expect(run).toHaveBeenCalledWith({ type: 'gitCommitFileStats', path: '/srv/goblin', hash: 'abc123' }, TARGET, {
      signal: undefined,
      timeoutMs: 90_000,
    })
  })

  test('returns null when remote commit metadata cannot be read', async () => {
    const { getRemoteCommitDetail } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async () => ({ ok: false, stderr: 'bad revision', stdout: '', message: 'bad revision' }))

    await expect(getRemoteCommitDetail(TARGET, 'missing', { run })).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run remote git helper tests and verify failure**

Run:

```bash
bun run test src/main/ssh/git.test.ts
```

Expected: FAIL because `getRemoteCommitDetail` does not exist.

- [ ] **Step 3: Implement remote commit parsing**

In `src/main/ssh/git.ts`, import the commit type:

```ts
import type { CommitDetail, CommitFileStat, CommitMeta } from '#/shared/rpc.ts'
```

Add a timeout near the existing constants:

```ts
const REMOTE_COMMIT_TIMEOUT_MS = 90_000
```

Add the exported helper:

```ts
export async function getRemoteCommitDetail(
  target: RemoteRepoTarget,
  hash: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<CommitDetail | null> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const [metaResult, fileResult] = await Promise.all([
    run({ type: 'gitCommitMeta', path: target.remotePath, hash }, target, {
      signal: options.signal,
      timeoutMs: REMOTE_COMMIT_TIMEOUT_MS,
    }),
    run({ type: 'gitCommitFileStats', path: target.remotePath, hash }, target, {
      signal: options.signal,
      timeoutMs: REMOTE_COMMIT_TIMEOUT_MS,
    }),
  ])
  if (options.signal?.aborted) return null
  if (!metaResult.ok) return null
  const meta = parseRemoteCommitMeta(metaResult.stdout)
  if (!meta) return null
  return { meta, files: fileResult.ok ? parseRemoteCommitFileStats(fileResult.stdout) : [] }
}
```

Add private parsers near other parse helpers:

```ts
function parseRemoteCommitMeta(output: string): CommitMeta | null {
  const parts = output.split('\x1f')
  const hash = parts[0] ?? ''
  if (!hash) return null
  return {
    hash,
    shortHash: parts[1] ?? '',
    author: parts[2] ?? '',
    email: parts[3] ?? '',
    date: parts[4] ?? '',
    parents: (parts[5] ?? '').split(' ').filter(Boolean),
    subject: parts[6] ?? '',
    body: (parts[7] ?? '').trimEnd(),
  }
}

function parseRemoteCommitFileStats(output: string): CommitFileStat[] {
  if (!output) return []
  return output
    .split('\0')
    .filter((record) => record.length > 0)
    .map((record) => {
      const cols = record.split('\t')
      const added = cols[0] ?? '0'
      const deleted = cols[1] ?? '0'
      const filePath = cols.slice(2).join('\t')
      const binary = added === '-' || deleted === '-'
      return {
        added: binary ? 0 : parseInt(added, 10) || 0,
        deleted: binary ? 0 : parseInt(deleted, 10) || 0,
        path: filePath,
        binary,
      }
    })
}
```

- [ ] **Step 4: Run remote git helper tests and verify pass**

Run:

```bash
bun run test src/main/ssh/git.test.ts
```

Expected: PASS.

## Task 3: Remote Commit RPC And Renderer Open Flow

**Files:**
- Modify: `src/shared/rpc.ts`
- Modify: `src/main/rpc.ts`
- Modify: `src/main/rpc.test.ts`
- Modify: `src/renderer/stores/repos/commit.ts`
- Test: `src/renderer/stores/repos/selection.test.ts`

- [ ] **Step 1: Add failing RPC and renderer tests**

In `src/main/rpc.test.ts`, add `getRemoteCommitDetail` to the existing SSH Git import and mock:

```ts
  getRemoteCommitDetail,
```

```ts
  getRemoteCommitDetail: vi.fn(() => ({
    meta: {
      hash: 'abc123',
      shortHash: 'abc123',
      subject: 'Subject',
      body: '',
      author: 'Ada',
      email: 'ada@example.com',
      date: '2026-05-28T10:00:00Z',
      parents: [],
    },
    files: [],
  })),
```

Add this test near the read-only remote procedure tests:

```ts
  test('exposes typed remote commit detail procedure', async () => {
    await expect(invokeRpc('remote.commit', { target: REMOTE_TARGET, hash: 'abc123' })).resolves.toEqual({
      ok: true,
      data: {
        meta: {
          hash: 'abc123',
          shortHash: 'abc123',
          subject: 'Subject',
          body: '',
          author: 'Ada',
          email: 'ada@example.com',
          date: '2026-05-28T10:00:00Z',
          parents: [],
        },
        files: [],
      },
    })
    expect(getRemoteCommitDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: REMOTE_TARGET.id }),
      'abc123',
      { signal: undefined },
    )
  })
```

In `src/renderer/stores/repos/selection.test.ts`, add a remote commit test in `describe('commit detail collapse behavior', ...)`:

```ts
  test('opening a remote commit uses the remote commit RPC', async () => {
    const remoteId = 'ssh://deploy@prod:22/srv/goblin'
    const target = {
      id: remoteId,
      alias: null,
      host: 'prod',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/goblin',
      displayName: 'prod:goblin',
    }
    const remoteRepo = emptyRepo(remoteId, 'prod:goblin', { kind: 'remote', remoteTarget: target })
    useReposStore.setState({
      repos: { [remoteId]: remoteRepo },
      order: [remoteId],
      activeId: remoteId,
      sessionReady: true,
    })
    rpcHandlers['remote.commit'] = async ({ hash }: { hash: string }) => createCommitDetail(hash)

    await useReposStore.getState().openCommit(remoteId, 'abc123')

    const commitDetail = useReposStore.getState().repos[remoteId]?.ui.commitDetail
    expect(commitDetail?.phase).toBe('open')
    expect(commitDetail?.phase === 'open' ? commitDetail.detail.meta.hash : null).toBe('abc123')
  })
```

If `emptyRepo` is not already imported in that file, add:

```ts
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
```

- [ ] **Step 2: Run targeted tests and verify failure**

Run:

```bash
bun run test src/main/rpc.test.ts src/renderer/stores/repos/selection.test.ts
```

Expected: FAIL because `remote.commit` is missing and renderer `openCommit` still returns for remote repos.

- [ ] **Step 3: Extend shared RPC contract**

In `src/shared/rpc.ts`, add to `AppRpcHandlers['remote']`:

```ts
    commit: (input: { target: RemoteRepoTarget; hash: string }) => Promise<CommitDetail | null>
```

In `createAppRouter`, add to `remote: t.router({ ... })`:

```ts
      commit: p
        .input(v.object({ target: RemoteTargetSchema, hash: v.string() }))
        .query(({ input }) => handlers.remote.commit(input)),
```

- [ ] **Step 4: Route remote commit in main RPC**

In `src/main/rpc.ts`, import `getRemoteCommitDetail` from `#/main/ssh/git.ts`.

Add to the remote handlers:

```ts
      commit: async ({ target, hash }) => {
        if (typeof hash !== 'string' || !hash || !GIT_HASH_RE.test(hash)) return null
        return getRemoteCommitDetail(normalizedRemoteTargetOrThrow(target), hash, { signal: currentRpcSignal() })
      },
```

- [ ] **Step 5: Route renderer openCommit by repo kind**

In `src/renderer/stores/repos/commit.ts`, replace the early remote return:

```ts
      if (repoBefore.kind === 'remote') return
```

with:

```ts
      if (repoBefore.kind === 'remote' && !repoBefore.remoteTarget) return
```

Replace the local-only RPC call:

```ts
        const detail = await rpc.repo.commit.query({ cwd: id, hash })
```

with:

```ts
        const detail =
          repoBefore.kind === 'remote'
            ? await rpc.remote.commit.query({ target: repoBefore.remoteTarget!, hash })
            : await rpc.repo.commit.query({ cwd: id, hash })
```

- [ ] **Step 6: Run targeted tests and verify pass**

Run:

```bash
bun run test src/main/rpc.test.ts src/renderer/stores/repos/selection.test.ts
```

Expected: PASS.

## Task 4: Remote Upstream Delete Parity

**Files:**
- Modify: `src/shared/rpc.ts`
- Modify: `src/main/rpc.ts`
- Modify: `src/main/ssh/git.ts`
- Test: `src/main/ssh/git.test.ts`
- Test: `src/main/rpc.test.ts`
- Modify: `src/renderer/stores/repos/branch-actions.ts`
- Test: `src/renderer/stores/repos/branch-actions.test.ts`

- [ ] **Step 1: Add failing SSH Git tests for upstream deletion**

In `src/main/ssh/git.test.ts`, add tests inside `describe('remote git branch actions', ...)`:

```ts
  test('deletes remote upstream after deleting a remote branch when requested', async () => {
    const { deleteRemoteBranch } = await import('#/main/ssh/git.ts')
    const calls: string[] = []
    const run = vi.fn(async (command) => {
      calls.push(command.type)
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
            ['feature/x', 'def5678', 'feature work', '2026-05-28T11:00:00Z', 'Lin', 'origin/feature/x', ''].join(
              FIELD_SEP,
            ),
          ].join('\n'),
        }
      }
      if (command.type === 'gitUpstream') return { ok: true, stderr: '', stdout: 'origin/feature/x' }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(deleteRemoteBranch(TARGET, { branch: 'feature/x', alsoDeleteUpstream: true, run })).resolves.toEqual({
      ok: true,
      message: 'ok',
    })
    expect(calls).toEqual([
      'gitSnapshot',
      'gitWorktreeList',
      'gitUpstream',
      'gitIsAncestor',
      'gitUpstream',
      'gitBranchDelete',
      'gitPushDelete',
    ])
  })

  test('skips remote upstream delete for dot upstreams and missing upstreams', async () => {
    const { deleteRemoteBranch } = await import('#/main/ssh/git.ts')
    const run = vi.fn(async (command) => {
      if (command.type === 'gitSnapshot') {
        return { ok: true, stderr: '', stdout: ['__GOBLIN_REMOTE_BRANCHES__'].join('\n') }
      }
      if (command.type === 'gitUpstream') return { ok: true, stderr: '', stdout: './feature/x' }
      return { ok: true, stderr: '', stdout: '' }
    })

    await expect(deleteRemoteBranch(TARGET, { branch: 'feature/x', force: true, alsoDeleteUpstream: true, run })).resolves.toEqual({
      ok: true,
      message: 'ok',
    })
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitPushDelete' }), TARGET, expect.anything())
  })
```

- [ ] **Step 2: Add failing renderer forwarding test**

In `src/renderer/stores/repos/branch-actions.test.ts`, update the existing remote remove worktree test to record full input:

```ts
  test('routes remote remove worktree through remote RPC with upstream deletion option', async () => {
    seedRemoteRepo()
    const calls: unknown[] = []
    installGoblinTestBridge({
      'remote.removeWorktree': async (input: unknown) => {
        calls.push(input)
        return { ok: true, message: 'ok' }
      },
      'remote.snapshot': async () => ({ branches: [], current: '' }),
      'remote.status': async () => [],
    })

    const result = await useReposStore.getState().runBranchAction(REMOTE_TARGET.id, {
      kind: 'removeWorktree',
      branch: 'feature/x',
      worktreePath: '/srv/goblin-feature-x',
      alsoDeleteBranch: true,
      forceDeleteBranch: false,
      alsoDeleteUpstream: true,
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(calls).toEqual([
      {
        target: REMOTE_TARGET,
        branch: 'feature/x',
        worktreePath: '/srv/goblin-feature-x',
        alsoDeleteBranch: true,
        forceDeleteBranch: false,
        alsoDeleteUpstream: true,
      },
    ])
  })
```

Add a remote delete branch forwarding test:

```ts
  test('routes remote delete branch through remote RPC with upstream deletion option', async () => {
    seedRemoteRepo()
    const calls: unknown[] = []
    installGoblinTestBridge({
      'remote.deleteBranch': async (input: unknown) => {
        calls.push(input)
        return { ok: true, message: 'ok' }
      },
      'remote.snapshot': async () => ({ branches: [], current: '' }),
      'remote.status': async () => [],
    })

    const result = await useReposStore.getState().runBranchAction(REMOTE_TARGET.id, {
      kind: 'deleteBranch',
      branch: 'feature/x',
      force: false,
      alsoDeleteUpstream: true,
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(calls).toEqual([
      {
        target: REMOTE_TARGET,
        branch: 'feature/x',
        force: false,
        alsoDeleteUpstream: true,
      },
    ])
  })
```

- [ ] **Step 3: Run targeted tests and verify failure**

Run:

```bash
bun run test src/main/ssh/git.test.ts src/renderer/stores/repos/branch-actions.test.ts
```

Expected: FAIL because remote upstream deletion and option forwarding are not implemented.

- [ ] **Step 4: Extend shared RPC schemas**

In `src/shared/rpc.ts`, update remote handler signatures:

```ts
    removeWorktree: (input: {
      target: RemoteRepoTarget
      branch: string
      worktreePath: string
      alsoDeleteBranch: boolean
      forceDeleteBranch?: boolean
      alsoDeleteUpstream?: boolean
    }) => Promise<ExecResult>
    deleteBranch: (input: { target: RemoteRepoTarget; branch: string; force?: boolean; alsoDeleteUpstream?: boolean }) => Promise<ExecResult>
```

Update router input objects:

```ts
          alsoDeleteUpstream: v.optional(v.boolean()),
```

for both `remote.removeWorktree` and `remote.deleteBranch`.

- [ ] **Step 5: Forward upstream options from renderer and main RPC**

In `src/renderer/stores/repos/branch-actions.ts`, update remote cases:

```ts
      case 'deleteBranch':
        return rpc.remote.deleteBranch.mutate(
          {
            target: repo.remoteTarget,
            branch: action.branch,
            force: action.force,
            alsoDeleteUpstream: action.alsoDeleteUpstream,
          },
          { signal },
        )
      case 'removeWorktree':
        return rpc.remote.removeWorktree.mutate(
          {
            target: repo.remoteTarget,
            branch: action.branch,
            worktreePath: action.worktreePath,
            alsoDeleteBranch: action.alsoDeleteBranch,
            forceDeleteBranch: action.forceDeleteBranch,
            alsoDeleteUpstream: action.alsoDeleteUpstream,
          },
          { signal },
        )
```

In `src/main/rpc.ts`, update validation for `remote.removeWorktree`:

```ts
          (input.alsoDeleteUpstream !== undefined && typeof input.alsoDeleteUpstream !== 'boolean')
```

Forward `alsoDeleteUpstream` through existing `remoteInput`.

Update `remote.deleteBranch`:

```ts
      deleteBranch: async ({ target, branch, force, alsoDeleteUpstream }) => {
        if (!isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
        const normalized = normalizedRemoteTargetOrThrow(target)
        return runCancellable(normalized.id, 'user', (signal) =>
          deleteRemoteBranch(normalized, { branch, force, alsoDeleteUpstream, signal }),
        )
      },
```

- [ ] **Step 6: Implement upstream deletion in SSH Git helper**

In `src/main/ssh/git.ts`, update input types:

```ts
    alsoDeleteUpstream?: boolean
```

for `removeRemoteWorktree`, and:

```ts
  input: { branch: string; force?: boolean; alsoDeleteUpstream?: boolean; signal?: AbortSignal; run?: RemoteGitRunner },
```

for `deleteRemoteBranch`.

Add helpers. The upstream must be read before `gitBranchDelete` because deleting a local branch can remove the branch config that stores `branch.<name>.remote` and `branch.<name>.merge`.

```ts
async function resolveRemoteUpstreamForDelete(
  target: RemoteRepoTarget,
  branch: string,
  input: { enabled?: boolean; signal?: AbortSignal; run: RemoteGitRunner },
): Promise<string | ExecResult | null> {
  if (!input.enabled) return null
  const upstream = await getRemoteUpstream(target, branch, input)
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  return upstream
}

async function deleteResolvedRemoteUpstreamBranch(
  target: RemoteRepoTarget,
  upstream: string | null,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<ExecResult> {
  if (!upstream) return { ok: true, message: 'ok' }
  const parts = splitUpstream(upstream)
  if (!parts || parts.remote === '.') return { ok: true, message: 'ok' }
  const result = await options.run(
    { type: 'gitPushDelete', path: target.remotePath, remote: parts.remote, branch: parts.branch },
    target,
    { signal: options.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  if (!result.ok) return { ok: false, message: 'error.upstream-delete-failed' }
  return remoteExecResult(result)
}
```

Before deleting the server-local branch, resolve upstream only when requested, and after local branch deletion succeeds, call the helper:

```ts
  const shouldDeleteUpstream = input.alsoDeleteUpstream === true
```

Before `gitBranchDelete` in `deleteRemoteBranch`, resolve the upstream:

```ts
  const upstream = await resolveRemoteUpstreamForDelete(target, input.branch, {
    enabled: input.alsoDeleteUpstream === true,
    signal: input.signal,
    run,
  })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (upstream && typeof upstream === 'object' && 'ok' in upstream) return upstream
```

After `gitBranchDelete` succeeds:

```ts
  if (!input.alsoDeleteUpstream) return remoteExecResult(result)
  return deleteResolvedRemoteUpstreamBranch(target, upstream, { signal: input.signal, run })
```

Before `gitBranchDelete` in `removeRemoteWorktree`, resolve the upstream after worktree safety checks and before `gitWorktreeRemove`:

```ts
  const upstream = await resolveRemoteUpstreamForDelete(target, input.branch, {
    enabled: input.alsoDeleteBranch && input.alsoDeleteUpstream === true,
    signal: input.signal,
    run,
  })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (upstream && typeof upstream === 'object' && 'ok' in upstream) return upstream
```

For `removeRemoteWorktree`, after branch deletion succeeds:

```ts
  if (!input.alsoDeleteUpstream) return remoteExecResult(deleteResult)
  return deleteResolvedRemoteUpstreamBranch(target, upstream, { signal: input.signal, run })
```

- [ ] **Step 7: Add main RPC expectation for forwarded upstream flag**

In `src/main/rpc.test.ts`, update the remote delete test call:

```ts
invokeRpc('remote.deleteBranch', { target: REMOTE_TARGET, branch: 'feature/x', force: false, alsoDeleteUpstream: true })
```

and expectation:

```ts
expect.objectContaining({
  branch: 'feature/x',
  force: false,
  alsoDeleteUpstream: true,
  signal: expect.any(AbortSignal),
})
```

- [ ] **Step 8: Run targeted tests and verify pass**

Run:

```bash
bun run test src/main/ssh/git.test.ts src/main/rpc.test.ts src/renderer/stores/repos/branch-actions.test.ts
```

Expected: PASS.

## Task 5: Full Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run all tests**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript verification**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected: only the planned source, test, spec, and plan files are changed.

- [ ] **Step 4: Manual behavior check**

Open an SSH remote repo in the app and verify:

- Clicking a commit in the log opens the existing commit detail panel.
- Deleting a remote branch with the upstream checkbox selected deletes the server-local branch and attempts upstream deletion.
- Removing a remote worktree with branch/upstream checkboxes selected removes the worktree, deletes the server-local branch, and attempts upstream deletion.
- Local repository commit detail and delete flows still behave as before.
