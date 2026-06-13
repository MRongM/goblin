// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ProjectStatusPanel } from '#/web/components/repo-workspace/ProjectStatusPanel.tsx'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'

const REPO_ID = '/tmp/gbl-project-status-repo'
const WORKTREE_PATH = '/tmp/gbl-project-status-repo'

vi.mock('#/web/stores/i18n.ts', async () => {
  const actual = await vi.importActual<typeof import('#/web/stores/i18n.ts')>('#/web/stores/i18n.ts')
  return { ...actual, useT: () => (key: string) => key }
})

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('ProjectStatusPanel', () => {
  test('renders selected branch status in the explorer surface', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      statusLoaded: true,
      status: [{ path: WORKTREE_PATH, branch: 'feature/worktree', isMain: true, entries: [] }],
    })

    await act(async () => {
      root!.render(<ProjectStatusPanel repoId={REPO_ID} layout="top-bottom" />)
    })

    expect(container?.textContent).toContain('feature/worktree')
    expect(container?.textContent).toContain('branch-status.signal.branch')
    expect(container?.textContent).toContain('branch-status.signal.worktree')
  })
})
