# Windows Terminal and Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Goblin open Windows PowerShell by default, prove interactive ConPTY behavior, and package Windows releases without a local native build toolchain.

**Architecture:** Keep shell selection in the existing server terminal policy and make the host platform an explicit pure-policy input for deterministic tests. Keep node-pty/ConPTY and the terminal protocol unchanged. Put the packaging default in the existing shared electron-packaging policy module so the build script consumes a tested decision rather than embedding another platform branch.

**Tech Stack:** TypeScript in Node strip-only mode, Vitest, node-pty/ConPTY, Windows PowerShell 5.1, Bun build scripts, electron-builder/NSIS.

---

### Task 1: Make Windows PowerShell the canonical local shell

**Files:**
- Modify: `src/server/terminal/terminal-pty-runtime.test.ts`
- Modify: `src/server/terminal/terminal-local-shell.ts`

- [ ] **Step 1: Add failing Windows and explicit Unix policy tests**

Update the shell-policy assertions to pass an explicit platform and add these Windows contracts:

```ts
test('uses Windows PowerShell as the Windows default shell', () => {
  expect(resolveLocalShell({}, { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }, 'win32')).toEqual({
    command: 'powershell.exe',
    args: ['-NoLogo'],
  })
})

test('runs a Windows startup command and keeps PowerShell interactive', () => {
  expect(resolveLocalShellWithStartupShellCommand('codex\r', {}, 'win32')).toEqual({
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoExit', '-Command', 'codex'],
  })
})
```

Pass `'linux'` to the existing Unix policy assertions so they describe Unix behavior on every host. Keep the explicit command override test unchanged because explicit input must precede platform policy.

- [ ] **Step 2: Run the focused test and verify the new contract fails**

Run:

```powershell
bun run test -- src/server/terminal/terminal-pty-runtime.test.ts
```

Expected: FAIL because the resolver does not accept the platform input and still returns `cmd.exe` on Windows.

- [ ] **Step 3: Implement the platform-explicit shell policy**

Change both pure resolvers to take a third parameter with the production host as the default:

```ts
export function resolveLocalShell(
  input: { command?: string; args?: string[] },
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): ResolvedLocalShell {
  const explicit = input.command?.trim()
  if (explicit) return { command: explicit, args: input.args ?? [] }
  if (platform === 'win32') return { command: 'powershell.exe', args: ['-NoLogo'] }
  // Existing Unix policy remains unchanged.
}
```

Use the same input in the startup-command resolver:

```ts
if (platform === 'win32') {
  return {
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoExit', '-Command', commandLine],
  }
}
```

Blank startup commands delegate to `resolveLocalShell({}, env, platform)`. Update the comments so `cmd.exe` and `COMSPEC` are no longer described as supported defaults.

- [ ] **Step 4: Run the focused test and typecheck**

Run:

```powershell
bun run test -- src/server/terminal/terminal-pty-runtime.test.ts
bun run typecheck
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the shell policy slice**

```powershell
git add -- src/server/terminal/terminal-local-shell.ts src/server/terminal/terminal-pty-runtime.test.ts
git commit -m "fix: use PowerShell for Windows terminals"
```

### Task 2: Add a deterministic Windows ConPTY smoke test

**Files:**
- Create: `src/server/terminal/terminal-powershell.integration.test.ts`

- [ ] **Step 1: Write the Windows-only failing integration test**

Add a real node-pty smoke test that observes a marker instead of sleeping:

```ts
import { describe, expect, test } from 'vitest'
import { spawnTerminalPtyRuntime } from '#/server/terminal/terminal-pty-runtime.ts'

const windowsTest = process.platform === 'win32' ? test : test.skip

describe('Windows PowerShell terminal integration', () => {
  windowsTest('streams PowerShell output through ConPTY', async () => {
    const marker = 'GOBLIN_POWERSHELL_CONPTY_OK'
    let output = ''
    let resolveMarker: (() => void) | null = null
    let resolveExit: (() => void) | null = null
    const markerSeen = new Promise<void>((resolve) => {
      resolveMarker = resolve
    })
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const result = spawnTerminalPtyRuntime(
      {
        cwd: process.cwd(),
        cols: 100,
        rows: 30,
        startupShellCommand: `Write-Output ${marker}`,
      },
      {
        onData(data) {
          output += data
          if (output.includes(marker)) resolveMarker?.()
        },
        onExit() {
          resolveExit?.()
        },
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    try {
      await markerSeen
      expect(output).toContain(marker)
    } finally {
      result.events.disposeData()
      result.runtime.kill()
      await exited
    }
  })
})
```

- [ ] **Step 2: Run the smoke test against the pre-change shell contract**

Run:

```powershell
bun run test -- src/server/terminal/terminal-powershell.integration.test.ts
```

Expected before Task 1: FAIL because `cmd.exe /K` does not understand the PowerShell command. Expected after Task 1: PASS and observe the marker through ConPTY.

- [ ] **Step 3: Keep cleanup authoritative and deterministic**

If the native exit event races cleanup, retain the PTY runtime as the only process owner: dispose the data observer, call `kill()`, and let the existing exit observer release final ownership. Do not add polling, retries, or a second process registry.

- [ ] **Step 4: Run the terminal unit and integration tests together**

Run:

```powershell
bun run test -- src/server/terminal/terminal-pty-runtime.test.ts src/server/terminal/terminal-powershell.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the ConPTY coverage**

```powershell
git add -- src/server/terminal/terminal-powershell.integration.test.ts
git commit -m "test: cover Windows PowerShell ConPTY runtime"
```

### Task 3: Make Windows packaging consume verified native prebuilds

**Files:**
- Modify: `scripts/electron-packaging.ts`
- Modify: `src/main/electron-packaging.test.ts`
- Modify: `scripts/build.ts`

- [ ] **Step 1: Add a failing pure packaging-policy test**

Extend `src/main/electron-packaging.test.ts` with:

```ts
import {
  defaultSkipElectronDependencyRebuild,
  ELECTRON_SERVER_EXTRA_RESOURCES,
} from '#scripts/electron-packaging.ts'

test('uses verified prebuilds for Windows release and install packaging', () => {
  expect(defaultSkipElectronDependencyRebuild('win32', false)).toBe(true)
  expect(defaultSkipElectronDependencyRebuild('win32', true)).toBe(true)
})

test('keeps release rebuilds for macOS while install mode remains fast', () => {
  expect(defaultSkipElectronDependencyRebuild('darwin', false)).toBe(false)
  expect(defaultSkipElectronDependencyRebuild('darwin', true)).toBe(true)
})
```

- [ ] **Step 2: Run the policy test and verify it fails**

Run:

```powershell
bun run test -- src/main/electron-packaging.test.ts
```

Expected: FAIL because `defaultSkipElectronDependencyRebuild` is not exported.

- [ ] **Step 3: Implement and consume the packaging default**

Add to `scripts/electron-packaging.ts`:

```ts
export function defaultSkipElectronDependencyRebuild(
  platform: NodeJS.Platform,
  installMode: boolean,
): boolean {
  return installMode || platform === 'win32'
}
```

Import it directly in `scripts/build.ts` and use it when constructing defaults:

```ts
skipRebuild: defaultSkipElectronDependencyRebuild(process.platform, shouldInstall),
```

Keep the existing CLI and environment overrides, the prebuild verification,
and `appendRebuildFlag`. A deliberate `--keep-rebuild` remains a diagnostic
override; the normal Windows path uses `--config.npmRebuild=false`.

- [ ] **Step 4: Run the focused policy test and typecheck**

Run:

```powershell
bun run test -- src/main/electron-packaging.test.ts
bun run typecheck
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the packaging policy slice**

```powershell
git add -- scripts/electron-packaging.ts src/main/electron-packaging.test.ts scripts/build.ts
git commit -m "fix: package Windows native prebuilds by default"
```

### Task 4: Verify the complete terminal and package slice

**Files:**
- Verify only; no source changes expected.

- [ ] **Step 1: Run all focused tests**

```powershell
bun run test -- src/server/terminal/terminal-pty-runtime.test.ts src/server/terminal/terminal-powershell.integration.test.ts src/main/electron-packaging.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository type verification**

```powershell
bun run typecheck
```

Expected: PASS, including architecture and source-policy checks.

- [ ] **Step 3: Build normal Windows installers without the rebuild flag**

```powershell
bun run build
```

Expected: electron-builder logs `skipped dependencies rebuild`, then produces x64 and arm64 NSIS installers and passes packaged runtime verification. The command must not invoke node-gyp or require Python.

- [ ] **Step 4: Exercise the real Codex TUI path**

Use the production `spawnTerminalPtyRuntime` boundary to open the default shell, run this privacy-safe prompt in Codex, and require the marker in PTY output:

```text
Reply with exactly the uppercase spelling of goblin_windows_tui_ok and do not run any tools.
```

Expected: PowerShell starts directly and Codex returns `GOBLIN_WINDOWS_TUI_OK` through ConPTY. Do not turn this authenticated network check into an automated repository test.

- [ ] **Step 5: Record the remaining Windows-suite failures**

Run:

```powershell
bun run test
```

Expected at this slice boundary: the terminal policy tests are green. Any remaining failures are captured as current evidence for the separate Windows test-portability plan; no failure is waived from final acceptance.
