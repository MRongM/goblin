import { toast } from 'sonner'
import { AddRemoteRepositoryDialog } from '#/renderer/components/AddRemoteRepositoryDialog.tsx'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { remoteTargetSubtitle, type RemoteRepoTarget } from '#/shared/remote-repo.ts'

interface RepoRemoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepoRemoteDialog({ open, onOpenChange }: RepoRemoteDialogProps) {
  const t = useT()
  const openRemoteRepo = useReposStore((s) => s.openRemoteRepo)

  async function handleAddRemote(target: RemoteRepoTarget) {
    const result = await openRemoteRepo(target)
    if (!result.ok) {
      toast.error(t('drop.open-failed'), {
        description: t(result.message),
      })
      return
    }
    toast.success(t('repo-tabs.remote-opened'), { description: remoteTargetSubtitle(target) })
  }

  return (
    <AddRemoteRepositoryDialog
      open={open}
      onClose={() => onOpenChange(false)}
      onAddRemote={handleAddRemote}
    />
  )
}
