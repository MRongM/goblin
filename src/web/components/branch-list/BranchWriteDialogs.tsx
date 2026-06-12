import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { DialogFooter } from '#/web/components/ui/dialog.tsx'
import { FormDialog } from '#/web/components/ui/form-dialog.tsx'
import { Field, FieldLabel } from '#/web/components/ui/field.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/web/components/ui/select.tsx'
import { DialogError } from '#/web/components/ui/dialog-error.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'

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
