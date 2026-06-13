import { ArrowUp, Maximize2, Minimize2, Minus } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { Toolbar } from '#/web/components/Layout.tsx'
import { detailTabForWorktree } from '#/web/lib/detail-tabs.ts'
import { cn } from '#/web/lib/cn.ts'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { useWorktreeTerminalSnapshot } from '#/web/components/terminal/terminal-session-store.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { EMPTY_TERMINAL_TAB_FOCUS_KEY, TerminalTabs } from '#/web/components/terminal/TerminalTabs.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import type { TerminalSessionBase } from '#/web/components/terminal/types.ts'
import type { BranchDetailRepo, SelectedBranchDetailPresentation } from '#/web/components/branch-detail/model.ts'
import { useRuntimeShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import {
  branchDetailToolbarStoreActionsEqual,
  branchDetailToolbarStoreActionsFromStore,
} from '#/web/stores/repos/selector-actions.ts'
interface Props {
  repo: Pick<BranchDetailRepo, 'id' | 'ui'>
  detail: SelectedBranchDetailPresentation
  detailId: string
  contentId: string
  collapsed: boolean
  detailFocusMode: boolean
  layout: RepoWorkspaceLayout
}

export function BranchDetailToolbar({
  repo,
  detail,
  detailId,
  contentId,
  collapsed,
  detailFocusMode,
  layout,
}: Props) {
  const t = useT()
  const { setDetailCollapsed, toggleDetailCollapsed, toggleDetailFocusMode } = useStoreWithEqualityFn(
    useReposStore,
    branchDetailToolbarStoreActionsFromStore,
    branchDetailToolbarStoreActionsEqual,
  )
  const navigation = useMainWindowNavigation()
  const { shortcutsDisabled, toggleDetailOnActionBarBlankClick } = useRuntimeShortcutSettings()
  const compact = useIsCompactUi()
  const behavior = repoWorkspaceBehavior(layout, collapsed, detailFocusMode)
  const activeDetailTab = detailTabForWorktree(repo.ui.detailTab, !!detail.branch?.worktree?.path)
  const terminalWorktreeKey = detail.branch?.worktree?.path ? worktreeTerminalKey(repo.id, detail.branch.worktree.path) : null

  const {
    createTerminal,
    selectTerminal,
    scrollToBottom,
    closeTerminalAndDismissDetailIfLast,
    reorderSessions,
  } = useTerminalSessionContext()

  const worktreeSnapshot = useWorktreeTerminalSnapshot(terminalWorktreeKey)
  const terminalSessions = worktreeSnapshot.sessions
  const terminalTabFocusRegistry = useFocusRegistry<string, HTMLButtonElement>()

  const terminalBase = useMemo<TerminalSessionBase | null>(
    () =>
      detail.branch?.worktree?.path
        ? { repoRoot: repo.id, branch: detail.branch.name, worktreePath: detail.branch.worktree.path }
        : null,
    [repo.id, detail.branch],
  )

  const handleNewTerminal = useCallback(() => {
    if (!terminalBase) return
    if (repo.ui.detailTab !== 'terminal') {
      navigation.showRepoDetailTab(repo.id, 'terminal')
    }
    setDetailCollapsed(false)
    void createTerminal(terminalBase)
  }, [createTerminal, terminalBase, navigation, repo.id, repo.ui.detailTab, setDetailCollapsed])

  const handleSelectTerminal = useCallback(
    (worktreeKey: string, key: string) => {
      if (repo.ui.detailTab !== 'terminal') {
        navigation.showRepoDetailTab(repo.id, 'terminal')
      }
      setDetailCollapsed(false)
      selectTerminal(worktreeKey, key)
    },
    [repo.ui.detailTab, repo.id, navigation, selectTerminal, setDetailCollapsed],
  )

  const handleScrollToBottom = useCallback(
    (key: string) => {
      if (repo.ui.detailTab !== 'terminal') {
        navigation.showRepoDetailTab(repo.id, 'terminal')
      }
      setDetailCollapsed(false)
      scrollToBottom(key)
    },
    [repo.ui.detailTab, repo.id, navigation, scrollToBottom, setDetailCollapsed],
  )

  const handleCloseTerminal = useCallback(
    (key: string) => {
      if (!terminalBase) return
      closeTerminalAndDismissDetailIfLast(key, terminalBase)
    },
    [closeTerminalAndDismissDetailIfLast, terminalBase],
  )

  const handleReorderTerminals = useCallback(
    (worktreeKey: string, orderedKeys: string[]) => {
      void reorderSessions(worktreeKey, orderedKeys)
    },
    [reorderSessions],
  )

  // No selected branch means there is no tab/action target; BranchDetailContent renders the empty state.
  if (!detail.branch) return null

  const focusedTerminalSession = terminalSessions.find((session) => session.selected) ?? terminalSessions[0] ?? null

  function focusTerminalTab() {
    terminalTabFocusRegistry.focus(focusedTerminalSession?.key ?? EMPTY_TERMINAL_TAB_FOCUS_KEY)
  }

  const detailToggleTitle = t(
    shortcutsDisabled
      ? collapsed
        ? 'branch-detail.expand'
        : 'branch-detail.collapse'
      : collapsed
        ? 'branch-detail.expand-title'
        : 'branch-detail.collapse-title',
  )
  const focusTogglePressed = behavior.detailFocusMode

  return (
    <Toolbar variant="detail">
      <div className="flex h-full min-w-0 items-center gap-1 overflow-hidden">
        {terminalWorktreeKey && (
          <TerminalTabs
            worktreeTerminalKey={terminalWorktreeKey}
            sessions={terminalSessions}
            detailId={detailId}
            responsiveCompact={compact}
            panelActive={activeDetailTab === 'terminal'}
            focusMode={detailFocusMode}
            focusRegistry={terminalTabFocusRegistry}
            emptyFocusKey={EMPTY_TERMINAL_TAB_FOCUS_KEY}
            onNew={handleNewTerminal}
            onSelect={handleSelectTerminal}
            onScrollToBottom={handleScrollToBottom}
            onClose={handleCloseTerminal}
            onReorder={handleReorderTerminals}
            onNavigateOut={() => {
              if (repo.ui.detailTab !== 'terminal') {
                navigation.showRepoDetailTab(repo.id, 'terminal')
              }
              setDetailCollapsed(false)
              focusTerminalTab()
            }}
          />
        )}
      </div>
      <div
        aria-hidden="true"
        className={cn('min-w-2 flex-1 self-stretch', compact && 'hidden')}
        onClick={behavior.detailCollapseAllowed && toggleDetailOnActionBarBlankClick ? toggleDetailCollapsed : undefined}
      />
      <div className="flex shrink-0 items-center gap-1">
        {layout === 'top-bottom' && <div className="mx-1 h-4 w-px bg-separator/70" aria-hidden="true" />}
        {behavior.detailFocusAllowed && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleDetailFocusMode}
            aria-label={t(focusTogglePressed ? 'branch-detail.exit-focus' : 'branch-detail.focus')}
            title={t(focusTogglePressed ? 'branch-detail.exit-focus-title' : 'branch-detail.focus-title')}
            aria-pressed={focusTogglePressed}
            className={cn(
              focusTogglePressed && 'bg-accent text-accent-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {focusTogglePressed ? <Minimize2 /> : <Maximize2 />}
          </Button>
        )}
        {behavior.detailCollapseAllowed && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleDetailCollapsed}
            aria-label={t(collapsed ? 'branch-detail.expand' : 'branch-detail.collapse')}
            title={detailToggleTitle}
            aria-expanded={!collapsed}
            aria-controls={collapsed ? undefined : contentId}
          >
            {collapsed ? <ArrowUp /> : <Minus />}
          </Button>
        )}
      </div>
    </Toolbar>
  )
}
