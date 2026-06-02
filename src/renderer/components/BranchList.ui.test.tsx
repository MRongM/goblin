/* @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchList } from '#/renderer/components/BranchList.tsx'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { createBranch, resetReposStore } from '#/renderer/stores/repos/test-utils.ts'
import { worktreeSourceKey } from '#/renderer/stores/repos/worktree-sources.ts'

const dndState = vi.hoisted(() => ({
  latestDragEnd: null as null | ((event: { active: { id: string }; over: { id: string } | null }) => void),
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: typeof dndState.latestDragEnd }) => {
    dndState.latestDragEnd = onDragEnd
    return <div data-dnd-context="branches">{children}</div>
  },
  PointerSensor: vi.fn(),
  closestCenter: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children, items }: { children: React.ReactNode; items: string[] }) => (
    <div data-sortable-items={items.join('|')}>{children}</div>
  ),
  useSortable: ({ id }: { id: string }) => ({
    attributes: { 'data-sortable-id': id },
    listeners: {},
    setActivatorNodeRef: vi.fn(),
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: {},
}))

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useI18nStore: (selector: any) => selector({ lang: 'en' }),
  useT: () => (key: string) => key,
}))

describe('BranchList remote snapshot failure', () => {
  let host: HTMLDivElement
  let root: Root
  let originalRefreshSnapshot: ReturnType<typeof useReposStore.getState>['refreshSnapshot']
  let originalRefreshRemoteDiagnostics: ReturnType<typeof useReposStore.getState>['refreshRemoteDiagnostics']
  let originalReorderBranches: ReturnType<typeof useReposStore.getState>['reorderBranches']

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView = vi.fn()
    dndState.latestDragEnd = null
    resetReposStore()
    const state = useReposStore.getState()
    originalRefreshSnapshot = state.refreshSnapshot
    originalRefreshRemoteDiagnostics = state.refreshRemoteDiagnostics
    originalReorderBranches = state.reorderBranches
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ''
    resetReposStore()
    useReposStore.setState({
      refreshSnapshot: originalRefreshSnapshot,
      refreshRemoteDiagnostics: originalRefreshRemoteDiagnostics,
      reorderBranches: originalReorderBranches,
    })
  })

  test('retries only the remote snapshot resource from the empty state', async () => {
    const repo = emptyRepo('ssh://deploy@prod:22/srv/goblin', 'prod:goblin', {
      kind: 'remote',
      remoteTarget: {
        id: 'ssh://deploy@prod:22/srv/goblin',
        alias: 'prod',
        host: 'prod',
        user: 'deploy',
        port: 22,
        remotePath: '/srv/goblin',
        displayName: 'prod:goblin',
      },
    })
    repo.resources.snapshot.error = 'error.failed-read-repo'
    const refreshSnapshot = vi.fn()
    const refreshRemoteDiagnostics = vi.fn()
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
      refreshSnapshot,
      refreshRemoteDiagnostics,
    })

    await act(async () => {
      root.render(<BranchList repoId={repo.id} />)
    })

    expect(host.textContent).toContain('error.failed-read-repo')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(refreshSnapshot).toHaveBeenCalledWith(repo.id, { token: repo.instanceToken })
    expect(refreshRemoteDiagnostics).not.toHaveBeenCalled()
  })

  test('reorders branches when a sortable row is dropped over another row', async () => {
    const repo = emptyRepo('/repo', 'repo')
    repo.data.branches = [createBranch('main'), createBranch('feature/a'), createBranch('feature/b')]
    repo.ui.selectedBranch = 'main'
    const reorderBranches = vi.fn()
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
      reorderBranches,
    })

    await act(async () => {
      root.render(<BranchList repoId={repo.id} />)
    })

    expect(dndState.latestDragEnd).toBeTypeOf('function')

    await act(async () => {
      dndState.latestDragEnd?.({ active: { id: 'feature/b' }, over: { id: 'main' } })
    })

    expect(reorderBranches).toHaveBeenCalledWith(repo.id, 'feature/b', 'main')
  })

  test('shows the reordered branch order immediately after drop', async () => {
    const repo = emptyRepo('/repo', 'repo')
    repo.data.branches = [createBranch('main'), createBranch('feature/a'), createBranch('feature/b')]
    repo.ui.selectedBranch = 'main'
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
    })

    await act(async () => {
      root.render(<BranchList repoId={repo.id} />)
    })

    await act(async () => {
      dndState.latestDragEnd?.({ active: { id: 'feature/b' }, over: { id: 'main' } })
    })

    expect(
      Array.from(host.querySelectorAll<HTMLElement>('[data-sortable-id]')).map((row) =>
        row.getAttribute('data-sortable-id'),
      ),
    ).toEqual(['feature/b', 'main', 'feature/a'])
  })

  test('updates worktree source labels when source metadata changes', async () => {
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
      root.render(<BranchList repoId={repo.id} />)
    })

    expect(host.textContent).not.toContain('branches.source-exact')

    await act(async () => {
      useReposStore.setState((s) => ({
        worktreeSourcesByRepo: {
          ...s.worktreeSourcesByRepo,
          [repo.id]: {
            [worktreeSourceKey('feature/x', '/repo-feature-x')]: {
              branch: 'feature/x',
              worktreePath: '/repo-feature-x',
              sourceBranch: 'main',
              confidence: 'exact',
              updatedAt: 100,
            },
          },
        },
      }))
    })

    expect(host.textContent).toContain('branches.source-exact')
  })
})
