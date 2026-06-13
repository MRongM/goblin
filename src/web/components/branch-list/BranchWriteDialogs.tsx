import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { DialogFooter } from '#/web/components/ui/dialog.tsx'
import { FormDialog } from '#/web/components/ui/form-dialog.tsx'
import { Field, FieldLabel } from '#/web/components/ui/field.tsx'
import { Input } from '#/web/components/ui/input.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/web/components/ui/select.tsx'
import { DialogError } from '#/web/components/ui/dialog-error.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { checkoutBranchCandidates } from '#/web/components/branch-list/checkout-candidates.ts'
import { getRepositoryRemoteBranches } from '#/web/repo-client.ts'
import { deriveLocalBranchFromRemoteRef } from '#/shared/worktree-create.ts'
import { validateBranchName } from '#/shared/refnames.ts'

// ── Checkout-to dialog ────────────────────────────────────────────────────────

interface CheckoutToDialogProps {
  open: boolean
  branch: RepoBranchState
  allBranches: RepoBranchState[]
  onClose: () => void
  onCheckout: (targetBranch: string) => Promise<void>
}

export function CheckoutToDialog({ open, branch, allBranches, onClose, onCheckout }: CheckoutToDialogProps) {
  const t = useT()
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { isPending, run } = useAsyncPending<'checkout'>()

  const candidates = checkoutBranchCandidates(branch.name, allBranches)

  useEffect(() => {
    if (!open) {
      setSelected('')
      setError(null)
    }
  }, [open])

  async function handleConfirm() {
    if (!selected) return
    setError(null)
    await run('checkout', async () => {
      try {
        await onCheckout(selected)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isPending) onClose()
      }}
      title={t('action.checkout-to-title')}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleConfirm()
        }}
        className="space-y-4"
      >
        <Field>
          <FieldLabel htmlFor="checkout-to-select">{t('action.checkout-to-label')}</FieldLabel>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger id="checkout-to-select" className="w-full">
              <SelectValue placeholder={t('action.checkout-to-placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((b) => (
                <SelectItem key={b.name} value={b.name} textValue={b.name}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {candidates.length === 0 && <p className="text-xs text-muted-foreground">{t('action.checkout-to-empty')}</p>}
        </Field>
        {error && <DialogError>{error}</DialogError>}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!selected || isPending}>
            {isPending && <Loader2 className="animate-spin" />}
            {t('action.checkout-to-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}

// ── Create branch dialog ─────────────────────────────────────────────────────

interface CreateBranchDialogProps {
  open: boolean
  branch: RepoBranchState
  allBranches: RepoBranchState[]
  onClose: () => void
  onCreate: (newBranch: string, baseBranch: string) => Promise<void>
}

export function CreateBranchDialog({ open, branch, allBranches, onClose, onCreate }: CreateBranchDialogProps) {
  const t = useT()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { isPending, run } = useAsyncPending<'create'>()

  const branchName = name.trim()
  const localBranchNames = new Set(allBranches.map((b) => b.name))
  const branchError = branchName
    ? !validateBranchName(branchName).ok
      ? t('action.create-branch-invalid')
      : localBranchNames.has(branchName)
        ? t('action.create-branch-exists')
        : ''
    : ''
  const canSubmit = !!branchName && !branchError && !isPending

  useEffect(() => {
    if (!open) {
      setName('')
      setError(null)
    }
  }, [open])

  async function handleConfirm() {
    if (!canSubmit) return
    setError(null)
    await run('create', async () => {
      try {
        await onCreate(branchName, branch.name)
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isPending) onClose()
      }}
      title={t('action.create-branch-title')}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleConfirm()
        }}
        className="space-y-4"
      >
        <Field>
          <FieldLabel htmlFor="create-branch-base">{t('action.create-branch-base-label')}</FieldLabel>
          <Input id="create-branch-base" value={branch.name} readOnly />
        </Field>
        <Field>
          <FieldLabel htmlFor="create-branch-name">{t('action.create-branch-name-label')}</FieldLabel>
          <Input
            id="create-branch-name"
            value={name}
            placeholder={t('action.create-branch-placeholder')}
            aria-invalid={!!branchError}
            disabled={isPending}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          {branchError && <p className="text-xs text-danger">{branchError}</p>}
        </Field>
        {error && <DialogError>{error}</DialogError>}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {isPending && <Loader2 className="animate-spin" />}
            {t('action.create-branch-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}

// ── Track remote branch dialog ────────────────────────────────────────────────

interface TrackRemoteBranchDialogProps {
  open: boolean
  repoId: string
  allBranches: RepoBranchState[]
  onClose: () => void
  onTrack: (localBranch: string, remoteRef: string) => Promise<void>
}

export function TrackRemoteBranchDialog({
  open,
  repoId,
  allBranches,
  onClose,
  onTrack,
}: TrackRemoteBranchDialogProps) {
  const t = useT()
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [remoteRef, setRemoteRef] = useState('')
  const [localBranch, setLocalBranch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { isPending, run } = useAsyncPending<'track'>()

  useEffect(() => {
    if (!open) {
      setRemoteBranches([])
      setLoading(false)
      setRemoteRef('')
      setLocalBranch('')
      setError(null)
      return
    }
    const ctrl = new AbortController()
    setRemoteBranches([])
    setRemoteRef('')
    setLocalBranch('')
    setError(null)
    setLoading(true)
    void getRepositoryRemoteBranches(repoId, ctrl.signal)
      .then((branches) => {
        if (!ctrl.signal.aborted) setRemoteBranches(branches)
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setRemoteBranches([])
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [open, repoId])

  const localBranchNames = new Set(allBranches.map((b) => b.name))
  const selectedRemoteRef = remoteRef || remoteBranches[0] || ''
  const derivedLocalBranch = deriveLocalBranchFromRemoteRef(selectedRemoteRef) ?? ''
  const trackLocalBranch = localBranch.trim() || derivedLocalBranch
  const localBranchError = trackLocalBranch
    ? !validateBranchName(trackLocalBranch).ok
      ? t('action.track-remote-branch-invalid')
      : localBranchNames.has(trackLocalBranch)
        ? t('action.track-remote-branch-exists')
        : ''
    : ''
  const canSubmit = !!selectedRemoteRef && !!trackLocalBranch && !localBranchError && !loading && !isPending

  async function handleConfirm() {
    if (!canSubmit) return
    setError(null)
    await run('track', async () => {
      try {
        await onTrack(trackLocalBranch, selectedRemoteRef)
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isPending) onClose()
      }}
      title={t('action.track-remote-branch-title')}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleConfirm()
        }}
        className="space-y-4"
      >
        <Field>
          <FieldLabel htmlFor="track-remote-ref">{t('action.track-remote-branch-label')}</FieldLabel>
          <Select
            value={selectedRemoteRef}
            onValueChange={(next) => {
              setRemoteRef(next)
              setLocalBranch('')
            }}
            disabled={loading || remoteBranches.length === 0 || isPending}
          >
            <SelectTrigger id="track-remote-ref" className="w-full">
              <SelectValue placeholder={t('action.track-remote-branch-placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {remoteBranches.map((ref) => (
                <SelectItem key={ref} value={ref} textValue={ref}>
                  {ref}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loading ? (
            <p className="text-xs text-muted-foreground">{t('action.track-remote-branch-loading')}</p>
          ) : remoteBranches.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('action.track-remote-branch-empty')}</p>
          ) : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="track-remote-local-branch">{t('action.track-remote-branch-local-label')}</FieldLabel>
          <Input
            id="track-remote-local-branch"
            value={localBranch}
            placeholder={derivedLocalBranch || t('action.track-remote-branch-local-placeholder')}
            aria-invalid={!!localBranchError}
            disabled={isPending}
            onChange={(e) => setLocalBranch(e.currentTarget.value)}
          />
          {localBranchError && <p className="text-xs text-danger">{localBranchError}</p>}
        </Field>
        {error && <DialogError>{error}</DialogError>}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {isPending && <Loader2 className="animate-spin" />}
            {t('action.track-remote-branch-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}

// ── Merge dialog ──────────────────────────────────────────────────────────────

interface MergeDialogProps {
  open: boolean
  branch: RepoBranchState
  allBranches: RepoBranchState[]
  onClose: () => void
  onMerge: (sourceBranch: string) => Promise<void>
}

export function MergeDialog({ open, branch, allBranches, onClose, onMerge }: MergeDialogProps) {
  const t = useT()
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { isPending, run } = useAsyncPending<'merge'>()

  const candidates = allBranches.filter((b) => b.name !== branch.name)

  useEffect(() => {
    if (!open) {
      setSelected('')
      setError(null)
    }
  }, [open])

  async function handleConfirm() {
    if (!selected) return
    setError(null)
    await run('merge', async () => {
      try {
        await onMerge(selected)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isPending) onClose()
      }}
      title={t('action.merge-title')}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleConfirm()
        }}
        className="space-y-4"
      >
        <Field>
          <FieldLabel htmlFor="merge-select">{t('action.merge-label')}</FieldLabel>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger id="merge-select" className="w-full">
              <SelectValue placeholder={t('action.merge-placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((b) => (
                <SelectItem key={b.name} value={b.name} textValue={b.name}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {error && <DialogError>{error}</DialogError>}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!selected || isPending}>
            {isPending && <Loader2 className="animate-spin" />}
            {t('action.merge-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}

// ── Commit dialog ─────────────────────────────────────────────────────────────

interface CommitDialogProps {
  open: boolean
  onClose: () => void
  onCommit: (message: string) => Promise<void>
}

export function CommitDialog({ open, onClose, onCommit }: CommitDialogProps) {
  const t = useT()
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { isPending, run } = useAsyncPending<'commit'>()

  useEffect(() => {
    if (!open) {
      setMessage('')
      setError(null)
    }
  }, [open])

  async function handleConfirm() {
    if (!message.trim()) return
    setError(null)
    await run('commit', async () => {
      try {
        await onCommit(message.trim())
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isPending) onClose()
      }}
      title={t('action.commit-title')}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleConfirm()
        }}
        className="space-y-4"
      >
        <Field>
          <FieldLabel htmlFor="commit-message">{t('action.commit-message-label')}</FieldLabel>
          <textarea
            id="commit-message"
            className="w-full min-h-[80px] resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder={t('action.commit-message-placeholder')}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={isPending}
          />
        </Field>
        {error && <DialogError>{error}</DialogError>}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!message.trim() || isPending}>
            {isPending && <Loader2 className="animate-spin" />}
            {t('action.commit-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}
