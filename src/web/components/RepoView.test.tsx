// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoView } from '#/web/components/RepoView.tsx'
import { MainWindowNavigationProvider, type MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { resetReposStore, seedRepoState, createRepoBranch } from '#/web/stores/repos/test-utils.ts'

vi.mock('#/web/components/BranchDetail.tsx', () => ({
  BranchDetail: () => <div data-testid="branch-detail" />,
}))

vi.mock('#/web/components/repo-workspace/RepoExplorerPane.tsx', () => ({
  RepoExplorerPane: () => <div data-testid="repo-explorer-pane" />,
}))

const REPO_ID = '/tmp/gbl-repo-view-topbar-actions-repo'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === '(max-width: 639px)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia
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

describe('RepoView', () => {
  test('does not render repository toolbar controls inside the repository body', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
      currentBranch: 'main',
      selectedBranch: 'feature/a',
    })

    renderRepoView()

    expect(container?.querySelector('[aria-label="workspace.layout-label"]')).toBeNull()
    expect(container?.querySelector('[aria-label="branches.filter-label"]')).toBeNull()
    expect(container?.querySelector('[aria-label="branches.search-label"]')).toBeNull()
    expect(container?.querySelector('button[aria-label="action.create-worktree-title"]')).toBeNull()
  })
})

function renderRepoView() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <MainWindowNavigationProvider value={navigationWith({})}>
        <RepoView repoId={REPO_ID} />
      </MainWindowNavigationProvider>,
    )
  })
}

function navigationWith(overrides: Partial<MainWindowNavigationActions>): MainWindowNavigationActions {
  const base: MainWindowNavigationActions = {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoDetailTab: () => {},
    showRepoBranchDetailTab: () => {},
    openSettings: () => {},
  }
  return Object.assign(base, overrides)
}
