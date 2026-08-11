// @vitest-environment jsdom

import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent } from 'vue'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { Layout } from '#/web/Layout.tsx'
import { useWorkspaceTerminalBellCounts } from '#/web/components/terminal/terminal-session-store.ts'
import type { TerminalSessionContextValue, TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'
import type { AuthenticatedAppBootstrapState } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///example-workspace')
const authenticatedBootstrapMock = vi.hoisted(() => ({
  state: { value: { status: 'ready' } as AuthenticatedAppBootstrapState },
  retry: vi.fn(),
}))

vi.mock('#/web/components/TokenGate.tsx', () => ({
  TokenGate: defineComponent({
    name: 'TokenGateMock',
    setup(_props, { slots }) {
      return () => slots.default?.()
    },
  }),
}))

vi.mock('#/web/hooks/useAuthenticatedAppBootstrap.ts', () => ({
  useAuthenticatedAppBootstrap: () => authenticatedBootstrapMock,
}))

vi.mock('#/web/hooks/useSettingsWriteErrorToast.ts', () => ({
  useSettingsWriteErrorToast: () => undefined,
}))

vi.mock('#/web/app-history-presentation.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  useAppHistoryPresentationObserver: () => undefined,
}))

vi.mock('#/web/components/terminal/TerminalSessionProvider.tsx', async () => {
  const { defineComponent } = await import('vue')
  const { TerminalSessionCommandScope, TerminalSessionReadScope } =
    await import('#/web/components/terminal/terminal-session-context.ts')
  const readContext: TerminalSessionReadContextValue = {
    terminalFilesystemTargetSnapshot: () => ({
      terminalFilesystemTargetKey: '',
      selectedDescriptor: null,
      sessions: [],
      count: 0,
      bellCount: 0,
      outputActiveCount: 0,
      createPending: false,
    }),
    subscribeTerminalFilesystemTarget: () => () => {},
    workspaceBellCount: () => 4,
    subscribeWorkspaceBellCount: () => () => {},
    snapshot: () => ({
      phase: 'opening',
      message: null,
      processName: 'terminal',
      composer: { expanded: false, mode: 'keys', draft: '', historyEntries: [] },
    }),
    subscribeSnapshot: () => () => {},
  }
  const commandContext: TerminalSessionContextValue = {
    createTerminal: vi.fn(async () => ''),
    createTerminalWithAdmission: vi.fn(async () => ({
      terminalSessionId: '',
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
      resourceDisposition: 'created',
      runtimeProjectionApplied: false,
      requestRole: 'leader',
    })) as TerminalSessionContextValue['createTerminalWithAdmission'],
    selectTerminal: vi.fn(),
    scrollToBottom: vi.fn(),
    readCopyText: vi.fn(() => null),
    openComposer: vi.fn(() => true),
    closeComposer: vi.fn(() => true),
    setComposerMode: vi.fn(() => true),
    setComposerDraft: vi.fn(() => true),
    replaceComposerDraft: vi.fn(() => true),
    clearBell: vi.fn(() => false),
    closeTerminalByDescriptor: vi.fn(async () => false),
    attach: vi.fn(),
    detach: vi.fn(),
    restart: vi.fn(),
    focusTerminal: vi.fn(),
    findNext: vi.fn(() => ({ resultIndex: 0, resultCount: 0, found: false })),
    findPrevious: vi.fn(() => ({ resultIndex: 0, resultCount: 0, found: false })),
    clearSearch: vi.fn(),
    captureInputWriter: vi.fn(() => null),
    sendVirtualKey: vi.fn(),
    submitText: vi.fn(async () => false),
    takeover: vi.fn(async () => false),
    retryPresentation: vi.fn(() => false),
  }
  return {
    TerminalSessionProvider: defineComponent({
      name: 'TerminalSessionProviderMock',
      setup(_props, { slots }) {
        return () => (
          <TerminalSessionCommandScope value={commandContext}>
            <TerminalSessionReadScope value={readContext}>{slots.default?.()}</TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        )
      },
    }),
  }
})

const SettingsRetainedOutletTerminalConsumer = defineComponent({
  name: 'SettingsRetainedOutletTerminalConsumer',
  setup() {
    const bellCounts = useWorkspaceTerminalBellCounts([WORKSPACE_ID])
    return () => <span data-testid="settings-retained-terminal-consumer">{bellCounts.value[WORKSPACE_ID]}</span>
  },
})

beforeEach(() => {
  authenticatedBootstrapMock.state.value = { status: 'ready' }
  authenticatedBootstrapMock.retry.mockReset()
})

describe('Layout shell providers', () => {
  test('keeps terminal read context above the settings shell outlet while workspace restore is pending', async () => {
    authenticatedBootstrapMock.state.value = { status: 'restoring-workspace' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/settings/general', name: 'settings', component: SettingsRetainedOutletTerminalConsumer }],
    })
    await router.push('/settings/general')
    await router.isReady()
    const { getByTestId } = renderInJsdom(<Layout />, { global: { plugins: [router] } })

    expect(getByTestId('settings-retained-terminal-consumer').textContent).toBe('4')
  })

  test('shows workspace restore progress before mounting the workspace shell', async () => {
    authenticatedBootstrapMock.state.value = { status: 'restoring-workspace' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'home', component: { template: '<div>workspace</div>' } }],
    })
    await router.push('/')
    await router.isReady()
    const { getByText, queryByText } = renderInJsdom(<Layout />, { global: { plugins: [router] } })

    expect(getByText('Restoring workspace')).toBeDefined()
    expect(queryByText('workspace')).toBeNull()
  })

  test('does not classify a similarly prefixed not-found route as settings', async () => {
    authenticatedBootstrapMock.state.value = { status: 'restoring-workspace' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/settings/:page', name: 'settings', component: { template: '<div>settings</div>' } },
        { path: '/:pathMatch(.*)*', name: 'not-found', component: { template: '<div>not found</div>' } },
      ],
    })
    await router.push('/settings-unknown')
    await router.isReady()
    const { getByText, queryByText } = renderInJsdom(<Layout />, { global: { plugins: [router] } })

    expect(getByText('Restoring workspace')).toBeDefined()
    expect(queryByText('settings')).toBeNull()
  })

  test('shows workspace restore failure and exposes the authoritative retry action', async () => {
    const user = userEvent.setup()
    authenticatedBootstrapMock.state.value = { status: 'failed', message: 'Workspace restore failed for test' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'home', component: { template: '<div>workspace</div>' } }],
    })
    await router.push('/')
    await router.isReady()
    const { getByRole, getByText } = renderInJsdom(<Layout />, { global: { plugins: [router] } })

    expect(getByText('Workspace restore failed for test')).toBeDefined()
    await user.click(getByRole('button'))
    expect(authenticatedBootstrapMock.retry).toHaveBeenCalledOnce()
  })
})
