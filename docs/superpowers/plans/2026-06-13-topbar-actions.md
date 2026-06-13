# Topbar Actions Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all repository toolbar button/input controls into the main topbar before Settings, using the approved icon-only direction, and remove the secondary repository operation bar.

**Architecture:** Add an optional actions slot to `Topbar`, then mount active-repository controls from `App` beside Settings. Keep repository state and action data flow unchanged by reusing the current toolbar subcomponents, action hooks, and store selectors. Remove the old toolbar render path from `RepoView` and loading skeletons.

**Tech Stack:** React, TypeScript strip-only mode, Zustand, Vitest/jsdom, Bun.

**Safety Note:** Do not add commit steps. Project instructions explicitly prohibit planning or executing git commits unless the user asks for them.

---

## File Structure

- Modify: `src/web/components/Topbar.tsx`
  - Adds an optional `actions?: ReactNode` slot rendered before Settings.
- Create: `src/web/components/Topbar.test.tsx`
  - Verifies action-slot ordering and Settings behavior.
- Create: `src/web/components/topbar/TopbarRepoControls.tsx`
  - Owns active repository control selection and topbar placement for non-focus and focus modes.
- Modify: `src/web/components/repo-toolbar/RepoToolbarActions.tsx`
  - Adds an optional compact override so topbar can force icon-only labels without changing existing action logic.
- Modify: `src/web/components/repo-activity/RepoActivityControl.tsx`
  - Adds an optional compact override so topbar can force the refresh/activity control to icon-only.
- Modify: `src/web/components/repo-toolbar/RepoToolbar.test.tsx`
  - Replaces old toolbar-shell expectations with `TopbarRepoControls` expectations while keeping the existing test file path to avoid a risky file move.
- Modify: `src/web/App.tsx`
  - Passes `<TopbarRepoControls repoId={visibleRepoId} />` into `Topbar.actions`.
- Modify: `src/web/components/RepoView.tsx`
  - Removes the secondary `RepoToolbar` render.
- Modify: `src/web/components/Skeleton.tsx`
  - Removes the repository toolbar skeleton branch.
- Modify: `src/web/components/Skeleton.test.tsx`
  - Updates skeleton expectations for the removed secondary bar.
- Create: `src/web/components/RepoView.test.tsx`
  - Verifies `RepoView` no longer renders repository-toolbar controls inside the content area.

---

### Task 1: Add Topbar Actions Slot

**Files:**
- Modify: `src/web/components/Topbar.tsx`
- Create: `src/web/components/Topbar.test.tsx`

- [ ] **Step 1: Write the failing Topbar slot tests**

Create `src/web/components/Topbar.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Topbar } from '#/web/components/Topbar.tsx'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
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

describe('Topbar', () => {
  test('renders actions before settings', () => {
    render(
      <Topbar
        onOpenSettings={() => {}}
        actions={<button aria-label="Repository actions">Actions</button>}
      >
        <div data-testid="repo-tabs">Tabs</div>
      </Topbar>,
    )

    const actions = document.body.querySelector('button[aria-label="Repository actions"]')
    const settings = document.body.querySelector('button[aria-label="topbar.settings"]')
    expect(actions).toBeInstanceOf(HTMLButtonElement)
    expect(settings).toBeInstanceOf(HTMLButtonElement)
    expect(actions!.compareDocumentPosition(settings!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('keeps settings clickable with an action slot', () => {
    const openSettings = vi.fn()
    render(
      <Topbar onOpenSettings={openSettings} actions={<button aria-label="Repository actions">Actions</button>}>
        <div data-testid="repo-tabs">Tabs</div>
      </Topbar>,
    )

    const settings = document.body.querySelector('button[aria-label="topbar.settings"]')
    if (!(settings instanceof HTMLButtonElement)) throw new Error('missing settings button')

    act(() => {
      settings.click()
    })

    expect(openSettings).toHaveBeenCalledTimes(1)
  })
})

function render(element: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
}
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
bun run test src/web/components/Topbar.test.tsx
```

Expected: FAIL because `Topbar` does not accept or render an `actions` prop.

- [ ] **Step 3: Add the actions slot to `Topbar`**

Modify `src/web/components/Topbar.tsx`:

```tsx
interface Props {
  onOpenSettings: () => void
  children: ReactNode
  actions?: ReactNode
}

export function Topbar({ onOpenSettings, children, actions }: Props) {
  const t = useT()

  return (
    <div
      className="topbar relative flex items-center gap-2 overflow-hidden border-b border-separator bg-background text-sm"
      style={{ height: WINDOW_TOPBAR_HEIGHT_PX }}
    >
      {children}
      {actions && (
        <>
          <div data-testid="topbar-actions" className="flex h-full shrink-0 items-center gap-1">
            {actions}
          </div>
          <div aria-hidden="true" className="h-4 w-px shrink-0 bg-separator/70" />
        </>
      )}
      <Tip label={t('topbar.settings')}>
        <Button variant="ghost" size="icon" onClick={() => onOpenSettings()} aria-label={t('topbar.settings')}>
          <Settings />
        </Button>
      </Tip>
    </div>
  )
}
```

- [ ] **Step 4: Run the Topbar test and verify it passes**

Run:

```bash
bun run test src/web/components/Topbar.test.tsx
```

Expected: PASS.

---

### Task 2: Build Icon-Only Topbar Repository Controls

**Files:**
- Create: `src/web/components/topbar/TopbarRepoControls.tsx`
- Modify: `src/web/components/repo-toolbar/RepoToolbarActions.tsx`
- Modify: `src/web/components/repo-activity/RepoActivityControl.tsx`
- Modify: `src/web/components/repo-toolbar/RepoToolbar.test.tsx`

- [ ] **Step 1: Update toolbar action tests for topbar controls**

Replace `src/web/components/repo-toolbar/RepoToolbar.test.tsx` with tests for `TopbarRepoControls`:

```tsx
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
```

- [ ] **Step 2: Run the topbar repo controls test and verify it fails**

Run:

```bash
bun run test src/web/components/repo-toolbar/RepoToolbar.test.tsx
```

Expected: FAIL because `TopbarRepoControls` does not exist.

- [ ] **Step 3: Add compact overrides to activity and toolbar actions**

Modify `src/web/components/repo-activity/RepoActivityControl.tsx`:

```tsx
interface Props {
  repoId: string
  compact?: boolean
}

export function RepoActivityControl({ repoId, compact: compactOverride }: Props) {
  const repo = useStoreWithEqualityFn(useReposStore, (s) => s.repos[repoId], repoActivityControlRepoEqual)
  const responsiveCompact = useIsCompactUi()
  const compact = compactOverride ?? responsiveCompact
  if (!repo) return null
  return <RepoActivityControlView repo={repo} compact={compact} />
}
```

Modify `src/web/components/repo-toolbar/RepoToolbarActions.tsx`:

```tsx
interface Props {
  repoId: string
  compact?: boolean
}

export function RepoToolbarActions({ repoId, compact: compactOverride }: Props) {
  const responsiveCompact = useIsCompactUi()
  const compact = compactOverride ?? responsiveCompact
  return (
    <div className="flex items-center gap-1">
      <RepoActivityControl repoId={repoId} compact={compact} />
      <CreateWorktreeAction repoId={repoId} compact={compact} />
    </div>
  )
}
```

Keep the rest of `RepoToolbarActions.tsx` unchanged. This preserves existing refresh/activity and create-worktree behavior.

- [ ] **Step 4: Implement `TopbarRepoControls` by moving current toolbar control logic into a topbar shell**

Create `src/web/components/topbar/TopbarRepoControls.tsx`.

Use the existing imports and helper functions from `src/web/components/repo-toolbar/RepoToolbar.tsx`, with these changes:

```tsx
import { ChevronDown, GitBranch } from 'lucide-react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { Button } from '#/web/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/web/components/ui/dropdown-menu.tsx'
import { BranchActionControls } from '#/web/components/BranchActionControls.tsx'
import { BranchSearchInput } from '#/web/components/repo-toolbar/BranchSearchInput.tsx'
import { BranchViewModeControl } from '#/web/components/repo-toolbar/BranchViewModeControl.tsx'
import { RepoToolbarActions } from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { WorkspaceLayoutControl } from '#/web/components/repo-toolbar/WorkspaceLayoutControl.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
import { visibleBranches } from '#/web/stores/repos/branch-view-mode.ts'
import { useT } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { BranchViewMode, RepoBranchState } from '#/web/stores/repos/types.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

interface Props {
  repoId: string
}

export function TopbarRepoControls({ repoId }: Props) {
  const exists = useReposStore((s) => !!s.repos[repoId])
  const focusMode = useReposStore((s) => {
    const behavior = repoWorkspaceBehavior(s.workspaceLayout, s.detailCollapsed, s.detailFocusMode)
    return behavior.mode === 'focus'
  })

  if (!exists) return null

  return (
    <div className="flex h-full shrink-0 items-center gap-1">
      {focusMode ? <FocusBranchControls repoId={repoId} /> : <BranchFilterControls repoId={repoId} />}
      <RepoToolbarActions repoId={repoId} compact />
      <WorkspaceLayoutControlConnected />
    </div>
  )
}
```

Copy the existing `FOCUS_BRANCH_ACTIONS_REPO_EQUAL`, `FocusBranchActions`, `BranchFilterControls`, and `WorkspaceLayoutControlConnected` implementations from `RepoToolbar.tsx`.

Replace the current `BranchSelector` body with this icon-only version:

```tsx
function BranchSelector({
  repoId,
  branches,
  selectedBranch,
  navigation,
}: {
  repoId: string
  branches: { name: string }[]
  selectedBranch: string | null
  navigation: ReturnType<typeof useMainWindowNavigation>
}) {
  const t = useT()
  if (branches.length === 0) return null
  const index = branches.findIndex((branch) => branch.name === selectedBranch)
  const current = index >= 0 ? index + 1 : 1
  const currentBranch = branches[current - 1]?.name ?? selectedBranch ?? ''
  const label = currentBranch ? `${t('branches.switch')}: ${currentBranch} (${current} / ${branches.length})` : t('branches.switch')

  return (
    <DropdownMenu>
      <Tip label={label}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('branches.switch')}
            title={label}
          >
            <GitBranch />
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent side="bottom" align="end" className="w-max">
        {branches.map((branch) => (
          <DropdownMenuItem
            key={branch.name}
            className="whitespace-nowrap"
            disabled={branch.name === selectedBranch}
            onSelect={() => navigation.selectRepoBranch(repoId, branch.name)}
          >
            <span className={branch.name === selectedBranch ? 'text-muted-foreground' : undefined}>
              {branch.name}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

Use this focus-mode control body so `BranchSummaryInline` stays out of the icon-only topbar:

```tsx
return (
  <div className="flex h-full shrink-0 items-center gap-1">
    <BranchSelector
      repoId={repoId}
      branches={branches}
      selectedBranch={selectedBranch}
      navigation={navigation}
    />
    {selectedBranchData && <FocusBranchActions repoId={repoId} branch={selectedBranchData} />}
  </div>
)
```

- [ ] **Step 5: Run topbar repo controls tests and verify they pass**

Run:

```bash
bun run test src/web/components/repo-toolbar/RepoToolbar.test.tsx
```

Expected: PASS.

---

### Task 3: Wire Controls Into App And Remove The Secondary Bar

**Files:**
- Modify: `src/web/App.tsx`
- Modify: `src/web/components/RepoView.tsx`
- Create: `src/web/components/RepoView.test.tsx`

- [ ] **Step 1: Write the failing `RepoView` content-area test**

Create `src/web/components/RepoView.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoView } from '#/web/components/RepoView.tsx'
import { MainWindowNavigationProvider, type MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { resetReposStore, seedRepoState, createRepoBranch } from '#/web/stores/repos/test-utils.ts'

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
```

- [ ] **Step 2: Run the `RepoView` test and verify it fails**

Run:

```bash
bun run test src/web/components/RepoView.test.tsx
```

Expected: FAIL because `RepoView` still renders `RepoToolbar`.

- [ ] **Step 3: Pass `TopbarRepoControls` through `App`**

Modify `src/web/App.tsx`:

```tsx
import { TopbarRepoControls } from '#/web/components/topbar/TopbarRepoControls.tsx'
```

Then update the `Topbar` render:

```tsx
<Topbar
  onOpenSettings={() => openSettings()}
  actions={visibleRepoId ? <TopbarRepoControls repoId={visibleRepoId} /> : null}
>
  <RepoTabs
    currentRepoId={visibleRepoId}
    onOpenRepoPathDialog={overlays.openRepoPathDialog}
    onOpenRemote={overlays.openRemoteRepo}
    onClone={overlays.openCloneRepo}
  />
</Topbar>
```

- [ ] **Step 4: Remove `RepoToolbar` from `RepoView`**

Modify `src/web/components/RepoView.tsx`:

```tsx
// Remove this import:
// import { RepoToolbar } from '#/web/components/repo-toolbar/RepoToolbar.tsx'
```

Remove the loaded-state render:

```tsx
<RepoToolbar repoId={repoId} />
```

Update the initial loading skeleton call by removing `showRepoToolbar`:

```tsx
<RepoWorkspaceSkeleton
  layout={layout}
  detailCollapsed={behavior.detailCollapsed}
  detailFocusMode={behavior.detailFocusMode}
  compact={uiMode === 'compact'}
/>
```

- [ ] **Step 5: Run App/RepoView related tests**

Run:

```bash
bun run test src/web/components/Topbar.test.tsx src/web/components/repo-toolbar/RepoToolbar.test.tsx src/web/components/RepoView.test.tsx
```

Expected: PASS.

---

### Task 4: Remove Repository Toolbar Skeletons

**Files:**
- Modify: `src/web/components/Skeleton.tsx`
- Modify: `src/web/components/Skeleton.test.tsx`

- [ ] **Step 1: Update skeleton tests for no secondary toolbar**

Modify `src/web/components/Skeleton.test.tsx` tests that currently pass `showRepoToolbar`.

For the top-bottom split test, assert no toolbar placeholders:

```tsx
render(<RepoWorkspaceSkeleton layout="top-bottom" detailCollapsed={false} detailFocusMode={false} />)

expect(container?.querySelector('[data-testid="repo-toolbar-skeleton-branch-view"]')).toBeNull()
expect(container?.querySelector('[data-testid="repo-toolbar-skeleton-branch-search"]')).toBeNull()
expect(container?.querySelector('[data-testid="repo-toolbar-skeleton-layout-control"]')).toBeNull()
expect(container?.querySelector('[data-testid="repo-toolbar-skeleton-pager"]')).toBeNull()
```

For the focus-mode and compact tests, remove `showRepoToolbar` and assert the same toolbar skeleton ids are absent.

- [ ] **Step 2: Run skeleton tests and verify they fail**

Run:

```bash
bun run test src/web/components/Skeleton.test.tsx
```

Expected: FAIL until `RepoWorkspaceSkeleton` no longer accepts or renders the repo toolbar skeleton.

- [ ] **Step 3: Remove `showRepoToolbar` and repo toolbar skeleton internals**

Modify `src/web/components/Skeleton.tsx`:

```tsx
interface WorkspaceSkeletonProps {
  layout?: RepoWorkspaceLayout
  detailCollapsed?: boolean
  detailFocusMode?: boolean
  compact?: boolean
}
```

Update `RepoWorkspaceSkeleton` destructuring:

```tsx
export function RepoWorkspaceSkeleton({
  layout = DEFAULT_WORKSPACE_LAYOUT,
  detailCollapsed = false,
  detailFocusMode = false,
  compact = false,
}: WorkspaceSkeletonProps) {
```

Remove this render line:

```tsx
{showRepoToolbar && <RepoToolbarSkeleton focusMode={behavior.mode === 'focus'} compact={compact} />}
```

Remove these complete now-unused helper function declarations from `Skeleton.tsx`:

- `RepoToolbarSkeleton`
- `RepoToolbarActionsSkeleton`
- `ToolbarPagerSkeleton`
- `ToolbarSearchSkeleton`
- `ToolbarSegmentedControlSkeleton`

- [ ] **Step 4: Remove `showRepoToolbar` from App skeleton calls**

Modify `src/web/App.tsx` fallback skeleton:

```tsx
<RepoWorkspaceSkeleton
  layout={workspaceLayout}
  detailCollapsed={detailCollapsed}
  detailFocusMode={detailFocusMode}
  compact={uiMode === 'compact'}
/>
```

- [ ] **Step 5: Run skeleton tests and verify they pass**

Run:

```bash
bun run test src/web/components/Skeleton.test.tsx
```

Expected: PASS.

---

### Task 5: Final Verification

**Files:**
- Verify: changed source and test files from Tasks 1-4.

- [ ] **Step 1: Search for stale secondary toolbar usage**

Run:

```bash
rg -n "RepoToolbar|showRepoToolbar|repo-toolbar-skeleton" "src/web"
```

Expected:

- No `RepoToolbar` render/import remains in `RepoView` or `App`.
- No `showRepoToolbar` prop remains.
- `RepoToolbarActions` may remain because it is reused by `TopbarRepoControls`.
- `src/web/components/repo-toolbar/RepoToolbar.test.tsx` may remain as a test file path, but its contents should test `TopbarRepoControls`.

- [ ] **Step 2: Run focused component tests**

Run:

```bash
bun run test src/web/components/Topbar.test.tsx src/web/components/repo-toolbar/RepoToolbar.test.tsx src/web/components/RepoView.test.tsx src/web/components/Skeleton.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run:

```bash
bun run test
```

Expected: PASS.

---

## Self-Review

Spec coverage:

- Topbar action slot before Settings: Task 1 and Task 3.
- All current repository toolbar button/input controls in topbar: Task 2 and Task 3.
- Icon-only direction: Task 2 forces compact labels and icon-only branch switcher.
- No secondary repository toolbar: Task 3.
- No loading skeleton secondary toolbar: Task 4.
- Existing store/action data flow preserved: Task 2 reuses existing subcomponents, store selectors, hooks, and action handlers.
- Tests and verification commands: Tasks 1-5.

Placeholder scan:

- No placeholder terms or deferred implementation steps are included.
- Each implementation step names exact files and concrete code changes.

Type consistency:

- `Topbar.actions` is typed as `ReactNode`.
- `TopbarRepoControls` accepts only `repoId: string`.
- `RepoToolbarActions.compact` is optional and preserves current call sites.
- Import paths use repo aliases with explicit `.tsx` suffixes.
