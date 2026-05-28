# SSH Private Key Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional SSH private key path support for remote repositories while relying on ssh-agent/system SSH for passphrase handling.

**Architecture:** Store a normalized optional `identityFile` path on remote targets and carry it through renderer, RPC, config resolution, and SSH command construction. Keep credentials out of persisted state by continuing to strip password/passphrase/private key content and only storing the key file path.

**Tech Stack:** TypeScript, React, tRPC/valibot, Vitest, OpenSSH via `execa`.

---

## File Structure

- Modify `src/shared/remote-repo.ts`: add optional `identityFile` to remote target/input types and normalization.
- Modify `src/shared/remote-repo.test.ts`: verify ID stability, path preservation, and secret stripping.
- Modify `src/main/ssh/config.ts`: carry `identityFile` through config/manual resolution.
- Modify `src/main/ssh/config.test.ts`: verify config and manual targets preserve `identityFile`.
- Modify `src/main/ssh/commands.ts`: add `-i <identityFile>` and stop forcing batch password suppression.
- Modify `src/main/ssh/commands.test.ts`: verify SSH argv for identity files and retained default behavior when absent.
- Modify `src/shared/rpc.ts`: accept optional `identityFile` in remote schemas.
- Modify `src/main/rpc.test.ts`: verify router accepts `identityFile`.
- Modify `src/renderer/components/AddRemoteRepositoryDialog.tsx`: add private key input and include it in built connection inputs.
- Modify `src/renderer/components/AddRemoteRepositoryDialog.test.tsx`: verify builder includes `identityFile`.
- Modify `src/main/i18n/en.ts`, `src/main/i18n/zh.ts`, `src/main/i18n/ja.ts`, `src/main/i18n/ko.ts`: add UI labels/help text.

## Task 1: Shared Remote Target Model

**Files:**
- Modify: `src/shared/remote-repo.ts`
- Test: `src/shared/remote-repo.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that prove `identityFile` is preserved as metadata, does not affect repository ID, and secret-like fields remain stripped:

```ts
test('preserves identity file metadata without changing the stable repository id', () => {
  const base = normalizeRemoteTarget({
    user: 'deploy',
    host: 'prod',
    port: 22,
    remotePath: '/srv/goblin',
  })
  const withKey = normalizeRemoteTarget({
    user: 'deploy',
    host: 'prod',
    port: 22,
    remotePath: '/srv/goblin',
    identityFile: '~/.ssh/prod_ed25519',
  })

  expect(withKey?.id).toBe(base?.id)
  expect(withKey?.identityFile).toBe('~/.ssh/prod_ed25519')
})

test('rejects unsafe identity file metadata and still strips secret-like fields', () => {
  const target = normalizeRemoteTarget({
    host: 'prod',
    user: 'deploy',
    port: 22,
    remotePath: '/srv/goblin',
    identityFile: 'bad\0key',
    password: 'secret',
    passphrase: 'secret',
    privateKey: 'secret',
  } as Record<string, unknown>)

  expect(target).toEqual({
    id: 'ssh://deploy@prod:22/srv/goblin',
    alias: null,
    host: 'prod',
    user: 'deploy',
    port: 22,
    remotePath: '/srv/goblin',
    displayName: 'prod:goblin',
  })
})
```

- [ ] **Step 2: Run tests and verify red**

Run: `bun run test "src/shared/remote-repo.test.ts"`

Expected: fail because `identityFile` is not present on normalized targets.

- [ ] **Step 3: Implement model support**

Update `RemoteRepoTarget`, `RemoteConnectionInput`, `RemoteRepoTargetInput`, and `remoteTargetFields` to include optional `identityFile`. Add a small normalizer:

```ts
function normalizeIdentityFile(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return safeText(trimmed) ? trimmed : undefined
}
```

Return `identityFile` only when defined. Do not include it in `normalizeRemoteRepoId`.

- [ ] **Step 4: Verify green**

Run: `bun run test "src/shared/remote-repo.test.ts"`

Expected: all tests in the file pass.

## Task 2: SSH Config Resolution

**Files:**
- Modify: `src/main/ssh/config.ts`
- Test: `src/main/ssh/config.test.ts`

- [ ] **Step 1: Write failing tests**

Add config and manual resolution checks:

```ts
expect(
  await resolveRemoteTarget({
    mode: 'config',
    alias: 'prod',
    remotePath: '/srv/goblin',
    identityFile: '~/.ssh/prod_ed25519',
  }),
).toMatchObject({ target: { identityFile: '~/.ssh/prod_ed25519' } })

expect(
  await resolveRemoteTarget({
    mode: 'manual',
    host: 'prod.example.com',
    user: 'deploy',
    port: 2222,
    remotePath: '/srv/goblin',
    identityFile: '~/.ssh/prod_ed25519',
  }),
).toMatchObject({ target: { identityFile: '~/.ssh/prod_ed25519' } })
```

- [ ] **Step 2: Run tests and verify red**

Run: `bun run test "src/main/ssh/config.test.ts"`

Expected: fail because resolved targets do not carry `identityFile`.

- [ ] **Step 3: Implement passthrough**

Pass `input.identityFile` into `toResolvedTarget` for both modes and include optional `identityFile?: string` in the helper input type.

- [ ] **Step 4: Verify green**

Run: `bun run test "src/main/ssh/config.test.ts"`

Expected: all tests in the file pass.

## Task 3: SSH Command Invocation

**Files:**
- Modify: `src/main/ssh/commands.ts`
- Test: `src/main/ssh/commands.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for `-i` behavior and batch suppression removal:

```ts
test('uses identity file when provided', async () => {
  const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

  const invocation = buildRemoteCommandInvocation(
    { ...MANUAL_TARGET, identityFile: '~/.ssh/prod_ed25519' },
    { type: 'checkShell' },
  )

  expect(invocation.args).toEqual(expect.arrayContaining(['-i', '~/.ssh/prod_ed25519']))
})

test('allows ssh-agent or system ssh to handle encrypted key passphrases', async () => {
  const { buildRemoteCommandInvocation } = await import('#/main/ssh/commands.ts')

  const invocation = buildRemoteCommandInvocation(MANUAL_TARGET, { type: 'checkShell' })

  expect(invocation.args).not.toContain('BatchMode=yes')
  expect(invocation.args).not.toContain('NumberOfPasswordPrompts=0')
})
```

- [ ] **Step 2: Run tests and verify red**

Run: `bun run test "src/main/ssh/commands.test.ts"`

Expected: fail because `-i` is absent and batch suppression options are still present.

- [ ] **Step 3: Implement SSH argv changes**

In `buildRemoteCommandInvocation`, remove `BatchMode=yes` and `NumberOfPasswordPrompts=0`. After the fixed `-o` options, add:

```ts
if (target.identityFile) args.push('-i', target.identityFile)
```

Keep the remote shell script as a single quoted `sh -lc` remote command.

- [ ] **Step 4: Verify green**

Run: `bun run test "src/main/ssh/commands.test.ts"`

Expected: all tests in the file pass.

## Task 4: RPC Schema

**Files:**
- Modify: `src/shared/rpc.ts`
- Test: `src/main/rpc.test.ts`

- [ ] **Step 1: Write failing router test**

Add a test that accepts an identity file in remote target resolution:

```ts
test('accepts optional remote identity file at the router boundary', async () => {
  const result = await invokeRpc('remote.resolveTarget', {
    mode: 'manual',
    host: 'prod',
    user: 'deploy',
    port: 22,
    remotePath: '/srv/goblin',
    identityFile: '~/.ssh/prod_ed25519',
  })

  expect(result.ok).toBe(true)
})
```

- [ ] **Step 2: Run tests and verify red**

Run: `bun run test "src/main/rpc.test.ts"`

Expected: fail with bad request because the schema strips or rejects `identityFile`.

- [ ] **Step 3: Implement schema support**

Add `identityFile: v.optional(v.string())` to `RemoteTargetSchema` and both branches of `RemoteConnectionInputSchema`.

- [ ] **Step 4: Verify green**

Run: `bun run test "src/main/rpc.test.ts"`

Expected: all tests in the file pass.

## Task 5: Add Remote Dialog UI

**Files:**
- Modify: `src/renderer/components/AddRemoteRepositoryDialog.tsx`
- Modify: `src/main/i18n/en.ts`
- Modify: `src/main/i18n/zh.ts`
- Modify: `src/main/i18n/ja.ts`
- Modify: `src/main/i18n/ko.ts`
- Test: `src/renderer/components/AddRemoteRepositoryDialog.test.tsx`

- [ ] **Step 1: Write failing builder tests**

Export `buildRemoteConnectionInput` if needed and test config/manual input construction:

```ts
expect(
  buildRemoteConnectionInput('manual', '', 'prod.example.com', 'deploy', 22, '/srv/goblin', '~/.ssh/prod_ed25519'),
).toEqual({
  mode: 'manual',
  host: 'prod.example.com',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/goblin',
  identityFile: '~/.ssh/prod_ed25519',
})

expect(buildRemoteConnectionInput('config', 'prod', '', '', undefined, '/srv/goblin', '')).toEqual({
  mode: 'config',
  alias: 'prod',
  remotePath: '/srv/goblin',
})
```

- [ ] **Step 2: Run tests and verify red**

Run: `bun run test "src/renderer/components/AddRemoteRepositoryDialog.test.tsx"`

Expected: fail because the builder does not accept or emit `identityFile`.

- [ ] **Step 3: Implement UI state and builder support**

Add `const [identityFile, setIdentityFile] = useState('')`, reset it when the dialog opens, and pass it into `buildRemoteConnectionInput`.

Add a field below the host mode controls:

```tsx
<Field
  label={t('remote.private-key')}
  id="remote-private-key"
  value={identityFile}
  disabled={loading}
  onChange={(value) => {
    setIdentityFile(value)
    setTarget(null)
    setDiagnostics(null)
  }}
/>
<div className="mt-1 text-xs leading-4 text-muted-foreground">{t('remote.private-key-help')}</div>
```

Update `buildRemoteConnectionInput` to trim `identityFile` and include it only when non-empty.

- [ ] **Step 4: Add translations**

Add:

```ts
'remote.private-key': 'Private key',
'remote.private-key-help': 'Optional. Goblin stores only the path and uses ssh-agent or system SSH for passphrases.',
```

Use equivalent Simplified Chinese, Japanese, and Korean translations.

- [ ] **Step 5: Verify green**

Run: `bun run test "src/renderer/components/AddRemoteRepositoryDialog.test.tsx"`

Expected: all tests in the file pass.

## Task 6: Full Verification

**Files:**
- All modified files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun run test "src/shared/remote-repo.test.ts" "src/main/ssh" "src/main/rpc.test.ts" "src/renderer/components/AddRemoteRepositoryDialog.test.tsx"
```

Expected: all selected tests pass.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: exit code 0.

- [ ] **Step 3: Inspect changed files**

Run: `git status --short`

Expected: only intended source/test/spec/plan files are changed or untracked.
