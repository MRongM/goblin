// Repo-level chrome buttons. These actions sit here because they are
// unrelated to any single branch:
//
//   Refresh — local repos fetch before rebuilding repository state; remote
//             repos run read-only SSH refreshes only.
//
// Most branch-scoped operations (Checkout / Pull / Push / Open in Terminal
// / Open in GitHub) live with the selected-branch detail. Remote-tracking
// checkout is duplicated here so these branches can be promoted without
// relying on branch-row actions being visible.

import { useEffect, useState } from 'react'
import { ChevronDown, FolderPlus, GitBranch, RefreshCw } from 'lucide-react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { Tip } from '#/renderer/components/Tip.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/renderer/components/ui/dropdown-menu.tsx'
import { CreateWorktreeDialog, type CreateWorktreeRequest } from '#/renderer/components/CreateWorktreeDialog.tsx'
import { RemotePortsPopover } from '#/renderer/components/repo-toolbar/RemotePortsPopover.tsx'
import { RepoSyncControl } from '#/renderer/components/repo-sync/RepoSyncControl.tsx'
import { resourceBusy } from '#/renderer/stores/repos/resources.ts'

interface Props {
  repo: RepoState
}

export function RepoToolbarActions({ repo }: Props) {
  const t = useT()
  const runBranchAction = useReposStore((s) => s.runBranchAction)
  const refreshAll = useReposStore((s) => s.refreshAll)
  const refreshRemoteDiagnostics = useReposStore((s) => s.refreshRemoteDiagnostics)
  const [createOpen, setCreateOpen] = useState(false)
  const branchActionBusy = resourceBusy(repo.resources.branchAction)
  const diagnosticsBusy = resourceBusy(repo.resources.diagnostics)
  const checkoutRemoteBranches = repo.data.branches.filter(
    (branch) => branch.remoteTracking && !branch.worktreePath && branch.name !== repo.data.currentBranch,
  )
  const remoteRefreshBusy =
    resourceBusy(repo.resources.snapshot) ||
    resourceBusy(repo.resources.status) ||
    Object.values(repo.resources.logsByBranch).some(resourceBusy)

  // RepoView reuses the same React instance across repo switches
  // (no `key={activeId}` on the parent), so RepoToolbarActions keeps
  // its state when the user moves to a different repo. Force-close
  // the create-worktree dialog on repo change so a half-typed branch
  // name from repo A doesn't leak into a submission against repo B.
  useEffect(() => {
    setCreateOpen(false)
  }, [repo.id])

  async function handleCreateWorktree(request: CreateWorktreeRequest) {
    const targetRepoId = repo.id
    const token = repo.instanceToken
    if (branchActionBusy) return
    await runBranchAction(
      targetRepoId,
      {
        kind: 'createWorktree',
        worktreePath: request.worktreePath,
        newBranch: request.newBranch,
        baseBranch: request.baseBranch,
      },
      { token, refreshOnError: false },
    )
  }

  async function handleCheckoutRemoteBranch(remoteBranch: string) {
    const targetRepoId = repo.id
    const token = repo.instanceToken
    if (branchActionBusy) return
    await runBranchAction(targetRepoId, { kind: 'checkoutRemoteBranch', remoteBranch }, { token })
  }

  const createTip = t('action.create-worktree-title')
  const checkoutTip = repo.kind === 'remote' ? t('action.checkout-on-server') : t('action.checkout-locally')
  const retryTip = t('action.retry-diagnostics')
  const remoteRefreshTip = t('action.refresh-remote-title')

  function renderCheckoutRemoteBranches(buttonText: string) {
    if (checkoutRemoteBranches.length === 0) return null
    return (
      <DropdownMenu>
        <Tip label={checkoutTip}>
          <span className="inline-flex">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" disabled={branchActionBusy} aria-label={checkoutTip}>
                <GitBranch />
                {buttonText}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
          </span>
        </Tip>
        <DropdownMenuContent align="end">
          {checkoutRemoteBranches.map((branch) => (
            <DropdownMenuItem
              key={branch.name}
              disabled={branchActionBusy}
              onClick={() => {
                void handleCheckoutRemoteBranch(branch.name)
              }}
            >
              <GitBranch />
              {branch.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  if (repo.kind === 'remote') {
    return (
      <div className="flex items-center gap-1">
        <RemotePortsPopover repo={repo} />
        <Tip label={remoteRefreshTip}>
          <span className="inline-flex">
            <Button
              variant="ghost"
              onClick={() => {
                if (!remoteRefreshBusy) void refreshAll(repo.id, { token: repo.instanceToken })
              }}
              disabled={remoteRefreshBusy}
              aria-label={remoteRefreshTip}
            >
              <RefreshCw className={remoteRefreshBusy ? 'animate-spin' : undefined} />
              {t('action.refresh-remote')}
            </Button>
          </span>
        </Tip>
        {renderCheckoutRemoteBranches(t('action.checkout-on-server'))}
        <Tip label={createTip}>
          <span className="inline-flex">
            <Button
              variant="ghost"
              onClick={() => {
                if (!branchActionBusy) setCreateOpen(true)
              }}
              disabled={branchActionBusy}
              aria-label={createTip}
            >
              <FolderPlus />
              {t('action.create-worktree')}
            </Button>
          </span>
        </Tip>
        <Tip label={retryTip}>
          <span className="inline-flex">
            <Button
              variant="ghost"
              onClick={() => {
                if (!diagnosticsBusy) void refreshRemoteDiagnostics(repo.id, { token: repo.instanceToken })
              }}
              disabled={diagnosticsBusy}
              aria-label={retryTip}
            >
              <RefreshCw className={diagnosticsBusy ? 'animate-spin' : undefined} />
              {t('action.retry')}
            </Button>
          </span>
        </Tip>
        <CreateWorktreeDialog
          open={createOpen}
          repo={repo}
          onClose={() => setCreateOpen(false)}
          onCreate={handleCreateWorktree}
        />
      </div>
    )
  }

  // Buttons carry their label inline so the adjacent refresh-like glyphs
  // don't make the user guess which action they are invoking.
  return (
    <div className="flex items-center gap-1">
      <RepoSyncControl repo={repo} />
      {renderCheckoutRemoteBranches(t('action.checkout-locally'))}
      <Tip label={createTip}>
        <span className="inline-flex">
          <Button
            variant="ghost"
            onClick={() => {
              if (!branchActionBusy) setCreateOpen(true)
            }}
            disabled={branchActionBusy}
            aria-label={createTip}
          >
            <FolderPlus />
            {t('action.create-worktree')}
          </Button>
        </span>
      </Tip>
      <CreateWorktreeDialog
        open={createOpen}
        repo={repo}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreateWorktree}
      />
    </div>
  )
}
