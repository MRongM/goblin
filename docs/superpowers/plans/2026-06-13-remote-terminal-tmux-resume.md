# Remote Terminal Tmux Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Goblin-managed remote terminals support multiple independent tmux sessions per worktree, while external remote terminal actions remain plain SSH.

**Architecture:** Split remote terminal command construction into managed and external builders in `src/system/remote-terminal.ts`. Managed terminal sessions use deterministic tmux names based on `user@host:port`, repo path, worktree path, and numeric terminal number. External terminal backends use a plain SSH login-shell invocation and never include tmux.

**Tech Stack:** TypeScript in Node strip-only mode, Bun, Vitest, node-pty, execa, existing SSH config remote repository model.

**Project Constraint:** This plan intentionally has no git commit steps because `AGENTS.md` says not to plan or execute git commits unless the user explicitly asks.

---

## File Structure

- Modify `src/system/remote-terminal.ts`: own managed and external SSH invocation builders, shell quoting, endpoint-based tmux session naming, and validation.
- Modify `src/system/remote-terminal.test.ts`: cover `user@host:port` identity, numeric terminal numbers, alias rename stability, managed tmux script, external plain SSH script, and unsafe input rejection.
- Modify `src/system/apple-terminal.ts`: use the external plain-SSH builder for macOS Terminal remote opens.
- Modify `src/system/apple-terminal.test.ts`: assert remote Terminal.app opens a plain SSH command without tmux.
- Modify `src/system/ghostty.ts`: use the external plain-SSH builder for Ghostty remote opens.
- Modify `src/system/ghostty.test.ts`: assert running and cold-start Ghostty remote opens use plain SSH without tmux.
- Modify `src/system/terminals.ts`: make terminal backends accept an external remote target without repo path.
- Modify `src/system/terminals.test.ts`: verify remote terminal dispatch passes only alias and worktree path to external terminal backends.
- Modify `src/server/modules/remote.ts`: call `openRemoteInPreferredTerminal(alias, worktreePath, pref)` for external terminal opens.
- Modify `src/server/modules/remote.test.ts`: verify the server no longer forwards repo path to the external terminal opener.
- Modify `src/system/ssh/commands.ts`: adapt Goblin-managed terminal command construction to call the managed tmux builder with a numeric terminal number.
- Modify `src/system/ssh/commands.test.ts`: verify managed SSH adapter uses `user@host:port` and terminal number for tmux identity.
- Modify `src/server/terminal/terminal-catalog.ts`: reuse the smallest missing terminal id, parse terminal number, and pass it to the managed adapter.
- Modify `src/server/terminal/terminal.test.ts`: cover remote terminal command creation and smallest-missing terminal id reuse.

## Task 1: Split Remote Terminal Builders

**Files:**
- Modify: `src/system/remote-terminal.ts`
- Modify: `src/system/remote-terminal.test.ts`

- [ ] **Step 1: Replace remote terminal tests with managed and external expectations**

Use this content for `src/system/remote-terminal.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  buildExternalRemoteTerminalInvocation,
  buildManagedRemoteTerminalInvocation,
  buildManagedRemoteTerminalSessionName,
} from '#/system/remote-terminal.ts'

const BASE_MANAGED_TARGET = {
  alias: 'prod',
  endpoint: { user: 'alice', host: '192.168.1.20', port: 22 },
  repoPath: '/srv/repo',
  worktreePath: '/srv/repo-feature',
  terminalNumber: 1,
}

describe('buildManagedRemoteTerminalSessionName', () => {
  test('is stable for the same resolved endpoint, repo path, worktree path, and terminal number', () => {
    expect(buildManagedRemoteTerminalSessionName(BASE_MANAGED_TARGET)).toBe(
      buildManagedRemoteTerminalSessionName(BASE_MANAGED_TARGET),
    )
  })

  test('does not change when only the ssh alias changes', () => {
    const renamedAlias = { ...BASE_MANAGED_TARGET, alias: 'renamed-prod' }

    expect(buildManagedRemoteTerminalSessionName(renamedAlias)).toBe(
      buildManagedRemoteTerminalSessionName(BASE_MANAGED_TARGET),
    )
  })

  test('changes when endpoint, paths, or terminal number change', () => {
    const base = buildManagedRemoteTerminalSessionName(BASE_MANAGED_TARGET)

    expect(
      buildManagedRemoteTerminalSessionName({
        ...BASE_MANAGED_TARGET,
        endpoint: { user: 'bob', host: '192.168.1.20', port: 22 },
      }),
    ).not.toBe(base)
    expect(
      buildManagedRemoteTerminalSessionName({
        ...BASE_MANAGED_TARGET,
        endpoint: { user: 'alice', host: '192.168.1.21', port: 22 },
      }),
    ).not.toBe(base)
    expect(
      buildManagedRemoteTerminalSessionName({
        ...BASE_MANAGED_TARGET,
        endpoint: { user: 'alice', host: '192.168.1.20', port: 2222 },
      }),
    ).not.toBe(base)
    expect(buildManagedRemoteTerminalSessionName({ ...BASE_MANAGED_TARGET, repoPath: '/srv/other' })).not.toBe(base)
    expect(buildManagedRemoteTerminalSessionName({ ...BASE_MANAGED_TARGET, worktreePath: '/srv/repo-other' })).not.toBe(base)
    expect(buildManagedRemoteTerminalSessionName({ ...BASE_MANAGED_TARGET, terminalNumber: 2 })).not.toBe(base)
  })

  test('returns a short tmux-safe session name', () => {
    expect(
      buildManagedRemoteTerminalSessionName({
        alias: 'prod',
        endpoint: { user: 'alice', host: 'dev.example.com', port: 2222 },
        repoPath: '/srv/repo with spaces',
        worktreePath: "/srv/repo's-feature",
        terminalNumber: 3,
      }),
    ).toMatch(/^goblin-[a-f0-9]{24}$/)
  })
})

describe('buildManagedRemoteTerminalInvocation', () => {
  test('builds a tmux-first ssh invocation with native shell fallback', () => {
    const invocation = buildManagedRemoteTerminalInvocation(BASE_MANAGED_TARGET)

    expect(invocation).not.toBeNull()
    expect(invocation?.command).toBe('ssh')
    expect(invocation?.args).toEqual(['-tt', '--', 'prod', expect.stringContaining('sh -lc')])
    expect(invocation?.script).toContain("cd '/srv/repo-feature' || exit")
    expect(invocation?.script).toContain('command -v tmux >/dev/null 2>&1')
    expect(invocation?.script).toContain("exec tmux new-session -A -s 'goblin-")
    expect(invocation?.script).toContain("-c '/srv/repo-feature'")
    expect(invocation?.script).toContain('exec "${SHELL:-/bin/sh}" -l')
    expect(invocation?.shellCommand).toContain('ssh')
    expect(invocation?.shellCommand).toContain('prod')
    expect(invocation?.shellCommand).toContain('tmux')
  })

  test('shell-quotes remote paths that contain single quotes', () => {
    const invocation = buildManagedRemoteTerminalInvocation({
      ...BASE_MANAGED_TARGET,
      worktreePath: "/srv/repo's-feature",
    })

    expect(invocation).not.toBeNull()
    expect(invocation?.script).toContain("cd '/srv/repo'\\''s-feature' || exit")
    expect(invocation?.script).toContain("-c '/srv/repo'\\''s-feature'")
  })

  test('keeps non-ascii paths as quoted shell data', () => {
    const invocation = buildManagedRemoteTerminalInvocation({
      ...BASE_MANAGED_TARGET,
      repoPath: '/srv/项目',
      worktreePath: '/srv/项目/功能',
    })

    expect(invocation?.script).toContain("cd '/srv/项目/功能' || exit")
  })

  test('rejects unsafe managed target input', () => {
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, alias: 'bad alias' })).toBeNull()
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, repoPath: 'relative/repo' })).toBeNull()
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, worktreePath: 'relative/repo' })).toBeNull()
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, worktreePath: '/srv/\u0000repo' })).toBeNull()
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, endpoint: { user: '', host: 'host', port: 22 } })).toBeNull()
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, endpoint: { user: 'alice', host: '', port: 22 } })).toBeNull()
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, endpoint: { user: 'alice', host: 'host', port: 0 } })).toBeNull()
    expect(buildManagedRemoteTerminalInvocation({ ...BASE_MANAGED_TARGET, terminalNumber: 0 })).toBeNull()
  })
})

describe('buildExternalRemoteTerminalInvocation', () => {
  test('builds a plain ssh login-shell invocation without tmux', () => {
    const invocation = buildExternalRemoteTerminalInvocation({
      alias: 'prod',
      worktreePath: '/srv/repo-feature',
    })

    expect(invocation).not.toBeNull()
    expect(invocation?.command).toBe('ssh')
    expect(invocation?.args).toEqual(['-tt', '--', 'prod', expect.stringContaining('sh -lc')])
    expect(invocation?.script).toContain("cd '/srv/repo-feature' || exit")
    expect(invocation?.script).toContain('exec "${SHELL:-/bin/sh}" -l')
    expect(invocation?.script).not.toContain('tmux')
    expect(invocation?.shellCommand).not.toContain('tmux')
  })

  test('rejects unsafe external target input', () => {
    expect(buildExternalRemoteTerminalInvocation({ alias: 'bad alias', worktreePath: '/srv/repo' })).toBeNull()
    expect(buildExternalRemoteTerminalInvocation({ alias: 'prod', worktreePath: 'relative/repo' })).toBeNull()
    expect(buildExternalRemoteTerminalInvocation({ alias: 'prod', worktreePath: '/srv/\u0000repo' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
bun run test src/system/remote-terminal.test.ts
```

Expected: FAIL because `buildManagedRemoteTerminalInvocation`, `buildManagedRemoteTerminalSessionName`, and `buildExternalRemoteTerminalInvocation` are not implemented.

- [ ] **Step 3: Replace the shared builder implementation**

Use this content for `src/system/remote-terminal.ts`:

```ts
import { createHash } from 'node:crypto'

export interface RemoteTerminalEndpoint {
  user: string
  host: string
  port: number
}

export interface ManagedRemoteTerminalTarget {
  alias: string
  endpoint: RemoteTerminalEndpoint
  repoPath: string
  worktreePath: string
  terminalNumber: number
}

export interface ExternalRemoteTerminalTarget {
  alias: string
  worktreePath: string
}

export interface RemoteTerminalInvocation {
  command: 'ssh'
  args: string[]
  script: string
  shellCommand: string
}

export function buildManagedRemoteTerminalSessionName(target: ManagedRemoteTerminalTarget): string {
  const endpoint = remoteEndpointIdentity(target.endpoint)
  const digest = createHash('sha256')
    .update(endpoint)
    .update('\0')
    .update(target.repoPath)
    .update('\0')
    .update(target.worktreePath)
    .update('\0')
    .update(String(target.terminalNumber))
    .digest('hex')
    .slice(0, 24)
  return `goblin-${digest}`
}

export function buildManagedRemoteTerminalInvocation(
  target: ManagedRemoteTerminalTarget,
): RemoteTerminalInvocation | null {
  if (
    !isSafeRemoteAlias(target.alias) ||
    !isSafeRemoteEndpoint(target.endpoint) ||
    !isSafeRemoteAbsolutePath(target.repoPath) ||
    !isSafeRemoteAbsolutePath(target.worktreePath) ||
    !isSafeTerminalNumber(target.terminalNumber)
  ) {
    return null
  }

  const sessionName = buildManagedRemoteTerminalSessionName(target)
  const script = [
    `cd ${shellQuote(target.worktreePath)} || exit`,
    'if command -v tmux >/dev/null 2>&1; then',
    `  exec tmux new-session -A -s ${shellQuote(sessionName)} -c ${shellQuote(target.worktreePath)}`,
    'fi',
    'exec "${SHELL:-/bin/sh}" -l',
  ].join('\n')
  return buildSshInvocation(target.alias, script)
}

export function buildExternalRemoteTerminalInvocation(
  target: ExternalRemoteTerminalTarget,
): RemoteTerminalInvocation | null {
  if (!isSafeRemoteAlias(target.alias) || !isSafeRemoteAbsolutePath(target.worktreePath)) return null

  const script = [
    `cd ${shellQuote(target.worktreePath)} || exit`,
    'exec "${SHELL:-/bin/sh}" -l',
  ].join('\n')
  return buildSshInvocation(target.alias, script)
}

function buildSshInvocation(alias: string, script: string): RemoteTerminalInvocation {
  const remoteCommand = `sh -lc ${shellQuote(script)}`
  const args = ['-tt', '--', alias, remoteCommand]
  return {
    command: 'ssh',
    args,
    script,
    shellCommand: ['ssh', ...args].map(shellQuote).join(' '),
  }
}

function remoteEndpointIdentity(endpoint: RemoteTerminalEndpoint): string {
  return `${endpoint.user}@${endpoint.host}:${endpoint.port}`
}

function isSafeRemoteEndpoint(endpoint: RemoteTerminalEndpoint): boolean {
  return (
    isSafeEndpointPart(endpoint.user) &&
    isSafeEndpointPart(endpoint.host) &&
    Number.isInteger(endpoint.port) &&
    endpoint.port >= 1 &&
    endpoint.port <= 65535
  )
}

function isSafeEndpointPart(value: string): boolean {
  return value.length > 0 && value.length <= 255 && !/[\0-\x1f\x7f]/.test(value)
}

function isSafeTerminalNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1
}

function isSafeRemoteAlias(alias: string): boolean {
  return alias.length > 0 && alias.length <= 255 && !/[\s\0/?#\\]/.test(alias)
}

function isSafeRemoteAbsolutePath(remotePath: string): boolean {
  return (
    remotePath.length > 0 &&
    remotePath.length <= 4096 &&
    remotePath.startsWith('/') &&
    !/[\0-\x1f\x7f]/.test(remotePath)
  )
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
bun run test src/system/remote-terminal.test.ts
```

Expected: PASS.

## Task 2: Keep External Remote Terminals Plain SSH

**Files:**
- Modify: `src/system/apple-terminal.ts`
- Modify: `src/system/apple-terminal.test.ts`
- Modify: `src/system/ghostty.ts`
- Modify: `src/system/ghostty.test.ts`
- Modify: `src/system/terminals.ts`
- Modify: `src/system/terminals.test.ts`
- Modify: `src/server/modules/remote.ts`
- Modify: `src/server/modules/remote.test.ts`

- [ ] **Step 1: Update Apple Terminal remote tests**

In `src/system/apple-terminal.test.ts`, replace the first test body in `describe('openRemoteInAppleTerminal')` with:

```ts
  test('opens Terminal.app with a prepared plain ssh command', async () => {
    const { openRemoteInAppleTerminal } = await import('#/system/apple-terminal.ts')

    await expect(
      openRemoteInAppleTerminal({ alias: 'prod', worktreePath: '/srv/repo-feature' }),
    ).resolves.toEqual({
      ok: true,
      message: '/srv/repo-feature',
    })

    expect(mocks.execa).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      [
        '-e',
        expect.stringContaining('tell application "Terminal"'),
        expect.stringContaining('ssh'),
      ],
      expect.objectContaining({ timeout: 10_000, forceKillAfterDelay: 500 }),
    )
    expect(mocks.execa.mock.calls[0]![1][2]).toContain('prod')
    expect(mocks.execa.mock.calls[0]![1][2]).toContain('/srv/repo-feature')
    expect(mocks.execa.mock.calls[0]![1][2]).not.toContain('tmux')
    expect(mocks.execa.mock.calls[0]![1][2]).not.toContain('goblin-')
  })
```

In the invalid input test, replace the calls with:

```ts
    await expect(
      openRemoteInAppleTerminal({ alias: 'bad alias', worktreePath: '/srv/repo' }),
    ).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(
      openRemoteInAppleTerminal({ alias: 'prod', worktreePath: 'relative/repo' }),
    ).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
```

- [ ] **Step 2: Update Ghostty remote tests**

In `src/system/ghostty.test.ts`, replace target arguments with `{ alias: 'prod', worktreePath: '/srv/repo-feature' }`.

In the running Ghostty test, replace the tmux assertions with:

```ts
    expect(mocks.execa.mock.calls[0]![1][2]).toContain('prod')
    expect(mocks.execa.mock.calls[0]![1][2]).toContain('/srv/repo-feature')
    expect(mocks.execa.mock.calls[0]![1][2]).not.toContain('tmux')
    expect(mocks.execa.mock.calls[0]![1][2]).not.toContain('goblin-')
```

In the cold-start Ghostty test, replace the expected last call args with:

```ts
      [
        '-na',
        'Ghostty.app',
        '--args',
        '-e',
        'ssh',
        '-tt',
        '--',
        'prod',
        expect.stringContaining('sh -lc'),
      ],
```

Then add:

```ts
    expect(mocks.execa.mock.calls[1]![1][8]).toContain('/srv/repo-feature')
    expect(mocks.execa.mock.calls[1]![1][8]).not.toContain('tmux')
```

In the invalid input test, replace the calls with:

```ts
    await expect(
      openRemoteInGhostty({ alias: 'bad alias', worktreePath: '/srv/repo' }),
    ).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(
      openRemoteInGhostty({ alias: 'prod', worktreePath: 'relative/repo' }),
    ).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
```

In the not-installed test, replace the call with:

```ts
    await expect(openRemoteInGhostty({ alias: 'prod', worktreePath: '/srv/repo' })).resolves.toEqual({
      ok: false,
      message: 'error.ghostty-not-installed',
    })
```

- [ ] **Step 3: Update terminal registry tests**

In `src/system/terminals.test.ts`, update both remote backend mocks:

```ts
  openRemoteInGhostty: vi.fn(async (target: { alias: string; worktreePath: string }) => ({
    ok: true,
    message: `${target.alias}:${target.worktreePath}`,
  })),
```

```ts
  openRemoteInAppleTerminal: vi.fn(async (target: { alias: string; worktreePath: string }) => ({
    ok: true,
    message: `${target.alias}:${target.worktreePath}`,
  })),
```

Replace calls to `openRemoteInPreferredTerminal('prod', '/srv/repo', '/srv/repo-feature', 'terminal')` with:

```ts
openRemoteInPreferredTerminal('prod', '/srv/repo-feature', 'terminal')
```

Replace calls to `openRemoteInPreferredTerminal('prod', '/srv/repo', '/srv/repo-feature', 'auto')` with:

```ts
openRemoteInPreferredTerminal('prod', '/srv/repo-feature', 'auto')
```

Replace expected backend targets with:

```ts
{ alias: 'prod', worktreePath: '/srv/repo-feature' }
```

Replace the unsupported backend call target with:

```ts
{ alias: 'prod', worktreePath: '/srv/repo-feature' }
```

- [ ] **Step 4: Update server remote module test**

In `src/server/modules/remote.test.ts`, change the terminal opener expectation to:

```ts
    expect(mocks.openRemoteInPreferredTerminal).toHaveBeenCalledWith('prod', '/srv/repo-feature', 'auto')
```

- [ ] **Step 5: Run focused tests and verify they fail**

Run:

```bash
bun run test src/system/apple-terminal.test.ts src/system/ghostty.test.ts src/system/terminals.test.ts src/server/modules/remote.test.ts
```

Expected: FAIL because implementation still passes repo path to external terminal builders and still uses the tmux builder.

- [ ] **Step 6: Update Apple Terminal implementation**

In `src/system/apple-terminal.ts`, replace the remote-terminal import with:

```ts
import { buildExternalRemoteTerminalInvocation, type ExternalRemoteTerminalTarget } from '#/system/remote-terminal.ts'
```

Replace the `openRemoteInAppleTerminal()` signature and invocation builder call with:

```ts
export async function openRemoteInAppleTerminal(
  target: ExternalRemoteTerminalTarget,
): Promise<{ ok: boolean; message: string }> {
  const invocation = buildExternalRemoteTerminalInvocation(target)
  if (!invocation) return { ok: false, message: 'error.invalid-arguments' }
```

The rest of the function stays unchanged and continues returning `target.worktreePath` on success.

- [ ] **Step 7: Update Ghostty implementation**

In `src/system/ghostty.ts`, replace the remote-terminal import with:

```ts
import { buildExternalRemoteTerminalInvocation, type ExternalRemoteTerminalTarget } from '#/system/remote-terminal.ts'
```

Replace the `openRemoteInGhostty()` signature and invocation builder call with:

```ts
export async function openRemoteInGhostty(target: ExternalRemoteTerminalTarget): Promise<{ ok: boolean; message: string }> {
  const invocation = buildExternalRemoteTerminalInvocation(target)
  if (!invocation) return { ok: false, message: 'error.invalid-arguments' }
  if (!isGhosttyInstalled()) return { ok: false, message: 'error.ghostty-not-installed' }
```

The rest of the function stays unchanged and continues returning `target.worktreePath` on success.

- [ ] **Step 8: Update terminal registry implementation**

In `src/system/terminals.ts`, replace the remote terminal target import with:

```ts
import type { ExternalRemoteTerminalTarget } from '#/system/remote-terminal.ts'
```

Change `TerminalBackend.openRemote` to:

```ts
  openRemote?: (target: ExternalRemoteTerminalTarget) => Promise<ExecResult>
```

Change `openRemoteInTerminalBackend()` to:

```ts
export function openRemoteInTerminalBackend(
  backend: TerminalBackend | null,
  target: ExternalRemoteTerminalTarget,
): Promise<ExecResult> {
  if (!backend) return Promise.resolve({ ok: false, message: 'error.terminal-not-installed' })
  return backend.openRemote
    ? backend.openRemote(target)
    : Promise.resolve({ ok: false, message: 'error.remote-terminal-not-supported' })
}
```

Change `openRemoteInPreferredTerminal()` to:

```ts
export async function openRemoteInPreferredTerminal(
  alias: string,
  worktreePath: string,
  pref: TerminalPref,
): Promise<ExecResult> {
  const resolved = resolveTerminalApp(pref, await getTerminalAppAvailability())
  return await openRemoteInTerminalBackend(resolved ? backends[resolved] : null, { alias, worktreePath })
}
```

- [ ] **Step 9: Update server remote module implementation**

In `src/server/modules/remote.ts`, replace the terminal opener call with:

```ts
  return await openRemoteInPreferredTerminal(
    resolved.target.alias,
    input.worktreePath,
    prefs.terminalApp,
  )
```

- [ ] **Step 10: Run focused tests and verify they pass**

Run:

```bash
bun run test src/system/apple-terminal.test.ts src/system/ghostty.test.ts src/system/terminals.test.ts src/server/modules/remote.test.ts
```

Expected: PASS.

## Task 3: Route Managed Remote Terminals Through Numeric Tmux Identity

**Files:**
- Modify: `src/system/ssh/commands.ts`
- Modify: `src/system/ssh/commands.test.ts`
- Modify: `src/server/terminal/terminal-catalog.ts`
- Modify: `src/server/terminal/terminal.test.ts`

- [ ] **Step 1: Update SSH command adapter tests**

In `src/system/ssh/commands.test.ts`, replace the remote terminal invocation test with:

```ts
  test('renders tmux-aware managed remote terminal invocation through the ssh command adapter', () => {
    const invocation = buildRemoteTerminalInvocation(TARGET, '/srv/repo-feature', {
      cols: 100,
      rows: 30,
      terminalNumber: 2,
    })

    expect(invocation.command).toBe('ssh')
    expect(invocation.args).toEqual(['-tt', '--', 'prod', expect.stringContaining('sh -lc')])
    expect(invocation.script).toContain("cd '/srv/repo-feature' || exit")
    expect(invocation.script).toContain('command -v tmux >/dev/null 2>&1')
    expect(invocation.script).toContain("exec tmux new-session -A -s 'goblin-")
    expect(invocation.script).toContain('exec "${SHELL:-/bin/sh}" -l')
  })

  test('managed remote terminal hash uses endpoint and terminal number instead of alias', () => {
    const first = buildRemoteTerminalInvocation(TARGET, '/srv/repo-feature', {
      cols: 100,
      rows: 30,
      terminalNumber: 1,
    })
    const sameEndpointDifferentAlias = buildRemoteTerminalInvocation(
      { ...TARGET, alias: 'renamed-prod', id: 'ssh-config://renamed-prod/srv/repo' },
      '/srv/repo-feature',
      { cols: 100, rows: 30, terminalNumber: 1 },
    )
    const secondTerminal = buildRemoteTerminalInvocation(TARGET, '/srv/repo-feature', {
      cols: 100,
      rows: 30,
      terminalNumber: 2,
    })

    const sessionNamePattern = /goblin-[a-f0-9]{24}/
    const firstName = first.script.match(sessionNamePattern)?.[0]
    const renamedName = sameEndpointDifferentAlias.script.match(sessionNamePattern)?.[0]
    const secondName = secondTerminal.script.match(sessionNamePattern)?.[0]

    expect(firstName).toBeTruthy()
    expect(renamedName).toBe(firstName)
    expect(secondName).not.toBe(firstName)
  })
```

- [ ] **Step 2: Update server terminal tests**

In `src/server/terminal/terminal.test.ts`, add `closeServerTerminal` to the import list from `#/server/terminal/terminal.ts`.

Add this test after `creates remote terminal sessions with a tmux-aware ssh command`:

```ts
  test('reuses the smallest missing terminal number for additional sessions', async () => {
    const first = await createServerTerminal('client_1', {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.key).toBe('/repo\u0000/repo-linked\u0000terminal-1')
    const firstSession = first.sessions.find((session) => session.key === first.key)
    expect(firstSession).toBeTruthy()
    if (!firstSession) return

    const second = await createServerTerminal('client_1', {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.key).toBe('/repo\u0000/repo-linked\u0000terminal-2')

    expect(closeServerTerminal('client_1', { sessionId: firstSession.sessionId })).toBe(true)

    const reopened = await createServerTerminal('client_1', {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
    })
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.key).toBe('/repo\u0000/repo-linked\u0000terminal-1')
  })
```

In the existing remote terminal creation test, after `const args = ...`, add:

```ts
    expect(args[3]).toContain('tmux new-session -A')
    expect(args[3]).toContain('goblin-')
    expect(args[3]).not.toContain('alice@example.com')
    expect(args[3]).not.toContain('/srv/repo\u0000')
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```bash
bun run test src/system/ssh/commands.test.ts src/server/terminal/terminal.test.ts
```

Expected: FAIL because the SSH adapter has no `terminalNumber` option and the catalog still uses max index plus one.

- [ ] **Step 4: Update managed SSH command adapter**

In `src/system/ssh/commands.ts`, replace the remote terminal builder import with:

```ts
import {
  buildManagedRemoteTerminalInvocation,
} from '#/system/remote-terminal.ts'
```

Change `RemoteCommandInvocation` use for terminal options by replacing `buildRemoteTerminalInvocation()` with:

```ts
export function buildRemoteTerminalInvocation(
  target: RemoteRepoTarget,
  remotePath: string,
  options: { cols: number; rows: number; terminalNumber: number },
): RemoteCommandInvocation {
  const invocation = buildManagedRemoteTerminalInvocation({
    alias: target.alias,
    endpoint: {
      user: target.user,
      host: target.host,
      port: target.port,
    },
    repoPath: target.remotePath,
    worktreePath: remotePath,
    terminalNumber: options.terminalNumber,
  })
  if (!invocation) throw new Error('Invalid remote terminal invocation')
  return {
    command: invocation.command,
    args: invocation.args,
    script: invocation.script,
  }
}
```

- [ ] **Step 5: Update terminal catalog remote creation**

In `src/server/terminal/terminal-catalog.ts`, in `ensureRemote()`, add terminal number parsing before building the invocation:

```ts
    const terminalNumber = parseTerminalIdIndex(context.terminalId)
    if (terminalNumber === null) return { ok: false, message: 'error.invalid-arguments' }
```

Then replace the invocation call with:

```ts
    const invocation = buildRemoteTerminalInvocation(resolved.target, input.worktreePath, {
      cols: context.cols,
      rows: context.rows,
      terminalNumber,
    })
```

- [ ] **Step 6: Update terminal id allocation**

In `src/server/terminal/terminal-catalog.ts`, replace `nextTerminalId()` with:

```ts
  async nextTerminalId(repoRoot: string, worktreePath: string): Promise<string> {
    const sessions = await this.options.manager.listSessions(repoRoot)
    const usedIndexes = new Set<number>()
    for (const session of sessions) {
      const parsed = parseSessionKey(session.key)
      if (!parsed || parsed.repoRoot !== repoRoot || parsed.worktreePath !== worktreePath) continue
      const index = parseTerminalIdIndex(parsed.terminalId)
      if (index !== null) usedIndexes.add(index)
    }
    let nextIndex = 1
    while (usedIndexes.has(nextIndex)) nextIndex += 1
    return formatTerminalId(nextIndex)
  }
```

- [ ] **Step 7: Run focused tests and verify they pass**

Run:

```bash
bun run test src/system/ssh/commands.test.ts src/server/terminal/terminal.test.ts
```

Expected: PASS.

## Task 4: Regression Sweep

**Files:**
- Review: `src/system/remote-terminal.ts`
- Review: `src/system/apple-terminal.ts`
- Review: `src/system/ghostty.ts`
- Review: `src/system/terminals.ts`
- Review: `src/system/ssh/commands.ts`
- Review: `src/server/terminal/terminal-catalog.ts`

- [ ] **Step 1: Search for stale tmux-aware external terminal usage**

Run:

```bash
rg -n "buildRemoteTerminalInvocation|buildManagedRemoteTerminalInvocation|buildExternalRemoteTerminalInvocation|RemoteTerminalTarget|ManagedRemoteTerminalTarget|ExternalRemoteTerminalTarget|openRemoteInPreferredTerminal" "src"
```

Expected:

- `buildManagedRemoteTerminalInvocation` appears only in `src/system/remote-terminal.ts`, `src/system/remote-terminal.test.ts`, and `src/system/ssh/commands.ts`.
- `buildExternalRemoteTerminalInvocation` appears only in `src/system/remote-terminal.ts`, `src/system/remote-terminal.test.ts`, `src/system/apple-terminal.ts`, and `src/system/ghostty.ts`.
- External terminal files do not import managed target types.
- `openRemoteInPreferredTerminal` accepts alias, worktree path, and preference only.

- [ ] **Step 2: Run the feature test suite**

Run:

```bash
bun run test src/system/remote-terminal.test.ts src/system/apple-terminal.test.ts src/system/ghostty.test.ts src/system/terminals.test.ts src/server/modules/remote.test.ts src/system/ssh/commands.test.ts src/server/terminal/terminal.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run architecture guard**

Run:

```bash
bun run check:architecture
```

Expected: PASS.

- [ ] **Step 5: Manual verification checklist**

Perform these checks on a remote host with tmux installed:

```text
1. Open a saved remote repository.
2. Open Goblin-managed terminal-1 and terminal-2 for the same remote worktree.
3. In terminal-1, set a visible shell state such as: export GOBLIN_TMUX_SLOT=one
4. In terminal-2, set a different visible shell state such as: export GOBLIN_TMUX_SLOT=two
5. Close terminal-1.
6. Click +.
7. Confirm Goblin reopens terminal-1 and the value from step 3 is still present.
8. Confirm terminal-2 still has the value from step 4.
9. Use the remote branch Terminal action to open Terminal.app or Ghostty.
10. Confirm the external terminal opens in the remote worktree without entering tmux.
```

Perform this check on a remote host without tmux:

```text
1. Open a Goblin-managed remote terminal.
2. Confirm it opens a normal login shell in the remote worktree.
3. Confirm no structured error is shown solely because tmux is missing.
```
