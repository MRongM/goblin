import { ArrowDown, ArrowUp, ClipboardCopy, ExternalLink, FolderPlus, GitBranch, GitPullRequest, RefreshCw, Trash2 } from 'lucide-react'
import { createElement, Fragment, type ReactNode } from 'react'
import { GitHubOutlineIcon } from '#/web/components/GitHubOutlineIcon.tsx'
import { GitLabLogoIcon } from '#/web/components/GitLabLogoIcon.tsx'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { EditorAppIcon, TerminalAppIcon } from '#/web/components/ExternalAppIcon/index.tsx'
import { useBranchActions, type BranchActionItemId } from '#/web/hooks/useBranchActions.tsx'
import { branchActionDisplayPhase, type BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { branchPullRequestBelongsToBranch } from '#/shared/git-types.ts'
import type { BrowserRemoteProvider } from '#/web/types.ts'
import { useRuntimeExternalAppSettings } from '#/web/runtime-settings-external-apps.ts'
import { useBranchWriteActions } from '#/web/hooks/useBranchWriteActions.tsx'
import { useRetainedDialogState } from '#/web/hooks/useRetainedDialogState.ts'
import { CreateWorktreeDialog, type CreateWorktreeRequest } from '#/web/components/CreateWorktreeDialog.tsx'
export interface BranchActionItem {
  id: BranchActionItemId
  label: string
  title?: string
  ariaLabel?: string
  disabled: boolean
  busy?: boolean
  visible: boolean
  destructive?: boolean
  shortcut?: string
  icon: ReactNode
  onSelect: () => void | Promise<void>
}

export interface BranchActionItemGroups {
  patchItems: BranchActionItem[]
  mainItems: BranchActionItem[]
  externalItems: BranchActionItem[]
  destructiveItems: BranchActionItem[]
  dialogs: ReactNode
}

export function visibleBranchActionItems({
  patchItems,
  mainItems,
  externalItems,
  destructiveItems,
}: Pick<BranchActionItemGroups, 'patchItems' | 'mainItems' | 'externalItems' | 'destructiveItems'>): BranchActionItem[] {
  return [...patchItems, ...mainItems, ...externalItems, ...destructiveItems].filter((item) => item.visible)
}

export function branchBrowserRemoteProvider(
  repo: BranchActionRepo,
  branch: RepoBranchState,
): BrowserRemoteProvider | undefined {
  const providers = repo.remote.remoteProviders
  if (branch.tracking && providers) {
    const remoteName = Object.keys(providers)
      .filter((remote) => branch.tracking === remote || branch.tracking!.startsWith(`${remote}/`))
      .sort((a, b) => b.length - a.length)[0]
    if (remoteName) return providers[remoteName]
  }
  return repo.remote.browserRemoteProvider
}

function browserRemoteIcon(provider: BrowserRemoteProvider | undefined) {
  if (provider === 'github') return GitHubOutlineIcon
  if (provider === 'gitlab') return GitLabLogoIcon
  return ExternalLink
}

export function useBranchActionItems(repo: BranchActionRepo, branch: RepoBranchState): BranchActionItemGroups {
  const t = useT()
  const syncAndRefresh = useReposStore((s) => s.syncAndRefresh)
  const submitBranchAction = useReposStore((s) => s.submitBranchAction)
  const { terminalApp, resolvedTerminalApp, terminalAvailable, editorApp, resolvedEditorApp, editorAvailable } =
    useRuntimeExternalAppSettings()
  const { blocked, busyAction, capabilities, actions, dialogs } = useBranchActions(repo, branch)
  const writeActions = useBranchWriteActions(repo, branch)
  const createWorktreeDialog = useRetainedDialogState<string>()
  const disabled = blocked
  const busy = (id: BranchActionItemId) => busyAction === id
  const phase = branchActionDisplayPhase(repo, branch.name)
  const createWorktreeBusy =
    repo.operations.branchAction.phase !== 'idle' && repo.operations.branchAction.reason === 'branch:createWorktree'
  const syncBusy = repo.operations.manualRefresh.phase !== 'idle' || repo.operations.fetch.phase !== 'idle'
  const branchActionLabel = (
    id: BranchActionItemId,
    idleKey: string,
    loadingKey: string,
    queuedKey?: string,
  ): string => {
    const itemBusy = busy(id) || (id === 'createWorktree' && createWorktreeBusy)
    if (!itemBusy) return t(idleKey)
    const itemPhase = id === 'createWorktree' ? repo.operations.branchAction.phase : phase
    if (itemPhase === 'queued' && queuedKey) return t(queuedKey)
    return t(loadingKey)
  }
  const pullRequest =
    branch.pullRequest && branchPullRequestBelongsToBranch(branch, branch.pullRequest) ? branch.pullRequest : undefined
  const remoteIcon = pullRequest ? GitPullRequest : browserRemoteIcon(branchBrowserRemoteProvider(repo, branch))
  const isRemoteRepo = !!repo.remote.target
  const showTerminalAction = capabilities.canOpenTerminal && (isRemoteRepo || terminalAvailable)
  const terminalIconPref = isRemoteRepo ? 'auto' : (resolvedTerminalApp ?? terminalApp)

  function handleCreateWorktree(request: CreateWorktreeRequest): void {
    if (blocked) return
    submitBranchAction(
      repo.id,
      {
        kind: 'createWorktree',
        input: request.input,
      },
      { token: repo.instanceToken, refreshOnError: false },
    )
  }

  async function handleSync(): Promise<void> {
    if (blocked || syncBusy) return
    await syncAndRefresh(repo.id, { token: repo.instanceToken })
  }

  const patchItems: BranchActionItem[] = capabilities.canCopyPatch
    ? [
        {
          id: 'copyPatch',
          label: t('status.copy-patch'),
          title: t('status.copy-patch-title'),
          ariaLabel: t('status.copy-patch-title'),
          disabled,
          busy: busy('copyPatch'),
          visible: true,
          icon: createElement(ClipboardCopy),
          onSelect: actions.copyPatch,
        },
      ]
    : []

  const mainItems: BranchActionItem[] = [
    {
      id: 'checkout',
      label: branchActionLabel('checkout', 'action.checkout', 'action.checkout-loading', 'action.checkout-queued'),
      disabled,
      busy: busy('checkout'),
      visible: !capabilities.isCurrent && !capabilities.checkedOutInAnotherWorktree,
      shortcut: '↩',
      icon: createElement(GitBranch),
      onSelect: actions.checkout,
    },
    {
      id: 'pull',
      label: branchActionLabel('pull', 'action.pull-remote', 'action.pull-loading', 'action.pull-queued'),
      disabled,
      busy: busy('pull'),
      visible: capabilities.canPull,
      shortcut: 'P',
      icon: createElement(ArrowDown),
      onSelect: actions.pull,
    },
    {
      id: 'push',
      label: branchActionLabel('push', 'action.push', 'action.push-loading', 'action.push-queued'),
      disabled,
      busy: busy('push'),
      visible: capabilities.canPush,
      shortcut: '⇧P',
      icon: createElement(ArrowUp),
      onSelect: actions.push,
    },
    {
      id: 'createWorktree',
      label: branchActionLabel(
        'createWorktree',
        'action.create-worktree',
        'action.create-worktree-creating-title',
        'action.create-worktree-queued-title',
      ),
      title: t('action.create-worktree-title'),
      disabled,
      busy: createWorktreeBusy,
      visible: true,
      icon: createElement(FolderPlus),
      onSelect: () => createWorktreeDialog.openWith(''),
    },
    {
      id: 'sync',
      label: t('action.refresh'),
      title: t('action.fetch-title'),
      disabled,
      busy: syncBusy,
      visible: true,
      icon: createElement(RefreshCw),
      onSelect: handleSync,
    },
  ]

  const externalItems: BranchActionItem[] = [
    ...(showTerminalAction
      ? [
          {
            id: 'terminal' as const,
            label: t('worktrees.open-in-terminal-label'),
            disabled,
            busy: busy('terminal'),
            visible: true,
            shortcut: 'G',
            icon: createElement(TerminalAppIcon, { pref: terminalIconPref }),
            onSelect: actions.openTerminal,
          },
        ]
      : []),
    ...(capabilities.canOpenEditor && editorAvailable
      ? [
          {
            id: 'editor' as const,
            label: t('worktrees.open-in-editor-label'),
            disabled,
            busy: busy('editor'),
            visible: true,
            shortcut: 'V',
            icon: createElement(EditorAppIcon, { pref: resolvedEditorApp ?? editorApp }),
            onSelect: actions.openEditor,
          },
        ]
      : []),
    {
      id: 'remote',
      label: pullRequest ? t('action.remote-pr', { n: pullRequest.number }) : t('action.remote'),
      disabled,
      busy: busy('remote'),
      visible: capabilities.canOpenRemote,
      shortcut: '⇧G',
      icon: createElement(remoteIcon),
      onSelect: actions.openRemote,
    },
  ]

  const destructiveItems: BranchActionItem[] = [
    ...(capabilities.canRemoveWorktree
      ? [
          {
            id: 'removeWorktree' as const,
            label: branchActionLabel(
              'removeWorktree',
              'action.remove-worktree',
              'action.remove-worktree-removing-title',
              'action.remove-worktree-queued-title',
            ),
            disabled,
            busy: busy('removeWorktree'),
            visible: true,
            destructive: true,
            icon: createElement(Trash2),
            onSelect: actions.requestRemoveWorktree,
          },
        ]
      : []),
    ...(capabilities.isRegularBranch
      ? [
          {
            id: 'deleteBranch' as const,
            label: branchActionLabel(
              'deleteBranch',
              'action.delete-branch',
              'action.delete-branch-deleting-title',
              'action.delete-branch-queued-title',
            ),
            disabled,
            busy: busy('deleteBranch'),
            visible: true,
            destructive: true,
            icon: createElement(Trash2),
            onSelect: actions.requestDeleteBranch,
          },
        ]
      : []),
  ]

  return {
    patchItems,
    mainItems: [...mainItems, ...writeActions.mainItems],
    externalItems,
    destructiveItems: [...destructiveItems, ...writeActions.destructiveItems],
    dialogs: createElement(
      Fragment,
      null,
      dialogs,
      writeActions.dialogs,
      createElement(CreateWorktreeDialogConnected, {
        repoId: repo.id,
        open: createWorktreeDialog.open,
        onClose: createWorktreeDialog.close,
        onCreate: handleCreateWorktree,
      }),
    ),
  }
}

function CreateWorktreeDialogConnected({
  repoId,
  open,
  onClose,
  onCreate,
}: {
  repoId: string
  open: boolean
  onClose: () => void
  onCreate: (request: CreateWorktreeRequest) => void | Promise<void>
}) {
  const repo = useReposStore((s) => s.repos[repoId])
  if (!repo) return null
  return createElement(CreateWorktreeDialog, { open, repo, onClose, onCreate })
}
