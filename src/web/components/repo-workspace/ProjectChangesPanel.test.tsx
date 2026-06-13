// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ProjectChangesPanel } from '#/web/components/repo-workspace/ProjectChangesPanel.tsx'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'

const REPO_ID = '/tmp/gbl-project-changes-repo'
const WORKTREE_PATH = '/tmp/gbl-project-changes-repo'

const mocks = vi.hoisted(() => ({
  useRuntimeExternalAppSettings: vi.fn(),
}))

vi.mock('#/web/runtime-settings-external-apps.ts', () => ({
  useRuntimeExternalAppSettings: mocks.useRuntimeExternalAppSettings,
}))

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  mocks.useRuntimeExternalAppSettings.mockReturnValue({
    terminalApp: 'auto',
    resolvedTerminalApp: null,
    terminalAvailable: false,
    editorApp: 'vscode',
    resolvedEditorApp: 'vscode',
    editorAvailable: false,
  })
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

describe('ProjectChangesPanel', () => {
  test('renders selected worktree changes with a commit entry', async () => {
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
      root!.render(<ProjectChangesPanel repoId={REPO_ID} />)
    })

    expect(container?.querySelector('[aria-label="src/app.ts"]')).toBeTruthy()
    expect(container?.querySelector('button[aria-label="action.commit-title"]')).toBeTruthy()
    expect(container?.textContent).not.toContain('action.merge')
  })

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
})
