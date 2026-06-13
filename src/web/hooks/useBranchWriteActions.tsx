import { createElement } from 'react'
import type { ReactNode } from 'react'
import { GitBranch, GitBranchPlus, GitMerge, RadioTower, RotateCcw, SendHorizontal } from 'lucide-react'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useRetainedDialogState } from '#/web/hooks/useRetainedDialogState.ts'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import {
  CheckoutToDialog,
  CommitDialog,
  CreateBranchDialog,
  MergeDialog,
  TrackRemoteBranchDialog,
} from '#/web/components/branch-list/BranchWriteDialogs.tsx'
import {
  checkoutBranchInWorktree,
  commitRepositoryChanges,
  mergeRepositoryBranch,
  resetRepositoryHard,
} from '#/web/repo-client.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { BranchActionItem } from '#/web/hooks/useBranchActionItems.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'

interface BranchWriteActions {
  mainItems: BranchActionItem[]
  destructiveItems: BranchActionItem[]
  dialogs: ReactNode
}

export function useBranchWriteActions(repo: BranchActionRepo, branch: RepoBranchState): BranchWriteActions {
  const t = useT()
  const setLastResult = useReposStore((s) => s.setLastResult)
  const submitBranchAction = useReposStore((s) => s.submitBranchAction)
  const allBranches = useReposStore((s) => s.repos[repo.id]?.data.branches ?? [])

  const worktreePath = branch.worktree?.path
  const hasWorktree = !!worktreePath
  const branchActionBusy = repo.operations.branchAction.phase !== 'idle'

  const checkoutToDialog = useRetainedDialogState<string>()
  const createBranchDialog = useRetainedDialogState<string>()
  const trackRemoteBranchDialog = useRetainedDialogState<string>()
  const mergeDialog = useRetainedDialogState<string>()
  const commitDialog = useRetainedDialogState<string>()
  const resetDialog = useRetainedDialogState<string>()

  async function handleCheckoutTo(targetBranch: string) {
    if (!worktreePath) return
    const result = await checkoutBranchInWorktree(repo.id, worktreePath, targetBranch)
    setLastResult(repo.id, result, repo.instanceToken)
    if (!result.ok) throw new Error(result.message)
    checkoutToDialog.close()
  }

  async function handleCreateBranch(newBranch: string, baseBranch: string) {
    if (branchActionBusy) return
    submitBranchAction(
      repo.id,
      { kind: 'createBranch', branch: newBranch, baseBranch },
      { token: repo.instanceToken },
    )
  }

  async function handleTrackRemoteBranch(localBranch: string, remoteRef: string) {
    if (branchActionBusy) return
    submitBranchAction(
      repo.id,
      { kind: 'trackRemoteBranch', localBranch, remoteRef },
      { token: repo.instanceToken },
    )
  }

  async function handleMerge(sourceBranch: string) {
    if (!worktreePath) return
    const result = await mergeRepositoryBranch(repo.id, worktreePath, sourceBranch)
    setLastResult(repo.id, result, repo.instanceToken)
    if (!result.ok) throw new Error(result.message)
    mergeDialog.close()
  }

  async function handleCommit(message: string) {
    if (!worktreePath) return
    const result = await commitRepositoryChanges(repo.id, worktreePath, message)
    setLastResult(repo.id, result, repo.instanceToken)
    if (!result.ok) throw new Error(result.message)
    commitDialog.close()
  }

  function handleResetHard() {
    if (!worktreePath) return
    void resetRepositoryHard(repo.id, worktreePath).then((result) => {
      setLastResult(repo.id, result, repo.instanceToken)
    })
    resetDialog.close()
  }

  const mainItems: BranchActionItem[] = [
    {
      id: 'createBranch',
      label: t('action.create-branch'),
      title: t('action.create-branch-title'),
      disabled: branchActionBusy,
      visible: true,
      icon: createElement(GitBranchPlus),
      onSelect: () => createBranchDialog.openWith(''),
    },
    {
      id: 'trackRemoteBranch',
      label: t('action.track-remote-branch'),
      title: t('action.track-remote-branch-title'),
      disabled: branchActionBusy,
      visible: repo.remote.hasRemotes === true,
      icon: createElement(RadioTower),
      onSelect: () => trackRemoteBranchDialog.openWith(''),
    },
    {
      id: 'checkoutTo',
      label: t('action.checkout-to'),
      title: t('action.checkout-to-title'),
      disabled: false,
      visible: hasWorktree,
      icon: createElement(GitBranch),
      onSelect: () => checkoutToDialog.openWith(''),
    },
    {
      id: 'merge',
      label: t('action.merge'),
      title: t('action.merge-title'),
      disabled: false,
      visible: hasWorktree,
      icon: createElement(GitMerge),
      onSelect: () => mergeDialog.openWith(''),
    },
    {
      id: 'commit',
      label: t('action.commit'),
      title: t('action.commit-title'),
      disabled: false,
      visible: hasWorktree,
      icon: createElement(SendHorizontal),
      onSelect: () => commitDialog.openWith(''),
    },
  ]

  const destructiveItems: BranchActionItem[] = [
    {
      id: 'resetHard',
      label: t('action.reset-hard'),
      disabled: false,
      visible: hasWorktree,
      destructive: true,
      icon: createElement(RotateCcw),
      onSelect: () => resetDialog.openWith(''),
    },
  ]

  const dialogs = (
    <>
      <CheckoutToDialog
        open={checkoutToDialog.open}
        branch={branch}
        allBranches={allBranches}
        onClose={checkoutToDialog.close}
        onCheckout={handleCheckoutTo}
      />
      <CreateBranchDialog
        open={createBranchDialog.open}
        branch={branch}
        allBranches={allBranches}
        onClose={createBranchDialog.close}
        onCreate={handleCreateBranch}
      />
      <TrackRemoteBranchDialog
        open={trackRemoteBranchDialog.open}
        repoId={repo.id}
        allBranches={allBranches}
        onClose={trackRemoteBranchDialog.close}
        onTrack={handleTrackRemoteBranch}
      />
      <MergeDialog
        open={mergeDialog.open}
        branch={branch}
        allBranches={allBranches}
        onClose={mergeDialog.close}
        onMerge={handleMerge}
      />
      <CommitDialog
        open={commitDialog.open}
        onClose={commitDialog.close}
        onCommit={handleCommit}
      />
      <ConfirmDialog
        open={resetDialog.open}
        title={t('action.confirm-reset-hard-title')}
        message={t('action.confirm-reset-hard-body')}
        confirmLabel={t('action.confirm-reset-hard-confirm')}
        destructive
        onCancel={resetDialog.close}
        onConfirm={handleResetHard}
      />
    </>
  )

  return { mainItems, destructiveItems, dialogs }
}
