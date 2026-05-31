import { useEffect, useId, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, Fingerprint, KeyRound, Loader2 } from 'lucide-react'
import { Button } from '#/renderer/components/ui/button.tsx'
import { rpc } from '#/renderer/rpc.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import type { SshHostKeyConfirmation } from '#/shared/remote-repo.ts'

type AddRemoteMode = 'config' | 'manual'
type SshInitStatus = 'idle' | 'preparing' | 'awaiting-host-key' | 'installing' | 'success' | 'error'

interface Props {
  mode: AddRemoteMode
  host: string
  user: string
  port: number
  portError: string | null
  disabled: boolean
  onBusyChange?: (busy: boolean) => void
  onInitialized?: () => void | Promise<void>
}

export function SshInitializationPanel({
  mode,
  host,
  user,
  port,
  portError,
  disabled,
  onBusyChange,
  onInitialized,
}: Props) {
  const t = useT()
  const contentId = useId()
  const [expanded, setExpanded] = useState(false)
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<SshInitStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<SshHostKeyConfirmation | null>(null)

  const connection = useMemo(
    () => ({
      host: host.trim(),
      user: user.trim(),
      port,
    }),
    [host, port, user],
  )
  const busy = status === 'preparing' || status === 'installing'
  const canInitialize = canInitializeSshAccess({
    mode,
    host: connection.host,
    user: connection.user,
    password,
    portError,
    disabled,
    busy,
  })

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  useEffect(() => {
    setPassword('')
    setStatus('idle')
    setMessage(null)
    setConfirmation(null)
  }, [connection.host, connection.port, connection.user, mode])

  if (mode !== 'manual') return null

  async function installAccess() {
    setStatus('installing')
    setMessage(null)
    const result = await rpc.remote.initializeSshAccess.mutate({ ...connection, password })
    if (!result.ok) {
      setStatus('error')
      setMessage(t(result.message))
      return
    }

    setPassword('')
    setStatus('success')
    setMessage(t('remote.ssh-init-success'))
    await onInitialized?.()
  }

  async function handleInitialize() {
    if (!canInitialize) return
    setStatus('preparing')
    setMessage(null)
    setConfirmation(null)

    try {
      const prepared = await rpc.remote.prepareSshInit.query(connection)
      if (!prepared.ok) {
        setStatus('error')
        setMessage(t(prepared.message))
        return
      }
      if (prepared.hostKeyStatus === 'needs-confirmation') {
        setStatus('awaiting-host-key')
        setMessage(null)
        setConfirmation(prepared.confirmation)
        return
      }
      if (prepared.hostKeyStatus === 'changed') {
        setStatus('awaiting-host-key')
        setMessage(t('error.ssh-host-key-changed'))
        setConfirmation(prepared.confirmation)
        return
      }
      await installAccess()
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleTrustHostKey() {
    if (!confirmation || busy) return
    setStatus('installing')
    setMessage(null)

    try {
      const trusted = await rpc.remote.trustSshHostKey.mutate({
        host: connection.host,
        port: connection.port,
        key: confirmation.key,
        fingerprint: confirmation.fingerprint,
      })
      if (!trusted.ok) {
        setStatus('error')
        setMessage(t(trusted.message))
        return
      }
      await installAccess()
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="rounded-md border border-border bg-muted/30 p-3" aria-label={t('remote.ssh-init-title')}>
      <button
        type="button"
        className="flex w-full items-start gap-3 text-left"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
      >
        <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">{t('remote.ssh-init-title')}</span>
          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{t('remote.ssh-init-help')}</span>
        </span>
        <ChevronDown
          className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <div id={contentId} className="mt-3 space-y-3 pl-7">
          <div>
            <label className="block text-xs font-medium text-foreground" htmlFor="remote-ssh-init-password">
              {t('remote.ssh-init-password')}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="remote-ssh-init-password"
                type="password"
                value={password}
                disabled={disabled || busy}
                autoComplete="off"
                onChange={(event) => setPassword(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button type="button" variant="outline" disabled={!canInitialize} onClick={() => void handleInitialize()}>
                {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
                {busy ? t('remote.ssh-init-working') : t('remote.ssh-init-button')}
              </Button>
            </div>
          </div>

          {confirmation && (
            <div className="rounded-md border border-border bg-background px-3 py-2 text-xs">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Fingerprint className="size-3.5" />
                {t('remote.ssh-init-host-key')}
              </div>
              {message && <div className="mt-2 text-destructive">{message}</div>}
              <div className="mt-1 break-all font-mono text-muted-foreground">{confirmation.fingerprint}</div>
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setStatus('idle')
                    setMessage(null)
                    setConfirmation(null)
                  }}
                >
                  {t('dialog.cancel')}
                </Button>
                <Button type="button" size="sm" disabled={busy} onClick={() => void handleTrustHostKey()}>
                  {busy ? <Loader2 className="animate-spin" /> : <Fingerprint />}
                  {t('remote.ssh-init-trust')}
                </Button>
              </div>
            </div>
          )}

          {status === 'success' && message && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              {message}
            </div>
          )}
          {status === 'error' && message && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{message}</div>
          )}
        </div>
      )}
    </section>
  )
}

export function canInitializeSshAccess(input: {
  mode: AddRemoteMode
  host: string
  user: string
  password: string
  portError: string | null
  disabled: boolean
  busy: boolean
}): boolean {
  if (input.mode !== 'manual' || input.disabled || input.busy || input.portError) return false
  return input.host.trim().length > 0 && input.user.trim().length > 0 && input.password.length > 0
}
