# AI CLI Terminal Busy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show worktree and terminal-list spinners only while Codex or Claude is actively executing in an embedded terminal.

**Architecture:** Keep terminal lifecycle state (`opening | open | error`) separate from AI CLI execution state. Parse Codex/Claude status from renderer-side terminal output, expose a derived `aiCliBusy` flag through terminal snapshots and summaries, then let worktree rows and terminal rows consume that flag for spinner visibility.

**Tech Stack:** React 19, TypeScript, Vitest/jsdom, xterm, lucide-react.

**Commit policy:** This repository's instructions say not to plan or execute git commits unless the user explicitly asks. This plan intentionally has no commit steps.

---

## File Structure

- Create: `src/renderer/components/terminal/ai-cli-status.ts`
  - Owns AI CLI provider/status types, ANSI stripping, status detection, and `aiCliBusy()`.
- Create: `src/renderer/components/terminal/ai-cli-status.test.ts`
  - Unit tests for Codex/Claude detection and busy derivation.
- Modify: `src/renderer/components/terminal/types.ts`
  - Exports AI CLI state types through terminal snapshots and summaries.
- Modify: `src/renderer/components/terminal/ManagedTerminalSession.ts`
  - Stores AI CLI state, updates it from terminal output, clears it on restart/exit/new view destruction.
- Modify: `src/renderer/components/terminal/ManagedTerminalSession.test.ts`
  - Verifies snapshot AI state updates and reset behavior.
- Modify: `src/renderer/components/terminal/TerminalSessionProvider.tsx`
  - Adds `aiCli` and `aiCliBusy` to session summaries; exposes `aiCliBusyByGroup(groupKey)`.
- Modify: `src/renderer/components/terminal/TerminalSessionProvider.test.tsx`
  - Verifies summary and group-level busy derivation.
- Modify: `src/renderer/components/terminal/TerminalSwitcher.tsx`
  - Shows a spinner before terminal rows only when `session.aiCliBusy` is true.
- Modify: `src/renderer/components/terminal/TerminalSwitcher.test.tsx`
  - Verifies active AI CLI terminal rows show a spinner and ordinary open terminals do not.
- Modify: `src/renderer/components/terminal/terminal-session.css`
  - Adds a compact terminal-row spinner class if needed for stable sizing.
- Modify: `src/renderer/components/BranchList.tsx`
  - Reads optional terminal context and computes worktree AI busy by terminal group.
- Modify: `src/renderer/components/branch-list/BranchRow.tsx`
  - Accepts `worktreeAiCliBusy` and shows a spinner in the row icon slot when true.
- Modify: `src/renderer/components/BranchList.ui.test.tsx`
  - Verifies branch/worktree rows show the spinner only for AI-busy worktrees.
- Modify: `src/renderer/components/RepoTabs.test.tsx`
  - Updates test terminal context fixtures for the new context method/type.

## Task 1: AI CLI Parser

**Files:**
- Create: `src/renderer/components/terminal/ai-cli-status.ts`
- Create: `src/renderer/components/terminal/ai-cli-status.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `src/renderer/components/terminal/ai-cli-status.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  aiCliBusy,
  detectAiCliExecutionState,
  type AiCliExecutionState,
} from '#/renderer/components/terminal/ai-cli-status.ts'

describe('detectAiCliExecutionState', () => {
  test('detects Codex running from process name', () => {
    const state = detectAiCliExecutionState({ processName: 'codex', chunk: 'thinking\n', previous: null })
    expect(state).toMatchObject({ provider: 'codex', status: 'running' })
  })

  test('detects Claude running from process name', () => {
    const state = detectAiCliExecutionState({ processName: 'claude', chunk: 'Working…\n', previous: null })
    expect(state).toMatchObject({ provider: 'claude', status: 'running' })
  })

  test('detects provider from echoed shell command', () => {
    expect(
      detectAiCliExecutionState({ processName: 'zsh', chunk: '$ codex fix terminal status\n', previous: null }),
    ).toMatchObject({ provider: 'codex', status: 'running' })
    expect(
      detectAiCliExecutionState({ processName: 'zsh', chunk: '> claude continue\n', previous: null }),
    ).toMatchObject({ provider: 'claude', status: 'running' })
  })

  test('maps approval and prompt output to waiting', () => {
    const previous: AiCliExecutionState = { provider: 'codex', status: 'running', updatedAt: 1 }
    expect(
      detectAiCliExecutionState({ processName: 'codex', chunk: 'Allow command? [y/N]\n', previous }),
    ).toMatchObject({ provider: 'codex', status: 'waiting' })
  })

  test('maps terminal states to non-busy end states', () => {
    const previous: AiCliExecutionState = { provider: 'claude', status: 'running', updatedAt: 1 }
    expect(detectAiCliExecutionState({ processName: 'claude', chunk: 'Done\n', previous })).toMatchObject({
      provider: 'claude',
      status: 'succeeded',
    })
    expect(detectAiCliExecutionState({ processName: 'claude', chunk: 'Error: request failed\n', previous })).toMatchObject({
      provider: 'claude',
      status: 'failed',
    })
    expect(detectAiCliExecutionState({ processName: 'claude', chunk: 'Cancelled by user\n', previous })).toMatchObject({
      provider: 'claude',
      status: 'cancelled',
    })
  })

  test('strips ANSI before matching', () => {
    const state = detectAiCliExecutionState({
      processName: 'codex',
      chunk: '\u001b[32mWaiting for approval\u001b[0m\n',
      previous: { provider: 'codex', status: 'running', updatedAt: 1 },
    })
    expect(state).toMatchObject({ provider: 'codex', status: 'waiting' })
  })

  test('leaves unrelated shell output unclassified', () => {
    expect(detectAiCliExecutionState({ processName: 'zsh', chunk: 'git status\n', previous: null })).toBeNull()
  })
})

describe('aiCliBusy', () => {
  test('treats only starting and running as busy', () => {
    expect(aiCliBusy({ provider: 'codex', status: 'starting', updatedAt: 1 })).toBe(true)
    expect(aiCliBusy({ provider: 'codex', status: 'running', updatedAt: 1 })).toBe(true)
    expect(aiCliBusy({ provider: 'codex', status: 'waiting', updatedAt: 1 })).toBe(false)
    expect(aiCliBusy({ provider: 'codex', status: 'succeeded', updatedAt: 1 })).toBe(false)
    expect(aiCliBusy({ provider: 'codex', status: 'failed', updatedAt: 1 })).toBe(false)
    expect(aiCliBusy({ provider: 'codex', status: 'cancelled', updatedAt: 1 })).toBe(false)
    expect(aiCliBusy(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the parser test and verify failure**

Run:

```bash
bun run test src/renderer/components/terminal/ai-cli-status.test.ts
```

Expected: FAIL because `src/renderer/components/terminal/ai-cli-status.ts` does not exist.

- [ ] **Step 3: Implement the parser**

Create `src/renderer/components/terminal/ai-cli-status.ts`:

```ts
export type AiCliProvider = 'codex' | 'claude'

export type AiCliStatus = 'starting' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'

export interface AiCliExecutionState {
  provider: AiCliProvider
  status: AiCliStatus
  updatedAt: number
}

export interface DetectAiCliExecutionStateInput {
  processName: string
  chunk: string
  previous: AiCliExecutionState | null
}

const ANSI_RE = /[\u001b\u009b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/gu
const SHELL_COMMAND_RE = /(?:^|[\r\n])\s*(?:[$>%#]\s*)?(codex|claude)(?:\s|$)/iu
const WAITING_RE = /\b(waiting|approval|approve|allow|confirm|select|choose|permission|press enter|yes\/no|\[y\/n\]|\[y\/N\])\b/iu
const FAILED_RE = /\b(error|failed|failure|exception|timed out|timeout)\b/iu
const CANCELLED_RE = /\b(cancelled|canceled|aborted|interrupted)\b/iu
const SUCCEEDED_RE = /\b(done|completed|success|succeeded|finished)\b/iu

export function detectAiCliExecutionState(input: DetectAiCliExecutionStateInput): AiCliExecutionState | null {
  try {
    const chunk = stripAnsi(input.chunk)
    const provider = detectProvider(input.processName, chunk, input.previous)
    if (!provider) return null
    const status = detectStatus(chunk, input.previous?.provider === provider ? input.previous.status : null)
    const previous = input.previous?.provider === provider ? input.previous : null
    if (previous && previous.status === status) return previous
    return { provider, status, updatedAt: Date.now() }
  } catch {
    return input.previous
  }
}

export function aiCliBusy(state: AiCliExecutionState | null | undefined): boolean {
  return state?.status === 'starting' || state?.status === 'running'
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
}

function detectProvider(
  processName: string,
  chunk: string,
  previous: AiCliExecutionState | null,
): AiCliProvider | null {
  const normalizedProcess = processName.trim().toLowerCase()
  if (normalizedProcess.includes('codex')) return 'codex'
  if (normalizedProcess.includes('claude')) return 'claude'
  const commandProvider = SHELL_COMMAND_RE.exec(chunk)?.[1]?.toLowerCase()
  if (commandProvider === 'codex' || commandProvider === 'claude') return commandProvider
  return previous?.provider ?? null
}

function detectStatus(chunk: string, previousStatus: AiCliStatus | null): AiCliStatus {
  if (CANCELLED_RE.test(chunk)) return 'cancelled'
  if (FAILED_RE.test(chunk)) return 'failed'
  if (SUCCEEDED_RE.test(chunk)) return 'succeeded'
  if (WAITING_RE.test(chunk)) return 'waiting'
  if (previousStatus === 'waiting') return 'waiting'
  return 'running'
}
```

- [ ] **Step 4: Run parser tests**

Run:

```bash
bun run test src/renderer/components/terminal/ai-cli-status.test.ts
```

Expected: PASS.

## Task 2: Terminal Snapshot State

**Files:**
- Modify: `src/renderer/components/terminal/types.ts`
- Modify: `src/renderer/components/terminal/ManagedTerminalSession.ts`
- Modify: `src/renderer/components/terminal/ManagedTerminalSession.test.ts`

- [ ] **Step 1: Extend terminal types**

Modify `src/renderer/components/terminal/types.ts`:

```ts
import type { TerminalExitEvent, TerminalOutputEvent } from '#/shared/terminal.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import type { AiCliExecutionState } from '#/renderer/components/terminal/ai-cli-status.ts'
```

Add `aiCli` to `TerminalSnapshot`:

```ts
export interface TerminalSnapshot {
  phase: TerminalPhase
  message: string | null
  processName: string
  search?: TerminalSearchResult | null
  progress?: TerminalProgressState | null
  aiCli?: AiCliExecutionState | null
}
```

Add `aiCli` and `aiCliBusy` to `TerminalSessionSummary`:

```ts
export interface TerminalSessionSummary {
  key: string
  groupKey: string
  terminalId: string
  index: number
  title: string
  phase: TerminalPhase
  active: boolean
  hasBell: boolean
  aiCli?: AiCliExecutionState | null
  aiCliBusy: boolean
}
```

Add this method to `TerminalSessionContextValue`:

```ts
  aiCliBusyByGroup: (groupKey: string) => boolean
```

- [ ] **Step 2: Write failing ManagedTerminalSession tests**

Append tests in `src/renderer/components/terminal/ManagedTerminalSession.test.ts` near the existing output/restart tests:

```ts
  test('updates AI CLI state from terminal output', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.handleOutput({ sessionId: 'session-1', data: 'thinking\n', seq: 1, processName: 'codex' })

    expect(session.snapshot().aiCli).toMatchObject({ provider: 'codex', status: 'running' })
  })

  test('clears AI CLI state on terminal exit and restart', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    session.handleOutput({ sessionId: 'session-1', data: 'thinking\n', seq: 1, processName: 'claude' })
    expect(session.snapshot().aiCli).toMatchObject({ provider: 'claude', status: 'running' })

    expect(session.handleExit({ sessionId: 'session-1' })).toBe(true)
    expect(session.snapshot().aiCli).toBeUndefined()

    session.restart()
    expect(session.snapshot().aiCli).toBeUndefined()
  })
```

- [ ] **Step 3: Run ManagedTerminalSession tests and verify failure**

Run:

```bash
bun run test src/renderer/components/terminal/ManagedTerminalSession.test.ts
```

Expected: FAIL because `snapshot().aiCli` is not populated or reset.

- [ ] **Step 4: Implement ManagedTerminalSession AI state**

Modify imports in `src/renderer/components/terminal/ManagedTerminalSession.ts`:

```ts
import {
  detectAiCliExecutionState,
  type AiCliExecutionState,
} from '#/renderer/components/terminal/ai-cli-status.ts'
```

Add a private field:

```ts
  private aiCliState: AiCliExecutionState | null = null
```

Update `snapshot()`:

```ts
  snapshot(): TerminalSnapshot {
    const snapshot: TerminalSnapshot = { phase: this.phase, message: this.message, processName: this.processName }
    if (this.searchResult) snapshot.search = this.searchResult
    if (this.progressState) snapshot.progress = this.progressState
    if (this.aiCliState) snapshot.aiCli = this.aiCliState
    return snapshot
  }
```

Update `handleOutput()` after `setProcessName()`:

```ts
  handleOutput(event: TerminalOutputEvent): void {
    if (event.sessionId !== this.ptySessionId) return
    this.setProcessName(event.processName)
    this.updateAiCliState(event.processName, event.data)
    if (this.replayBoundarySeq !== null) {
      this.replayPendingOutput.push(event)
      return
    }
    this.queueOutput(event.data)
  }
```

Update `handleExit()` before returning:

```ts
    this.clearAiCliState()
    return true
```

Update `restart()` after `this.restartOnStart = true`:

```ts
    this.clearAiCliState()
```

Update `destroyActiveView()` where `progressState` is cleared:

```ts
    this.aiCliState = null
```

Add helper methods near `setProcessName()`:

```ts
  private updateAiCliState(processName: string, chunk: string): void {
    const next = detectAiCliExecutionState({ processName, chunk, previous: this.aiCliState })
    if (next === this.aiCliState) return
    this.aiCliState = next
    this.notify()
  }

  private clearAiCliState(): void {
    if (!this.aiCliState) return
    this.aiCliState = null
    this.notify()
  }
```

- [ ] **Step 5: Run ManagedTerminalSession tests**

Run:

```bash
bun run test src/renderer/components/terminal/ManagedTerminalSession.test.ts
```

Expected: PASS.

## Task 3: Terminal Context Summaries

**Files:**
- Modify: `src/renderer/components/terminal/TerminalSessionProvider.tsx`
- Modify: `src/renderer/components/terminal/TerminalSessionProvider.test.tsx`
- Modify: `src/renderer/components/RepoTabs.test.tsx`

- [ ] **Step 1: Write failing TerminalSessionProvider test**

Modify the mock `ManagedTerminalSession` in `src/renderer/components/terminal/TerminalSessionProvider.test.tsx` so mock sessions can expose AI state:

```ts
const mockSessions = vi.hoisted(
  () =>
    [] as Array<{
      descriptor: TerminalDescriptor
      emitBell: (event: TerminalBellEvent) => void
      setSnapshot: (snapshot: TerminalSnapshot) => void
    }>,
)
```

Inside the mock class add:

```ts
    private currentSnapshot: TerminalSnapshot | null = null
```

Push `setSnapshot` in the constructor:

```ts
      mockSessions.push({
        descriptor,
        emitBell: (event) => this.onBell(this.descriptor, event),
        setSnapshot: (snapshot) => {
          this.currentSnapshot = snapshot
        },
      })
```

Update `snapshot()`:

```ts
    snapshot(): TerminalSnapshot {
      return this.currentSnapshot ?? { phase: 'open', message: null, processName: `terminal ${this.descriptor.index}` }
    }
```

Add this test:

```ts
  test('derives AI CLI busy summaries by terminal group', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      detailTab: 'terminal',
    })
    const { getContext, unmount } = await renderProvider()

    try {
      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        getContext().ensureDefault(base)
      })

      const groupKey = terminalSessionGroupKey({ kind: 'local', repoRoot: REPO_ID, worktreePath: WORKTREE_PATH })
      const firstSession = mockSessions.find((session) => session.descriptor.terminalId === 'terminal-1')
      if (!firstSession) throw new Error('missing terminal-1 mock session')
      firstSession.setSnapshot({
        phase: 'open',
        message: null,
        processName: 'codex',
        aiCli: { provider: 'codex', status: 'running', updatedAt: 1 },
      })

      expect(getContext().aiCliBusyByGroup(groupKey)).toBe(true)
      expect(getContext().sessionSummaries(groupKey)[0]).toMatchObject({
        aiCliBusy: true,
        aiCli: { provider: 'codex', status: 'running' },
      })

      firstSession.setSnapshot({
        phase: 'open',
        message: null,
        processName: 'codex',
        aiCli: { provider: 'codex', status: 'waiting', updatedAt: 2 },
      })

      expect(getContext().aiCliBusyByGroup(groupKey)).toBe(false)
      expect(getContext().sessionSummaries(groupKey)[0]).toMatchObject({ aiCliBusy: false })
    } finally {
      await unmount()
    }
  })
```

- [ ] **Step 2: Run provider tests and verify failure**

Run:

```bash
bun run test src/renderer/components/terminal/TerminalSessionProvider.test.tsx
```

Expected: FAIL because `aiCliBusyByGroup`, `aiCli`, and `aiCliBusy` are not implemented.

- [ ] **Step 3: Implement summary busy derivation**

Modify imports in `src/renderer/components/terminal/TerminalSessionProvider.tsx`:

```ts
import { aiCliBusy } from '#/renderer/components/terminal/ai-cli-status.ts'
```

Update `sessionSummaries()` map result:

```ts
        const aiBusy = aiCliBusy(snapshot.aiCli)
        return {
          key: session.descriptor.key,
          groupKey,
          terminalId: session.descriptor.terminalId,
          index: session.descriptor.index,
          title: snapshot.processName || `terminal ${session.descriptor.index}`,
          phase: snapshot.phase,
          active: session.descriptor.key === activeKey,
          hasBell: bellController.hasBell(session.descriptor.key),
          aiCli: snapshot.aiCli ?? null,
          aiCliBusy: aiBusy,
        }
```

Add a context method:

```ts
  const aiCliBusyByGroup = useCallback((groupKey: string): boolean => {
    return Array.from(sessionsRef.current.values()).some((session) => {
      return session.descriptor.groupKey === groupKey && aiCliBusy(session.snapshot().aiCli)
    })
  }, [])
```

Add it to the context value object and dependency list:

```ts
      aiCliBusyByGroup,
```

- [ ] **Step 4: Update existing test fixtures**

In `src/renderer/components/RepoTabs.test.tsx`, add `aiCliBusyByGroup` to `terminalContext()`:

```ts
    aiCliBusyByGroup: () => false,
```

`RepoTabs.test.tsx` is the only non-provider test fixture currently constructing `TerminalSessionContextValue` directly.

- [ ] **Step 5: Run provider and repo tab tests**

Run:

```bash
bun run test src/renderer/components/terminal/TerminalSessionProvider.test.tsx src/renderer/components/RepoTabs.test.tsx
```

Expected: PASS.

## Task 4: Terminal List Spinner

**Files:**
- Modify: `src/renderer/components/terminal/TerminalSwitcher.tsx`
- Modify: `src/renderer/components/terminal/TerminalSwitcher.test.tsx`
- Modify: `src/renderer/components/terminal/terminal-session.css`

- [ ] **Step 1: Write failing TerminalSwitcher test**

Add `aiCliBusy: false` to existing session fixtures in `TerminalSwitcher.test.tsx`.

Add this test:

```ts
  test('shows a spinner only for AI-busy terminal rows', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)

    await act(async () => {
      root.render(
        <TerminalSwitcher
          groupKey="repo::worktree"
          offsetForSearch={false}
          sessions={[
            {
              key: 'terminal-1',
              groupKey: 'repo::worktree',
              terminalId: 'terminal-1',
              index: 1,
              title: 'codex',
              phase: 'open',
              active: true,
              hasBell: false,
              aiCli: { provider: 'codex', status: 'running', updatedAt: 1 },
              aiCliBusy: true,
            },
            {
              key: 'terminal-2',
              groupKey: 'repo::worktree',
              terminalId: 'terminal-2',
              index: 2,
              title: 'zsh',
              phase: 'open',
              active: false,
              hasBell: false,
              aiCliBusy: false,
            },
          ]}
          onNew={() => {}}
          onSelect={() => {}}
          onClose={() => {}}
        />,
      )
    })

    try {
      expect(container.querySelectorAll('.goblin-terminal-switcher__ai-spinner')).toHaveLength(1)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
```

- [ ] **Step 2: Run TerminalSwitcher test and verify failure**

Run:

```bash
bun run test src/renderer/components/terminal/TerminalSwitcher.test.tsx
```

Expected: FAIL because the spinner class is not rendered.

- [ ] **Step 3: Implement terminal row spinner**

Modify imports in `TerminalSwitcher.tsx`:

```ts
import { Loader2, Plus, Terminal as TerminalIcon, Trash2 } from 'lucide-react'
```

Replace the row icon:

```tsx
                  {session.aiCliBusy ? (
                    <Loader2 size={16} className="goblin-terminal-switcher__ai-spinner animate-spin" />
                  ) : (
                    <TerminalIcon size={16} />
                  )}
```

Add CSS only if the icon visually shifts:

```css
.goblin-terminal-switcher__ai-spinner {
  flex: 0 0 auto;
}
```

- [ ] **Step 4: Run TerminalSwitcher test**

Run:

```bash
bun run test src/renderer/components/terminal/TerminalSwitcher.test.tsx
```

Expected: PASS.

## Task 5: Worktree Row Spinner

**Files:**
- Modify: `src/renderer/components/BranchList.tsx`
- Modify: `src/renderer/components/branch-list/BranchRow.tsx`
- Modify: `src/renderer/components/BranchList.ui.test.tsx`

- [ ] **Step 1: Write failing BranchList UI test**

Import terminal context helpers in `src/renderer/components/BranchList.ui.test.tsx`:

```ts
import { TerminalSessionContext } from '#/renderer/components/terminal/terminal-session-context.ts'
import type { TerminalSessionContextValue, TerminalSnapshot } from '#/renderer/components/terminal/types.ts'
```

Add helper functions near the bottom:

```ts
function renderBranchList(repoId: string, terminalOverrides: Partial<TerminalSessionContextValue> = {}) {
  const snapshot: TerminalSnapshot = { phase: 'open', message: null, processName: 'terminal' }
  const terminalContext: TerminalSessionContextValue = {
    version: 0,
    ensureDefault: () => '',
    createTerminal: () => '',
    activeDescriptor: () => null,
    sessionSummaries: () => [],
    aiCliBusyByGroup: () => false,
    unreadBellCountByRepo: () => 0,
    setActive: () => {},
    clearBell: () => false,
    closeTerminalAndDismissDetailIfLast: () => [],
    attach: () => {},
    detach: () => {},
    restart: () => {},
    snapshot: () => snapshot,
    isTerminalFocusTarget: () => false,
    findNext: () => ({ resultIndex: -1, resultCount: 0, found: false }),
    findPrevious: () => ({ resultIndex: -1, resultCount: 0, found: false }),
    clearSearch: () => {},
    writeInput: () => {},
    serialize: () => '',
    ...terminalOverrides,
  }
  root.render(
    <TerminalSessionContext.Provider value={terminalContext}>
      <BranchList repoId={repoId} />
    </TerminalSessionContext.Provider>,
  )
}
```

Use this helper in the new test:

```ts
  test('shows a worktree spinner only when a worktree has active AI CLI work', async () => {
    const repo = emptyRepo('/repo', 'repo')
    repo.data.branches = [createBranch('main'), createBranch('feature/x', { worktreePath: '/repo-feature-x' })]
    repo.data.currentBranch = 'main'
    repo.ui.selectedBranch = 'main'
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
    })

    await act(async () => {
      renderBranchList(repo.id, {
        aiCliBusyByGroup: (groupKey) => groupKey === 'local\0/repo\0/repo-feature-x',
      })
    })

    expect(host.querySelectorAll('.goblin-branch-row__ai-spinner')).toHaveLength(1)
  })
```

Existing tests can continue rendering `<BranchList repoId={repo.id} />` directly because the implementation will treat missing terminal context as no AI work.

- [ ] **Step 2: Run BranchList UI test and verify failure**

Run:

```bash
bun run test src/renderer/components/BranchList.ui.test.tsx
```

Expected: FAIL because `goblin-branch-row__ai-spinner` is not rendered.

- [ ] **Step 3: Add worktree busy prop to BranchRow**

Modify imports in `src/renderer/components/branch-list/BranchRow.tsx`:

```ts
import { ArrowDown, ArrowUp, Check, FolderTree, GitBranch, Loader2 } from 'lucide-react'
```

Add prop:

```ts
  worktreeAiCliBusy?: boolean
```

Destructure with default:

```ts
  worktreeAiCliBusy = false,
```

Replace the icon selection:

```tsx
          {worktreeAiCliBusy ? (
            <Loader2 size={14} className="goblin-branch-row__ai-spinner animate-spin text-brand-text" />
          ) : isCurrent ? (
            <Check size={14} className="text-success" />
          ) : isWorktree ? (
            <FolderTree size={14} className={worktreeDirty ? 'text-attention' : 'text-brand-text'} />
          ) : (
            <GitBranch size={14} className={isSelected ? 'text-selected-muted-foreground' : 'text-muted-foreground'} />
          )}
```

This gives active AI work precedence over the normal current/worktree/branch icon in the row's leading slot.

- [ ] **Step 4: Compute worktree busy in BranchList**

Modify imports in `src/renderer/components/BranchList.tsx`:

```ts
import { useCallback, useContext, useEffect, useRef, useState, type ComponentProps, type ReactElement, type RefObject } from 'react'
import { TerminalSessionContext } from '#/renderer/components/terminal/terminal-session-context.ts'
import { terminalSessionGroupKey } from '#/renderer/components/terminal/terminal-session-utils.ts'
```

Inside `BranchRows`, before `return`, add:

```ts
  const terminalContext = useContext(TerminalSessionContext)
  const worktreeAiCliBusy = useCallback(
    (branch: RepoBranchState): boolean => {
      const worktreePath = branch.worktree?.path
      if (!worktreePath || !terminalContext) return false
      const groupKey = terminalSessionGroupKey(
        repo.kind === 'remote'
          ? { kind: 'remote', repoId: repo.id, worktreePath }
          : { kind: 'local', repoRoot: repo.id, worktreePath },
      )
      return terminalContext.aiCliBusyByGroup(groupKey)
    },
    [repo.id, repo.kind, terminalContext],
  )
```

Pass the prop to `BranchRow`:

```tsx
            worktreeAiCliBusy={worktreeAiCliBusy(branch)}
```

- [ ] **Step 5: Run BranchList UI test**

Run:

```bash
bun run test src/renderer/components/BranchList.ui.test.tsx
```

Expected: PASS.

## Task 6: Integration Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused terminal and branch tests**

Run:

```bash
bun run test \
  src/renderer/components/terminal/ai-cli-status.test.ts \
  src/renderer/components/terminal/ManagedTerminalSession.test.ts \
  src/renderer/components/terminal/TerminalSessionProvider.test.tsx \
  src/renderer/components/terminal/TerminalSwitcher.test.tsx \
  src/renderer/components/BranchList.ui.test.tsx \
  src/renderer/components/RepoTabs.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full unit suite**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript verification**

Run:

```bash
bun run typecheck
```

Expected: PASS.

## Self-Review

Spec coverage:

- Codex and Claude terminal-output detection: Task 1.
- Separate terminal lifecycle and AI CLI state: Tasks 2 and 3.
- Terminal list spinner from `aiCliBusy`: Task 4.
- Worktree row spinner from `aiCliBusy`: Task 5.
- Reset behavior on restart/exit: Task 2.
- Conservative parser and no spinner for unrelated shell output: Task 1.

Placeholder scan:

- No placeholder markers are intentionally left.

Type consistency:

- `AiCliExecutionState`, `aiCli`, and `aiCliBusy` are introduced in Task 1/2 and used consistently in later tasks.
- `aiCliBusyByGroup(groupKey)` is added to `TerminalSessionContextValue` in Task 2 and implemented in Task 3 before UI use in Task 5.
