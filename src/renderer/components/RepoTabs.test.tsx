// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoTabs } from '#/renderer/components/RepoTabs.tsx'
import { TerminalSessionContext } from '#/renderer/components/terminal/terminal-session-context.ts'
import { resetReposStore, seedRepoState } from '#/renderer/stores/repos/test-utils.ts'
import type { TerminalSessionContextValue, TerminalSnapshot } from '#/renderer/components/terminal/types.ts'
import type { RepoTabSummary } from '#/renderer/components/repo-tabs/types.ts'

vi.mock('#/renderer/components/repo-tabs/RepoTabStrip.tsx', () => ({
  RepoTabStrip: ({ repos }: { repos: RepoTabSummary[] }) => (
    <div>
      {repos.map((repo) => (
        <div key={repo.id} data-repo-id={repo.id} data-unread-bells={repo.unreadBellCount ?? 0}>
          {repo.name}
        </div>
      ))}
    </div>
  ),
}))

const REPO_ID = '/tmp/repo-tabs-repo'
let root: Root | null = null
let container: HTMLDivElement | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  document.body.innerHTML = ''
  resetReposStore()
  seedRepoState({ id: REPO_ID, name: 'repo' })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('RepoTabs', () => {
  test('adds unread terminal bell counts to project tab summaries', () => {
    renderWithTerminalContext({
      unreadBellCountByRepo: (repoId) => (repoId === REPO_ID ? 2 : 0),
    })

    const tab = document.querySelector(`[data-repo-id="${REPO_ID}"]`)
    expect(tab?.getAttribute('data-unread-bells')).toBe('2')
  })
})

function renderWithTerminalContext(overrides: Partial<TerminalSessionContextValue>) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const context = terminalContext(overrides)
  act(() => {
    root!.render(
      <TerminalSessionContext.Provider value={context}>
        <RepoTabs onClone={() => {}} onAddRemote={() => {}} />
      </TerminalSessionContext.Provider>,
    )
  })
}

function terminalContext(overrides: Partial<TerminalSessionContextValue>): TerminalSessionContextValue {
  const snapshot: TerminalSnapshot = { phase: 'open', message: null, processName: 'terminal' }
  return {
    version: 0,
    ensureDefault: () => '',
    createTerminal: () => '',
    activeDescriptor: () => null,
    sessionSummaries: () => [],
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
    ...overrides,
  }
}
