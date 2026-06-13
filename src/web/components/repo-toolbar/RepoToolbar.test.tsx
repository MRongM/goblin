// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TopbarRepoControls } from '#/web/components/topbar/TopbarRepoControls.tsx'
import { MainWindowNavigationProvider, type MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore, seedRepoState, createRepoBranch } from '#/web/stores/repos/test-utils.ts'

const REPO_ID = '/tmp/gbl-topbar-controls-repo'

let container: HTMLDivElement | null = null
let root: Root | null = null
let queryClient: QueryClient | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  window.matchMedia = createMatchMedia(false)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  queryClient = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('TopbarRepoControls', () => {
  test('shows icon-only non-focus controls for an active repo', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
      currentBranch: 'main',
      selectedBranch: 'feature/a',
    })

    renderControls(navigationWith({}))

    expect(container?.querySelector('[aria-label="branches.filter-label"]')).not.toBeNull()
    expect(container?.querySelector('[aria-label="branches.search-label"]')).not.toBeNull()
    expect(container?.querySelector('button[aria-label="action.refresh"]')).not.toBeNull()
    expect(container?.querySelector('button[aria-label="action.create-worktree-title"]')).not.toBeNull()
    expect(container?.querySelector('[aria-label="workspace.layout-label"]')).not.toBeNull()
    expect(container?.textContent).not.toContain('action.refresh')
    expect(container?.textContent).not.toContain('action.create-worktree')
  })

  test('hides layout control in compact mode', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('main')],
      currentBranch: 'main',
      selectedBranch: 'main',
    })
    window.matchMedia = createMatchMedia(true)

    renderControls(navigationWith({}))

    expect(container?.querySelector('[aria-label="workspace.layout-label"]')).toBeNull()
  })

  test('shows focus-mode branch switcher and branch action menu', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
      currentBranch: 'main',
      selectedBranch: 'feature/a',
    })
    useReposStore.setState({ workspaceLayout: 'top-bottom', detailCollapsed: false, detailFocusMode: true })

    renderControls(navigationWith({}))

    expect(container?.querySelector('button[aria-label="branches.switch"]')).not.toBeNull()
    expect(container?.querySelector('button[aria-label="action.menu"]')).not.toBeNull()
    expect(container?.querySelector('[aria-label="branches.filter-label"]')).toBeNull()
    expect(container?.querySelector('[aria-label="branches.search-label"]')).toBeNull()
  })
})

function renderControls(navigation: MainWindowNavigationActions) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient()
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient!}>
        <MainWindowNavigationProvider value={navigation}>
          <TopbarRepoControls repoId={REPO_ID} />
        </MainWindowNavigationProvider>
      </QueryClientProvider>,
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

function createMatchMedia(small: boolean): typeof window.matchMedia {
  return vi.fn((query: string) => ({
    matches: query === '(max-width: 639px)' ? small : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia
}
