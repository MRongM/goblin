import { useEffect, useMemo, useState } from 'react'
import { FileKey } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/renderer/components/ui/dialog.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { RemoteDiagnosticsPanel } from '#/renderer/components/RemoteDiagnosticsPanel.tsx'
import { RemoteRepositoryPathPicker } from '#/renderer/components/RemoteRepositoryPathPicker.tsx'
import { SshInitializationPanel } from '#/renderer/components/SshInitializationPanel.tsx'
import { rpc } from '#/renderer/rpc.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import type {
  RemoteConnectionInput,
  RemoteDiagnosticsResult,
  RemoteRepoTarget,
  SshConfigHost,
} from '#/shared/remote-repo.ts'

interface Props {
  open: boolean
  onClose: () => void
  onAddRemote: (target: RemoteRepoTarget) => Promise<void>
}

export type AddRemoteMode = 'config' | 'manual'

const DEFAULT_MANUAL_USER = 'root'
const DEFAULT_MANUAL_PORT = '22'

export function AddRemoteRepositoryDialog({ open, onClose, onAddRemote }: Props) {
  const t = useT()
  const [hosts, setHosts] = useState<SshConfigHost[]>([])
  const [mode, setMode] = useState<AddRemoteMode>('manual')
  const [alias, setAlias] = useState('')
  const [host, setHost] = useState('')
  const [user, setUser] = useState(DEFAULT_MANUAL_USER)
  const [port, setPort] = useState(DEFAULT_MANUAL_PORT)
  const [identityFile, setIdentityFile] = useState('')
  const [remotePath, setRemotePath] = useState('')
  const [target, setTarget] = useState<RemoteRepoTarget | null>(null)
  const [diagnostics, setDiagnostics] = useState<RemoteDiagnosticsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [initializingSsh, setInitializingSsh] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const portResult = useMemo(() => parseRemotePort(port), [port])
  const pending = loading || initializingSsh
  const pathError = remotePathError(remotePath)
  const canSubmit = canSubmitRemoteRepository({
    mode,
    alias,
    host,
    user,
    remotePath,
    portError: portResult.error,
    pending,
  })
  const canBrowse =
    !pending && (mode === 'config' ? alias.trim().length > 0 : host.trim().length > 0 && user.trim().length > 0)

  function clearResolvedRemoteState() {
    setTarget(null)
    setDiagnostics(null)
  }

  useEffect(() => {
    if (!open) return
    setHosts([])
    setMode('manual')
    setAlias('')
    setHost('')
    setUser(DEFAULT_MANUAL_USER)
    setPort(DEFAULT_MANUAL_PORT)
    setIdentityFile('')
    setRemotePath('')
    setTarget(null)
    setDiagnostics(null)
    setLoading(false)
    setInitializingSsh(false)
    setError(null)
    setPickerOpen(false)
    let cancelled = false
    void rpc.remote.listSshHosts
      .query()
      .then((items) => {
        if (cancelled) return
        setHosts(items)
        if (items.length > 0) {
          setMode('config')
          setAlias(items[0]?.alias ?? '')
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function resolveCurrentTarget(pathOverride?: string): Promise<RemoteRepoTarget | null> {
    const input = buildRemoteConnectionInput(
      mode,
      alias,
      host,
      user,
      portResult.port,
      pathOverride ?? remotePath,
      identityFile,
    )
    if (!input) return null
    const resolved = await rpc.remote.resolveTarget.query(input)
    setTarget(resolved.target)
    return resolved.target
  }

  async function runConnectionTest(options: { requireCanSubmit?: boolean } = {}) {
    if (options.requireCanSubmit !== false && !canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const nextTarget = await resolveCurrentTarget()
      if (!nextTarget) return
      const result = await rpc.remote.testRepository.query({ target: nextTarget })
      setDiagnostics(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function refreshSshConfigHosts() {
    try {
      const items = await rpc.remote.listSshHosts.query()
      setHosts(items)
      setAlias((currentAlias) =>
        items.some((item) => item.alias === currentAlias) ? currentAlias : (items[0]?.alias ?? ''),
      )
      if (mode === 'config' && items.length === 0) setMode('manual')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleTest() {
    await runConnectionTest()
  }

  async function handleBrowse() {
    if (!canBrowse) return
    setLoading(true)
    setError(null)
    try {
      const nextTarget = await resolveCurrentTarget(isAbsoluteRemotePath(remotePath) ? remotePath : '/')
      if (nextTarget) setPickerOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleIdentityFileBrowse() {
    setError(null)
    try {
      const selectedPath = await rpc.remote.identityFileDialog.mutate()
      if (!selectedPath) return
      setIdentityFile(selectedPath)
      clearResolvedRemoteState()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const nextTarget = await resolveCurrentTarget()
      if (!nextTarget) return
      await onAddRemote(nextTarget)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('remote.add-title')}</DialogTitle>
          <DialogDescription>{t('remote.add-description')}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
        >
          <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{t('remote.system-ssh')}</div>

          <div className="flex rounded-md border border-input p-0.5">
            <button
              type="button"
              className={modeButtonClass(mode === 'config')}
              onClick={() => {
                setMode('config')
                setAlias((currentAlias) =>
                  hosts.some((item) => item.alias === currentAlias) ? currentAlias : (hosts[0]?.alias ?? ''),
                )
                clearResolvedRemoteState()
              }}
              disabled={pending || hosts.length === 0}
            >
              {t('remote.ssh-config')}
            </button>
            <button
              type="button"
              className={modeButtonClass(mode === 'manual')}
              onClick={() => {
                setMode('manual')
                clearResolvedRemoteState()
              }}
              disabled={pending}
            >
              {t('remote.enter-manually')}
            </button>
          </div>

          {mode === 'config' ? (
            <div>
              <label className="block text-sm font-medium text-foreground" htmlFor="remote-ssh-host">
                {t('remote.ssh-host')}
              </label>
              {hosts.length > 0 ? (
                <select
                  id="remote-ssh-host"
                  value={alias}
                  disabled={pending}
                  onChange={(event) => {
                    setAlias(event.target.value)
                    clearResolvedRemoteState()
                  }}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {hosts.map((item) => (
                    <option key={item.alias} value={item.alias}>
                      {item.alias}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="mt-1 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                  <div>{t('remote.no-ssh-hosts')}</div>
                  <div>{t('remote.manual-or-config')}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_5rem]">
              <Field
                label={t('remote.host')}
                id="remote-host"
                value={host}
                disabled={pending}
                onChange={(value) => {
                  setHost(value)
                  clearResolvedRemoteState()
                }}
              />
              <Field
                label={t('remote.user')}
                id="remote-user"
                value={user}
                disabled={pending}
                onChange={(value) => {
                  setUser(value)
                  clearResolvedRemoteState()
                }}
              />
              <Field
                label={t('remote.port')}
                id="remote-port"
                value={port}
                disabled={pending}
                onChange={(value) => {
                  setPort(value)
                  clearResolvedRemoteState()
                }}
              />
            </div>
          )}

          <SshInitializationPanel
            mode={mode}
            host={host}
            user={user}
            port={portResult.port ?? 22}
            portError={portResult.error}
            disabled={loading}
            onBusyChange={setInitializingSsh}
            onInitialized={async () => {
              await runConnectionTest({ requireCanSubmit: false })
              await refreshSshConfigHosts()
            }}
          />

          <div>
            <label className="block text-sm font-medium text-foreground" htmlFor="remote-private-key">
              {t('remote.private-key')}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="remote-private-key"
                value={identityFile}
                disabled={pending}
                placeholder="~/.ssh/id_ed25519"
                onChange={(event) => {
                  setIdentityFile(event.target.value)
                  clearResolvedRemoteState()
                }}
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={pending}
                aria-label={t('remote.choose-private-key')}
                title={t('remote.choose-private-key')}
                onClick={() => void handleIdentityFileBrowse()}
              >
                <FileKey />
              </Button>
            </div>
            <div className="mt-1 text-xs leading-4 text-muted-foreground">{t('remote.private-key-help')}</div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground" htmlFor="remote-path">
              {t('remote.repository-path')}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="remote-path"
                value={remotePath}
                disabled={pending}
                onChange={(event) => {
                  setRemotePath(event.target.value)
                  clearResolvedRemoteState()
                }}
                placeholder="/srv/goblin"
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button type="button" variant="outline" disabled={!canBrowse} onClick={() => void handleBrowse()}>
                {t('remote.browse')}
              </Button>
            </div>
            <div className="mt-1 min-h-4 text-xs leading-4 text-muted-foreground">
              {portResult.error ? t(portResult.error) : pathError ? t(pathError) : target ? target.id : ''}
            </div>
          </div>

          {pickerOpen && (
            <RemoteRepositoryPathPicker
              target={target}
              value={remotePath}
              onSelect={(path) => {
                setRemotePath(path)
                clearResolvedRemoteState()
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}

          <RemoteDiagnosticsPanel diagnostics={diagnostics} loading={loading} onRetry={() => void handleTest()} />

          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('dialog.cancel')}
            </Button>
            <Button type="button" variant="outline" disabled={!canSubmit} onClick={() => void handleTest()}>
              {t('remote.test-connection')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {t('remote.add-confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function parseRemotePort(value: string): { port?: number; error: string | null } {
  const trimmed = value.trim()
  if (!trimmed) return { error: null }
  const port = Number(trimmed)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'remote.port-invalid' }
  return { port, error: null }
}

export function remotePathError(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'remote.path-required'
  if (!isAbsoluteRemotePath(trimmed)) return 'remote.path-absolute-required'
  return null
}

export function canSubmitRemoteRepository(input: {
  mode: AddRemoteMode
  alias: string
  host: string
  user: string
  remotePath: string
  portError: string | null
  pending: boolean
}): boolean {
  if (input.pending || input.portError || remotePathError(input.remotePath)) return false
  if (input.mode === 'config') return input.alias.trim().length > 0
  return input.host.trim().length > 0 && input.user.trim().length > 0
}

export function buildRemoteConnectionInput(
  mode: AddRemoteMode,
  alias: string,
  host: string,
  user: string,
  port: number | undefined,
  remotePath: string,
  identityFile: string = '',
): RemoteConnectionInput | null {
  const cleanPath = remotePath.trim()
  if (remotePathError(cleanPath)) return null
  const cleanIdentityFile = identityFile.trim()
  const auth = cleanIdentityFile ? { identityFile: cleanIdentityFile } : {}
  if (mode === 'config') {
    const cleanAlias = alias.trim()
    return cleanAlias ? { mode: 'config', alias: cleanAlias, remotePath: cleanPath, ...auth } : null
  }
  const cleanHost = host.trim()
  const cleanUser = user.trim()
  if (!cleanHost || !cleanUser) return null
  return port
    ? { mode: 'manual', host: cleanHost, user: cleanUser, port, remotePath: cleanPath, ...auth }
    : { mode: 'manual', host: cleanHost, user: cleanUser, remotePath: cleanPath, ...auth }
}

function Field({
  label,
  id,
  value,
  disabled,
  placeholder,
  onChange,
}: {
  label: string
  id: string
  value: string
  disabled: boolean
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  )
}

function isAbsoluteRemotePath(value: string): boolean {
  return value.startsWith('/') && !value.includes('\0')
}

function modeButtonClass(active: boolean): string {
  return `flex-1 rounded px-2 py-1 text-xs ${active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`
}
