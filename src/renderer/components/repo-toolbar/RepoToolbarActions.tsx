// Repo-level chrome actions. RepoActivityControl owns refresh/progress;
// this file keeps branch creation, remote-tracking checkout, and remote-only
// utilities close to the toolbar without mixing them into branch row actions.

import { useEffect, useState } from 'react'
import { ChevronDown, FolderPlus, GitBranch, RefreshCw } from 'lucide-react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
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
import { RepoActivityControl } from '#/renderer/components/repo-activity/RepoActivityControl.tsx'
import { resourceBusy } from '#/renderer/stores/repos/resources.ts'
import type { ExecResult } from '#/shared/git-types.ts'

interface Props {
  repoId: string
}

export function RepoToolbarActions({ repoId }: Props) {
  return (
    <div className="flex items-center gap-1">
      <RepoActivityControl repoId={repoId} />
      <RemoteToolbarUtilities repoId={repoId} />
      <CheckoutRemoteBranchAction repoId={repoId} />
      <CreateWorktreeAction repoId={repoId} />
    </div>
  )
}

function RemoteToolbarUtilities({ repoId }: Props) {
  const t = useT()
  const refreshRemoteDiagnostics = useReposStore((s) => s.refreshRemoteDiagnostics)
  const repo = useReposStore((s) => s.repos[repoId])
  if (!repo || repo.kind !== 'remote') return null

  const diagnosticsBusy = resourceBusy(repo.resources.diagnostics)
  const retryTip = t('action.retry-diagnostics')
  return (
    <>
      <RemotePortsPopover repo={repo} />
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
    </>
  )
}

function CheckoutRemoteBranchAction({ repoId }: Props) {
  const t = useT()
  const runBranchAction = useReposStore((s) => s.runBranchAction)
  const repo = useReposStore((s) => s.repos[repoId])
  if (!repo) return null

  const branchActionBusy = repo.operations.branchAction.phase !== 'idle'
  const checkoutRemoteBranches = repo.data.branches.filter(
    (branch) => branch.remoteTracking && !branch.worktree?.path && branch.name !== repo.data.currentBranch,
  )
  if (checkoutRemoteBranches.length === 0) return null

  const checkoutTip = repo.kind === 'remote' ? t('action.checkout-on-server') : t('action.checkout-locally')
  async function handleCheckoutRemoteBranch(remoteBranch: string): Promise<void> {
    if (!repo || branchActionBusy) return
    await runBranchAction(repo.id, { kind: 'checkoutRemoteBranch', remoteBranch }, { token: repo.instanceToken })
  }

  return (
    <DropdownMenu>
      <Tip label={checkoutTip}>
        <span className="inline-flex">
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" disabled={branchActionBusy} aria-label={checkoutTip}>
              <GitBranch />
              {checkoutTip}
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

function CreateWorktreeAction({ repoId }: Props) {
  const t = useT()
  const runBranchAction = useReposStore((s) => s.runBranchAction)
  const repo = useReposStore((s) => s.repos[repoId])
  const [createOpen, setCreateOpen] = useState(false)
  const branchActionBusy = repo ? repo.operations.branchAction.phase !== 'idle' : true

  useEffect(() => {
    setCreateOpen(false)
  }, [repoId])

  async function handleCreateWorktree(request: CreateWorktreeRequest): Promise<ExecResult | null> {
    if (!repo || branchActionBusy) return null
    return runBranchAction(
      repo.id,
      {
        kind: 'createWorktree',
        worktreePath: request.worktreePath,
        newBranch: request.newBranch,
        baseBranch: request.baseBranch,
      },
      { token: repo.instanceToken, refreshOnError: false },
    )
  }

  const createTip = t('action.create-worktree-title')
  if (!repo) return null

  return (
    <>
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
    </>
  )
}
