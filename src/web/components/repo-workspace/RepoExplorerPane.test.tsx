// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoExplorerPane } from '#/web/components/repo-workspace/RepoExplorerPane.tsx'

const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

vi.mock('#/web/components/BranchList.tsx', () => ({
  BranchList: () => <div data-testid="branch-list" />,
}))

vi.mock('#/web/components/file-tree/ProjectFileTree.tsx', () => ({
  ProjectFileTree: ({ revealRequest }: { revealRequest?: { relativePath: string } | null }) => (
    <div data-testid="project-file-tree" data-reveal-path={revealRequest?.relativePath ?? ''} />
  ),
}))

vi.mock('#/web/components/repo-workspace/ProjectChangesPanel.tsx', () => ({
  ProjectChangesPanel: ({ onRevealPath }: { onRevealPath?: (path: string) => void }) => (
    <button type="button" data-testid="project-changes-panel" onClick={() => onRevealPath?.('src/app.ts')}>
      changes
    </button>
  ),
}))

vi.mock('#/web/components/repo-workspace/ProjectStatusPanel.tsx', () => ({
  ProjectStatusPanel: () => <div data-testid="project-status-panel" />,
}))

vi.mock('#/web/components/SplitPane.tsx', () => ({
  SplitPane: ({ before, after, orientation }: { before: React.ReactNode; after: React.ReactNode; orientation: string }) => (
    <div data-testid="split-pane" data-orientation={orientation}>
      {before}
      {after}
    </div>
  ),
}))

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  document.body.innerHTML = ''
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('RepoExplorerPane', () => {
  test('keeps branch list beside file tree in top-bottom workspace layout', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<RepoExplorerPane repoId="/repo" layout="top-bottom" showActions />)
    })
    expect(container.querySelector('[data-file-tree-layout="top-bottom"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="split-pane"]')?.getAttribute('data-orientation')).toBe('horizontal')
    expect(container.querySelector('[data-testid="branch-list"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="project-file-tree"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="project-changes-panel"]')).toBeNull()
    await act(async () => root.unmount())
  })

  test('stacks branch list above file tree in left-right workspace layout', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<RepoExplorerPane repoId="/repo" layout="left-right" showActions />)
    })
    expect(container.querySelector('[data-file-tree-layout="left-right"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="split-pane"]')?.getAttribute('data-orientation')).toBe('vertical')
    await act(async () => root.unmount())
  })

  test('switches the explorer area between file, changes, and status tabs', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<RepoExplorerPane repoId="/repo" layout="top-bottom" showActions />)
    })

    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    expect(tabs.map((tab) => tab.textContent)).toEqual(['file-tree.title', 'tab.changes', 'tab.status'])
    expect(container.querySelector('[data-testid="project-file-tree"]')).toBeTruthy()

    await act(async () => {
      tabs[1]?.click()
    })

    expect(container.querySelector('[data-testid="project-file-tree"]')).toBeNull()
    expect(container.querySelector('[data-testid="project-changes-panel"]')).toBeTruthy()

    await act(async () => {
      tabs[2]?.click()
    })

    expect(container.querySelector('[data-testid="project-file-tree"]')).toBeNull()
    expect(container.querySelector('[data-testid="project-changes-panel"]')).toBeNull()
    expect(container.querySelector('[data-testid="project-status-panel"]')).toBeTruthy()
    await act(async () => root.unmount())
  })

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
})
