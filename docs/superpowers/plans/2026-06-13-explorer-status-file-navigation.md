# Explorer Status and File Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Status into the file explorer area, make changed-file rows reveal their path in the file tree, and make directory rows expand or collapse from the full row hit target.

**Architecture:** Keep file-related browsing state in `RepoExplorerPane` and terminal state in `BranchDetail`. Use a small reveal-request value to connect `ProjectChangesPanel` to `ProjectFileTree` without imperative cross-component refs. Preserve existing store compatibility for legacy `status` / `changes` detail-tab values while removing Status from the rendered right-side detail surface.

**Tech Stack:** Bun, TypeScript strip-only mode, React 19, Zustand, Vitest, jsdom, existing shadcn/Radix primitives, lucide-react.

---

## Safety And Scope

This plan intentionally uses no `git commit` steps. The repository instructions say not to plan or execute commits unless the user explicitly asks. Each task ends with a no-commit checkpoint using `git diff` or targeted tests.

The scope is renderer-focused. Do not change Git mutation code, Electron main-process code, or server file-tree APIs unless an existing test proves a missing boundary.

## File Structure

Create:

- `src/web/components/repo-workspace/ProjectStatusPanel.tsx` — explorer-owned wrapper around the existing `BranchStatus` presentation.
- `src/web/components/repo-workspace/ProjectStatusPanel.test.tsx` — focused test for the explorer status panel.

Modify:

- `src/web/components/repo-workspace/RepoExplorerPane.tsx` — add `status` explorer tab and own reveal-request state.
- `src/web/components/repo-workspace/RepoExplorerPane.test.tsx` — assert three explorer tabs and status rendering.
- `src/web/components/repo-workspace/ProjectChangesPanel.tsx` — accept `onRevealPath` and pass it to `StatusList`.
- `src/web/components/repo-workspace/ProjectChangesPanel.test.tsx` — assert changed-file click calls the reveal callback.
- `src/web/components/StatusList.tsx` — make rows optionally clickable via `onPathClick`.
- `src/web/components/file-tree/ProjectFileTree.tsx` — accept reveal requests, reveal by lazy-loading parents, select and scroll target paths, and toggle directories on row click.
- `src/web/components/file-tree/ProjectFileTree.test.tsx` — cover reveal and row-click expansion.
- `src/web/components/branch-detail/BranchDetailContent.tsx` — remove status content from the right-side detail panel.
- `src/web/components/branch-detail/BranchDetailToolbar.tsx` — stop rendering the status tab button and keep terminal controls.
- `src/web/components/branch-detail/BranchDetailToolbar.test.tsx` — assert status tab is absent and terminal actions still work.
- `src/web/lib/detail-tabs.ts` — keep compatibility helpers safe when the only rendered detail surface is terminal.
- `src/web/stores/repos/selection.test.ts` and other failing tests only if targeted test output shows legacy expectations that must be updated.

## Task 1: Add Status To Explorer Tabs

**Files:**
- Create: `src/web/components/repo-workspace/ProjectStatusPanel.tsx`
- Create: `src/web/components/repo-workspace/ProjectStatusPanel.test.tsx`
- Modify: `src/web/components/repo-workspace/RepoExplorerPane.tsx`
- Modify: `src/web/components/repo-workspace/RepoExplorerPane.test.tsx`

- [ ] **Step 1: Write the failing explorer tab test**

In `src/web/components/repo-workspace/RepoExplorerPane.test.tsx`, extend the existing mocks:

```ts
vi.mock('#/web/components/repo-workspace/ProjectStatusPanel.tsx', () => ({
  ProjectStatusPanel: () => <div data-testid="project-status-panel" />,
}))
```

Update the tab-switching test to expect three tabs:

```ts
const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
expect(tabs.map((tab) => tab.textContent)).toEqual(['file-tree.title', 'tab.changes', 'tab.status'])
expect(container.querySelector('[data-testid="project-file-tree"]')).toBeTruthy()

await act(async () => {
  tabs[2]?.click()
})

expect(container.querySelector('[data-testid="project-file-tree"]')).toBeNull()
expect(container.querySelector('[data-testid="project-changes-panel"]')).toBeNull()
expect(container.querySelector('[data-testid="project-status-panel"]')).toBeTruthy()
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```sh
bun run test src/web/components/repo-workspace/RepoExplorerPane.test.tsx
```

Expected: FAIL because `ProjectStatusPanel` does not exist and `RepoExplorerPane` only renders two tabs.

- [ ] **Step 3: Add `ProjectStatusPanel`**

Create `src/web/components/repo-workspace/ProjectStatusPanel.tsx`:

```tsx
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { BranchStatus } from '#/web/components/branch-detail/BranchStatus.tsx'
import type { BranchDetailRepo } from '#/web/components/branch-detail/model.ts'
import { getSelectedBranchDetailPresentation } from '#/web/components/branch-detail/model.ts'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'

interface ProjectStatusPanelProps {
  repoId: string
  layout: RepoWorkspaceLayout
}

function projectStatusRepoEqual(a: BranchDetailRepo | undefined, b: BranchDetailRepo | undefined): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.instanceToken === b.instanceToken &&
      a.data.branches === b.data.branches &&
      a.data.currentBranch === b.data.currentBranch &&
      a.data.status === b.data.status &&
      a.data.statusLoaded === b.data.statusLoaded &&
      a.data.worktreesByPath === b.data.worktreesByPath &&
      a.ui.selectedBranch === b.ui.selectedBranch &&
      a.ui.detailTab === b.ui.detailTab &&
      a.resources.status === b.resources.status &&
      a.resources.pullRequests === b.resources.pullRequests &&
      a.operations.branchAction === b.operations.branchAction &&
      a.operations.fetch === b.operations.fetch &&
      a.operations.manualRefresh === b.operations.manualRefresh &&
      a.remote.target === b.remote.target &&
      a.remote.hasRemotes === b.remote.hasRemotes &&
      a.remote.hasBrowserRemote === b.remote.hasBrowserRemote &&
      a.remote.hasGitHubRemote === b.remote.hasGitHubRemote &&
      a.remote.browserRemoteProvider === b.remote.browserRemoteProvider &&
      a.remote.remoteProviders === b.remote.remoteProviders)
  )
}

export function ProjectStatusPanel({ repoId, layout }: ProjectStatusPanelProps) {
  const t = useT()
  const repo = useStoreWithEqualityFn(
    useReposStore,
    (state) => {
      const repo = state.repos[repoId]
      return repo
        ? {
            id: repo.id,
            instanceToken: repo.instanceToken,
            data: {
              branches: repo.data.branches,
              currentBranch: repo.data.currentBranch,
              status: repo.data.status,
              statusLoaded: repo.data.statusLoaded,
              worktreesByPath: repo.data.worktreesByPath,
            },
            ui: {
              selectedBranch: repo.ui.selectedBranch,
              detailTab: repo.ui.detailTab,
            },
            resources: {
              status: repo.resources.status,
              pullRequests: repo.resources.pullRequests,
            },
            operations: {
              branchAction: repo.operations.branchAction,
              fetch: repo.operations.fetch,
              manualRefresh: repo.operations.manualRefresh,
            },
            remote: {
              target: repo.remote.target,
              hasRemotes: repo.remote.hasRemotes,
              hasBrowserRemote: repo.remote.hasBrowserRemote,
              hasGitHubRemote: repo.remote.hasGitHubRemote,
              browserRemoteProvider: repo.remote.browserRemoteProvider,
              remoteProviders: repo.remote.remoteProviders,
            },
          }
        : undefined
    },
    projectStatusRepoEqual,
  )

  if (!repo) return null
  const detail = getSelectedBranchDetailPresentation(repo)
  if (!detail.branch) {
    return <EmptyState title={t(repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty')} />
  }

  return (
    <ScrollPane>
      <BranchStatus detail={detail} layout={layout} />
    </ScrollPane>
  )
}
```

- [ ] **Step 4: Wire the third explorer tab**

In `src/web/components/repo-workspace/RepoExplorerPane.tsx`, import the new panel and change the tab type:

```tsx
import { ProjectStatusPanel } from '#/web/components/repo-workspace/ProjectStatusPanel.tsx'

type ExplorerTab = 'files' | 'changes' | 'status'
```

Add the third tab:

```tsx
const tabs = [
  { id: 'files' as const, label: t('file-tree.title') },
  { id: 'changes' as const, label: t('tab.changes') },
  { id: 'status' as const, label: t('tab.status') },
]
```

Render the active panel with a simple branch:

```tsx
{activeTab === 'files' ? (
  <ProjectFileTree repoId={repoId} />
) : activeTab === 'changes' ? (
  <ProjectChangesPanel repoId={repoId} />
) : (
  <ProjectStatusPanel repoId={repoId} layout={layout} />
)}
```

Pass `layout` into `ExplorerTabs` from `RepoExplorerPane` and include it in the `ExplorerTabs` prop type.

- [ ] **Step 5: Add a direct status panel test**

Create `src/web/components/repo-workspace/ProjectStatusPanel.test.tsx`:

```tsx
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
```

- [ ] **Step 6: Run focused tests**

Run:

```sh
bun run test src/web/components/repo-workspace/RepoExplorerPane.test.tsx src/web/components/repo-workspace/ProjectStatusPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: No-commit checkpoint**

Run:

```sh
git diff -- src/web/components/repo-workspace/RepoExplorerPane.tsx src/web/components/repo-workspace/RepoExplorerPane.test.tsx src/web/components/repo-workspace/ProjectStatusPanel.tsx src/web/components/repo-workspace/ProjectStatusPanel.test.tsx
```

Expected: only explorer tab and status-panel changes.

## Task 2: Make Changed-File Rows Emit Reveal Requests

**Files:**
- Modify: `src/web/components/StatusList.tsx`
- Modify: `src/web/components/repo-workspace/ProjectChangesPanel.tsx`
- Modify: `src/web/components/repo-workspace/ProjectChangesPanel.test.tsx`
- Modify: `src/web/components/repo-workspace/RepoExplorerPane.tsx`

- [ ] **Step 1: Write the failing changes-panel callback test**

In `src/web/components/repo-workspace/ProjectChangesPanel.test.tsx`, add:

```tsx
test('notifies when a changed file is clicked', async () => {
  const onRevealPath = vi.fn()
  seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    selectedBranch: 'feature/worktree',
    statusLoaded: true,
    status: [
      {
        path: WORKTREE_PATH,
        branch: 'feature/worktree',
        isMain: true,
        entries: [{ x: 'M', y: ' ', path: 'src/app.ts' }],
      },
    ],
  })

  await act(async () => {
    root!.render(<ProjectChangesPanel repoId={REPO_ID} onRevealPath={onRevealPath} />)
  })

  const pathButton = container?.querySelector<HTMLButtonElement>('button[aria-label="src/app.ts"]')
  expect(pathButton).toBeTruthy()

  await act(async () => {
    pathButton?.click()
  })

  expect(onRevealPath).toHaveBeenCalledWith('src/app.ts')
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```sh
bun run test src/web/components/repo-workspace/ProjectChangesPanel.test.tsx
```

Expected: FAIL because `ProjectChangesPanel` does not accept `onRevealPath`, and `StatusList` rows are not clickable.

- [ ] **Step 3: Add optional row-click support to `StatusList`**

In `src/web/components/StatusList.tsx`, extend props:

```ts
interface Props {
  status: WorktreeStatus[]
  emptyTitleKey?: string
  emptyBodyKey?: string
  onPathClick?: (path: string) => void
}
```

Change the function signature:

```tsx
export function StatusList({
  status,
  emptyTitleKey = 'status.clean-title',
  emptyBodyKey = 'status.clean-body',
  onPathClick,
}: Props) {
```

Replace the file-path cell with:

```tsx
{onPathClick ? (
  <button
    type="button"
    aria-label={entry.path}
    onClick={() => onPathClick(entry.path)}
    className="min-w-0 truncate text-left text-foreground hover:text-brand-text"
  >
    <FilePathText path={entry.path} />
  </button>
) : (
  <FilePathText path={entry.path} />
)}
```

Keep the status code column and list structure unchanged.

- [ ] **Step 4: Pass the callback through `ProjectChangesPanel`**

In `src/web/components/repo-workspace/ProjectChangesPanel.tsx`, change the component signature:

```tsx
export function ProjectChangesPanel({
  repoId,
  onRevealPath,
}: {
  repoId: string
  onRevealPath?: (relativePath: string) => void
}) {
```

Pass the callback into `ProjectChangesContent`:

```tsx
<ProjectChangesContent
  repo={repo}
  branch={detail.branch}
  selectedStatus={detail.selectedStatus}
  statusLoading={detail.loading.status}
  statusError={detail.errors.status}
  statusStale={detail.stale.status}
  onRevealPath={onRevealPath}
/>
```

Extend `ProjectChangesContent` props and pass it to both `StatusList` render paths:

```tsx
onRevealPath?: (relativePath: string) => void
```

```tsx
<StatusList status={selectedStatus} onPathClick={onRevealPath} />
```

- [ ] **Step 5: Own reveal-request state in `RepoExplorerPane`**

In `src/web/components/repo-workspace/RepoExplorerPane.tsx`, add:

```tsx
interface FileTreeRevealRequest {
  id: number
  relativePath: string
}
```

In `ExplorerTabs`, add state:

```tsx
const [revealRequest, setRevealRequest] = useState<FileTreeRevealRequest | null>(null)

function handleRevealPath(relativePath: string) {
  setActiveTab('files')
  setRevealRequest((current) => ({ id: (current?.id ?? 0) + 1, relativePath }))
}
```

Render:

```tsx
{activeTab === 'files' ? (
  <ProjectFileTree repoId={repoId} revealRequest={revealRequest} />
) : activeTab === 'changes' ? (
  <ProjectChangesPanel repoId={repoId} onRevealPath={handleRevealPath} />
) : (
  <ProjectStatusPanel repoId={repoId} layout={layout} />
)}
```

- [ ] **Step 6: Add a lightweight explorer integration assertion**

In `RepoExplorerPane.test.tsx`, update the `ProjectFileTree` mock to expose the reveal request:

```tsx
vi.mock('#/web/components/file-tree/ProjectFileTree.tsx', () => ({
  ProjectFileTree: ({ revealRequest }: { revealRequest?: { relativePath: string } | null }) => (
    <div data-testid="project-file-tree" data-reveal-path={revealRequest?.relativePath ?? ''} />
  ),
}))
```

Update the `ProjectChangesPanel` mock to click through:

```tsx
vi.mock('#/web/components/repo-workspace/ProjectChangesPanel.tsx', () => ({
  ProjectChangesPanel: ({ onRevealPath }: { onRevealPath?: (path: string) => void }) => (
    <button type="button" data-testid="project-changes-panel" onClick={() => onRevealPath?.('src/app.ts')}>
      changes
    </button>
  ),
}))
```

Add:

```tsx
test('changed file clicks switch back to files with a reveal request', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<RepoExplorerPane repoId="/repo" layout="top-bottom" showActions />)
  })

  const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  await act(async () => {
    tabs[1]?.click()
  })
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="project-changes-panel"]')?.click()
  })

  expect(container.querySelector('[data-testid="project-file-tree"]')?.getAttribute('data-reveal-path')).toBe('src/app.ts')
  await act(async () => root.unmount())
})
```

- [ ] **Step 7: Run focused tests**

Run:

```sh
bun run test src/web/components/repo-workspace/ProjectChangesPanel.test.tsx src/web/components/repo-workspace/RepoExplorerPane.test.tsx
```

Expected: PASS.

- [ ] **Step 8: No-commit checkpoint**

Run:

```sh
git diff -- src/web/components/StatusList.tsx src/web/components/repo-workspace/ProjectChangesPanel.tsx src/web/components/repo-workspace/ProjectChangesPanel.test.tsx src/web/components/repo-workspace/RepoExplorerPane.tsx src/web/components/repo-workspace/RepoExplorerPane.test.tsx
```

Expected: only callback plumbing and explorer reveal-request state.

## Task 3: Reveal Paths In The File Tree

**Files:**
- Modify: `src/web/components/file-tree/ProjectFileTree.tsx`
- Modify: `src/web/components/file-tree/ProjectFileTree.test.tsx`

- [ ] **Step 1: Write the failing reveal test**

In `src/web/components/file-tree/ProjectFileTree.test.tsx`, replace the `getRepositoryFileTree` mock body with a dir-path-aware implementation:

```ts
const getRepositoryFileTree = vi.fn(async (_repoId: string, _worktreePath: string, dirPath: string) => ({
  ok: true as const,
  worktreePath: '/repo',
  dirPath,
  entries:
    dirPath === '/repo/src'
      ? [{ name: 'app.ts', absolutePath: '/repo/src/app.ts', relativePath: 'src/app.ts', kind: 'file' as const }]
      : [
          { name: 'src', absolutePath: '/repo/src', relativePath: 'src', kind: 'directory' as const },
          { name: 'README.md', absolutePath: '/repo/README.md', relativePath: 'README.md', kind: 'file' as const },
        ],
}))
```

Add:

```tsx
test('reveals a requested changed file by expanding parents and selecting the file', async () => {
  seedRepoWithSelectedBranch({ hasWorktree: true })

  await render(<ProjectFileTree repoId="/repo" revealRequest={{ id: 1, relativePath: 'src/app.ts' }} />)

  expect(getRepositoryFileTree).toHaveBeenCalledWith('/repo', '/repo', '/repo/src', undefined)
  const row = treeItemByText('app.ts')
  expect(row.getAttribute('aria-selected')).toBe('true')
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```sh
bun run test src/web/components/file-tree/ProjectFileTree.test.tsx
```

Expected: FAIL because `ProjectFileTree` does not accept `revealRequest` and does not reveal nested paths.

- [ ] **Step 3: Add reveal-request types and refs**

In `src/web/components/file-tree/ProjectFileTree.tsx`, add:

```tsx
export interface FileTreeRevealRequest {
  id: number
  relativePath: string
}
```

Change the component signature:

```tsx
export function ProjectFileTree({
  repoId,
  revealRequest,
}: {
  repoId: string
  revealRequest?: FileTreeRevealRequest | null
}) {
```

Add refs after state declarations:

```tsx
const directoriesRef = useRef<Record<string, DirectoryState>>({})
const revealRequestRef = useRef<number | null>(null)
```

Keep the ref synchronized:

```tsx
useEffect(() => {
  directoriesRef.current = directories
}, [directories])
```

- [ ] **Step 4: Make directory loading return the read result**

Import `RepoFileTreeResult`:

```tsx
import {
  GOBLIN_FILE_PATHS_MIME,
  type RepoFileTreeEntry,
  type RepoFileTreeResult,
} from '#/shared/file-tree.ts'
```

Change `loadDirectory` to return the result:

```tsx
const loadDirectory = useCallback(
  async (relativePath: string, absolutePath: string, signal?: AbortSignal): Promise<RepoFileTreeResult | null> => {
    if (!worktreePath) return null
    setDirectories((current) => ({
      ...current,
      [relativePath]: { ...current[relativePath], loading: true, error: null },
    }))
    const result = await getRepositoryFileTree(repoId, worktreePath, absolutePath, signal)
    if (signal?.aborted || activeWorktreeRef.current !== worktreePath) return null
    setDirectories((current) => {
      const next = {
        ...current,
        [relativePath]: result.ok
          ? { entries: result.entries, loading: false, error: null }
          : { ...current[relativePath], loading: false, error: result.message },
      }
      directoriesRef.current = next
      return next
    })
    return result
  },
  [repoId, worktreePath],
)
```

- [ ] **Step 5: Add reveal helpers**

Add helper functions near `parentPath`:

```tsx
function pathParts(relativePath: string): string[] {
  return relativePath.split('/').filter((part) => part.length > 0)
}

function parentRelativePaths(relativePath: string): string[] {
  const parts = pathParts(relativePath)
  const parents: string[] = []
  for (let i = 1; i < parts.length; i += 1) {
    parents.push(parts.slice(0, i).join('/'))
  }
  return parents
}

function findEntry(entries: RepoFileTreeEntry[] | undefined, relativePath: string): RepoFileTreeEntry | null {
  return entries?.find((entry) => entry.relativePath === relativePath) ?? null
}

function fileTreeNodeSelector(id: string): string {
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/"/g, '\\"')
  return `[data-file-tree-node-id="${escaped}"]`
}
```

- [ ] **Step 6: Add the reveal effect**

Inside `ProjectFileTree`, after `rootState`, add:

```tsx
useEffect(() => {
  if (!worktreePath || !revealRequest) return
  if (revealRequestRef.current === revealRequest.id) return
  revealRequestRef.current = revealRequest.id
  let cancelled = false

  async function reveal() {
    if (!worktreePath) return
    const parents = parentRelativePaths(revealRequest.relativePath)
    let parentRelativePath = ROOT_DIR
    let parentAbsolutePath = worktreePath

    if (!directoriesRef.current[ROOT_DIR]?.entries && !directoriesRef.current[ROOT_DIR]?.loading) {
      await loadDirectory(ROOT_DIR, worktreePath)
    }

    for (const directoryRelativePath of parents) {
      if (cancelled) return
      const entry = findEntry(directoriesRef.current[parentRelativePath]?.entries, directoryRelativePath)
      if (!entry) return
      setExpandedDirs((current) => new Set(current).add(entry.relativePath))
      if (!directoriesRef.current[entry.relativePath]?.entries && !directoriesRef.current[entry.relativePath]?.loading) {
        await loadDirectory(entry.relativePath, entry.absolutePath)
      }
      parentRelativePath = entry.relativePath
      parentAbsolutePath = entry.absolutePath
    }

    void parentAbsolutePath
    const finalEntry = findEntry(directoriesRef.current[parentRelativePath]?.entries, revealRequest.relativePath)
    const targetId = finalEntry ? revealRequest.relativePath : `virtual:${revealRequest.relativePath}`
    if (cancelled) return
    setSelection({ selected: new Set([targetId]), anchor: targetId })
    requestAnimationFrame(() => {
      document
        .querySelector(fileTreeNodeSelector(targetId))
        ?.scrollIntoView({ block: 'nearest' })
    })
  }

  void reveal()
  return () => {
    cancelled = true
  }
}, [loadDirectory, revealRequest, worktreePath])
```

Add the node id attribute to the row:

```tsx
data-file-tree-node-id={node.id}
```

- [ ] **Step 7: Run the focused test**

Run:

```sh
bun run test src/web/components/file-tree/ProjectFileTree.test.tsx
```

Expected: PASS.

- [ ] **Step 8: No-commit checkpoint**

Run:

```sh
git diff -- src/web/components/file-tree/ProjectFileTree.tsx src/web/components/file-tree/ProjectFileTree.test.tsx
```

Expected: only reveal-request support and tests.

## Task 4: Expand Directories From Full Row Click

**Files:**
- Modify: `src/web/components/file-tree/ProjectFileTree.tsx`
- Modify: `src/web/components/file-tree/ProjectFileTree.test.tsx`

- [ ] **Step 1: Write failing row-click tests**

In `src/web/components/file-tree/ProjectFileTree.test.tsx`, add:

```tsx
test('clicking a directory row selects and expands it', async () => {
  seedRepoWithSelectedBranch({ hasWorktree: true })

  await render(<ProjectFileTree repoId="/repo" />)

  const row = treeItemByText('src')
  await act(async () => {
    row.click()
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(row.getAttribute('aria-selected')).toBe('true')
  expect(container?.textContent).toContain('app.ts')
})

test('clicking the chevron toggles a directory exactly once', async () => {
  seedRepoWithSelectedBranch({ hasWorktree: true })

  await render(<ProjectFileTree repoId="/repo" />)

  const chevron = container?.querySelector<HTMLButtonElement>('button[aria-label="Toggle src"]')
  await act(async () => {
    chevron?.click()
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(container?.textContent).toContain('app.ts')
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```sh
bun run test src/web/components/file-tree/ProjectFileTree.test.tsx
```

Expected: first new test FAILS because row click selects but does not expand. The chevron test should already pass or keep passing after implementation.

- [ ] **Step 3: Toggle expandable nodes from row clicks**

In `FileTreeRow`, replace:

```tsx
onClick={(event) => onSelect(node, event)}
```

with:

```tsx
onClick={(event) => {
  onSelect(node, event)
  if (expandable) onToggle(node)
}}
```

Keep the chevron button handler unchanged:

```tsx
onClick={(event) => {
  event.stopPropagation()
  onToggle(node)
}}
```

- [ ] **Step 4: Run the focused test**

Run:

```sh
bun run test src/web/components/file-tree/ProjectFileTree.test.tsx
```

Expected: PASS.

- [ ] **Step 5: No-commit checkpoint**

Run:

```sh
git diff -- src/web/components/file-tree/ProjectFileTree.tsx src/web/components/file-tree/ProjectFileTree.test.tsx
```

Expected: only row-click expansion changes beyond Task 3 changes.

## Task 5: Make Branch Detail Terminal-Focused

**Files:**
- Modify: `src/web/components/branch-detail/BranchDetailContent.tsx`
- Modify: `src/web/components/branch-detail/BranchDetailToolbar.tsx`
- Modify: `src/web/components/branch-detail/BranchDetailToolbar.test.tsx`
- Modify: `src/web/lib/detail-tabs.ts`
- Modify: targeted store/navigation tests if they fail because they explicitly expected a visible right-side status tab.

- [ ] **Step 1: Write the failing toolbar test**

In `src/web/components/branch-detail/BranchDetailToolbar.test.tsx`, add:

```tsx
test('does not render a status detail tab', async () => {
  const { container, root } = await renderToolbar({ detailTab: 'status' })
  expect(container.textContent).not.toContain('tab.status')
  expect(container.querySelector(`[role="tab"][id$="-status-tab"]`)).toBeNull()
  await act(async () => root.unmount())
})
```

Use the existing local `renderToolbar` helper in that test file.

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```sh
bun run test src/web/components/branch-detail/BranchDetailToolbar.test.tsx
```

Expected: FAIL because the toolbar still renders the Status tab.

- [ ] **Step 3: Remove status rendering from `BranchDetailContent`**

In `src/web/components/branch-detail/BranchDetailContent.tsx`, remove unused imports:

```tsx
import { useEffect, type ReactNode } from 'react'
import { EmptyState } from '#/web/components/Layout.tsx'
import { TerminalSlot } from '#/web/components/terminal/TerminalSlot.tsx'
```

Remove `ScrollPane`, `BranchStatus`, and `layout` use from content rendering. Keep the prop for compatibility if callers still pass it, or remove it from `Props` and call sites if typecheck shows no other dependency.

Replace the content branch with:

```tsx
return (
  <div id={contentId} className="flex min-h-0 flex-1 flex-col">
    {activeTab === 'terminal' && branch.worktree?.path && (
      <BranchTerminalTab detailId={detailId} repoId={repo.id} branch={branch} />
    )}
  </div>
)
```

Delete `BranchStatusTab`.

- [ ] **Step 4: Remove status tab rendering from `BranchDetailToolbar`**

In `src/web/components/branch-detail/BranchDetailToolbar.tsx`, remove imports that only support the status tab:

```tsx
import type { KeyboardEvent } from 'react'
import { detailTabNavigationKey, navigatedDetailTab, visibleDetailTabs } from '#/web/lib/detail-tabs.ts'
```

Delete:

```tsx
const tabs = visibleDetailTabs(!!detail.branch?.worktree?.path)
const detailTabFocusRegistry = useFocusRegistry<'status', HTMLButtonElement>()
function focusDetailTab(tabId: 'status') { ... }
function handleTabKeyDown(...) { ... }
```

Remove the status-tab `<div role="tablist">...</div>` block. Keep the outer toolbar, terminal tab group, focus/collapse controls, and terminal callbacks.

Update `TerminalTabs` `onNavigateOut` to keep terminal focus when there is a terminal session:

```tsx
onNavigateOut={() => {
  navigation.showRepoDetailTab(repo.id, 'terminal')
  setDetailCollapsed(false)
  focusTerminalTab()
}}
```

- [ ] **Step 5: Keep detail-tab helpers compatible**

In `src/web/lib/detail-tabs.ts`, keep `DetailTab` compatibility but make visible detail tabs terminal-only:

```ts
export const DETAIL_TABS = [
  { id: 'terminal', labelKey: 'tab.terminal' },
] as const satisfies readonly { id: DetailTab; labelKey: string }[]

export function visibleDetailTabs(hasWorktree: boolean) {
  return hasWorktree ? DETAIL_TABS : []
}

export function detailTabForWorktree(tab: DetailTab, hasWorktree: boolean): DetailTab {
  if (tab === 'terminal') return hasWorktree ? 'terminal' : 'status'
  return 'status'
}

export function navigatedDetailTab(current: DetailTab, key: DetailTabNavigationKey, hasWorktree = true): DetailTab {
  const tabs = visibleDetailTabs(hasWorktree)
  if (tabs.length === 0) return 'status'
  const visibleCurrent = detailTabForWorktree(current, hasWorktree)
  const index = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === visibleCurrent),
  )
  const next =
    key === 'ArrowRight'
      ? (index + 1) % tabs.length
      : key === 'ArrowLeft'
        ? (index - 1 + tabs.length) % tabs.length
        : key === 'Home'
          ? 0
          : tabs.length - 1
  return tabs[next].id
}
```

This keeps old `status` and `changes` values valid as inactive persisted states while preventing them from rendering in the right-side surface.

- [ ] **Step 6: Run focused tests and update only broken expectations**

Run:

```sh
bun run test src/web/components/branch-detail/BranchDetailToolbar.test.tsx src/web/stores/repos/selection.test.ts src/web/hooks/useKeyboard.test.tsx src/web/commands/workspace-commands.test.ts
```

Expected: PASS after updating assertions that expected `status` to be a visible right-side tab. Do not remove tests that verify terminal remains valid only for branches with worktrees.

- [ ] **Step 7: No-commit checkpoint**

Run:

```sh
git diff -- src/web/components/branch-detail/BranchDetailContent.tsx src/web/components/branch-detail/BranchDetailToolbar.tsx src/web/components/branch-detail/BranchDetailToolbar.test.tsx src/web/lib/detail-tabs.ts src/web/stores/repos/selection.test.ts src/web/hooks/useKeyboard.test.tsx src/web/commands/workspace-commands.test.ts
```

Expected: right-side detail surface is terminal-focused; compatibility tests still protect legacy `status` and `changes` values.

## Task 6: Final Verification

**Files:**
- Verify changed files only.

- [ ] **Step 1: Run architecture guard**

Run:

```sh
bun run check:architecture
```

Expected: PASS. No new imports should violate `src/web/**` / `src/main/**` / `src/server/**` boundaries.

- [ ] **Step 2: Run typecheck**

Run:

```sh
bun run typecheck
```

Expected: PASS. No TypeScript enum, namespace runtime code, parameter properties, or import aliases should be introduced.

- [ ] **Step 3: Run focused renderer tests**

Run:

```sh
bun run test src/web/components/repo-workspace/RepoExplorerPane.test.tsx src/web/components/repo-workspace/ProjectChangesPanel.test.tsx src/web/components/repo-workspace/ProjectStatusPanel.test.tsx src/web/components/file-tree/ProjectFileTree.test.tsx src/web/components/branch-detail/BranchDetailToolbar.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run:

```sh
bun run test
```

Expected: PASS.

- [ ] **Step 5: Final no-commit checkpoint**

Run:

```sh
git status --short
```

Expected: changed files match the planned renderer work plus the spec and plan documents. No commit is created.
