import { ExternalLink, Plug, RefreshCw, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { CopyButton } from '#/renderer/components/CopyButton.tsx'
import { Tip } from '#/renderer/components/Tip.tsx'
import { Badge, type BadgeVariant } from '#/renderer/components/ui/badge.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '#/renderer/components/ui/popover.tsx'
import { cn } from '#/renderer/lib/cn.ts'
import { rpc } from '#/renderer/rpc.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { formatRemotePortForwardUrl, type RemotePortForwardConfig } from '#/shared/remote-ports.ts'

interface Props {
  repo: RepoState
}

export function RemotePortsPopover({ repo }: Props) {
  const t = useT()
  const [remotePort, setRemotePort] = useState('')
  const [localPort, setLocalPort] = useState('')
  const addRemotePortForward = useReposStore((s) => s.addRemotePortForward)
  const removeRemotePortForward = useReposStore((s) => s.removeRemotePortForward)
  const startRemotePortForward = useReposStore((s) => s.startRemotePortForward)
  const stopRemotePortForward = useReposStore((s) => s.stopRemotePortForward)
  const scanRemotePorts = useReposStore((s) => s.scanRemotePorts)
  const runningCount = Object.values(repo.remotePorts.sessions).filter((session) => session.status === 'running').length
  const parsedRemotePort = parsePort(remotePort)
  const parsedLocalPort = parsePort(localPort)
  const canAdd = parsedRemotePort !== null && (localPort.trim() === '' || parsedLocalPort !== null)

  function addManual(event: FormEvent) {
    event.preventDefault()
    if (!canAdd || parsedRemotePort === null) return
    const config = addRemotePortForward(repo.id, {
      remotePort: parsedRemotePort,
      requestedLocalPort: parsedLocalPort,
      label: null,
    })
    if (!config) return
    setRemotePort('')
    setLocalPort('')
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" aria-label={t('remote-ports.title')}>
          <Plug />
          {t('remote-ports.button')}
          {runningCount > 0 && (
            <Badge variant="success" className="font-mono tabular-nums">
              {runningCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-(--radix-popover-content-available-height) w-[25rem] flex-col overflow-hidden p-0"
      >
        <PopoverHeader className="border-b border-separator px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <PopoverTitle className="text-xs">{t('remote-ports.title')}</PopoverTitle>
            <Tip label={t('remote-ports.scan')}>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={repo.remotePorts.scan.phase === 'loading'}
                  onClick={() => void scanRemotePorts(repo.id)}
                  aria-label={t('remote-ports.scan')}
                >
                  <RefreshCw className={repo.remotePorts.scan.phase === 'loading' ? 'animate-spin' : undefined} />
                </Button>
              </span>
            </Tip>
          </div>
        </PopoverHeader>

        <div data-remote-port-scroll className="min-h-0 space-y-3 overflow-y-auto p-3">
          <form data-remote-port-form className="grid grid-cols-[1fr_1fr_auto] gap-2" onSubmit={addManual}>
            <PortInput
              id="remote-port-forward-remote-port"
              value={remotePort}
              onChange={setRemotePort}
              placeholder={t('remote-ports.remote-port')}
            />
            <PortInput value={localPort} onChange={setLocalPort} placeholder={t('remote-ports.local-port')} />
            <Button type="submit" variant="outline" disabled={!canAdd}>
              {t('remote-ports.add')}
            </Button>
          </form>

          <div className="space-y-1.5">
            {repo.remotePorts.configs.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                {t('remote-ports.empty')}
              </div>
            ) : (
              repo.remotePorts.configs.map((config) => (
                <RemotePortRow
                  key={config.id}
                  repo={repo}
                  config={config}
                  onStart={() => void startRemotePortForward(repo.id, config.id)}
                  onStop={() => void stopRemotePortForward(repo.id, config.id)}
                  onRemove={() => void removeRemotePortForward(repo.id, config.id)}
                />
              ))
            )}
          </div>

          {(repo.remotePorts.scan.error || repo.remotePorts.scan.message) && (
            <div className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
              {repo.remotePorts.scan.error ?? t(repo.remotePorts.scan.message ?? '')}
            </div>
          )}

          {repo.remotePorts.scan.ports.length > 0 && (
            <div className="space-y-1.5 border-t border-separator pt-3">
              <div className="text-xs font-medium text-foreground">{t('remote-ports.discovered')}</div>
              {repo.remotePorts.scan.ports.map((port) => (
                <div key={`${port.port}:${port.pid ?? ''}`} className="flex min-h-7 items-center gap-2 text-xs">
                  <span className="w-14 shrink-0 font-mono tabular-nums">:{port.port}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {port.processName ?? t('remote-ports.unknown-process')}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      addRemotePortForward(repo.id, {
                        remotePort: port.port,
                        requestedLocalPort: port.port,
                        label: port.processName,
                      })
                    }
                  >
                    {t('remote-ports.forward')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function PortInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <input
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      inputMode="numeric"
      placeholder={placeholder}
      className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
    />
  )
}

function RemotePortRow({
  repo,
  config,
  onStart,
  onStop,
  onRemove,
}: {
  repo: RepoState
  config: RemotePortForwardConfig
  onStart: () => void
  onStop: () => void
  onRemove: () => void
}) {
  const t = useT()
  const session = repo.remotePorts.sessions[config.id]
  const busy = repo.remotePorts.actionBusyByConfig[config.id] === true
  const running = session?.status === 'running'
  const url = running ? formatRemotePortForwardUrl(session) : null
  const requested = session?.requestedLocalPort ?? config.requestedLocalPort
  const requestedMismatch = running && requested !== null && requested !== session.actualLocalPort
  const status = session?.status ?? 'stopped'

  return (
    <div className="rounded-md border border-border px-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">
            {config.label ?? t('remote-ports.mapping', { remotePort: config.remotePort })}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {url ?? t('remote-ports.local-target', { localPort: config.requestedLocalPort ?? config.remotePort })}
          </div>
          {requestedMismatch && (
            <div className="truncate text-[11px] text-muted-foreground">
              {t('remote-ports.requested-local', { port: requested })}
            </div>
          )}
          {session?.message && <div className="truncate text-[11px] text-danger">{session.message}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={statusBadgeVariant(status)}>{status}</Badge>
          {url && (
            <>
              <CopyButton
                value={url}
                copyLabel={t('remote-ports.copy-url')}
                copiedLabel={t('remote-ports.copied-url')}
                className="size-6"
              />
              <Tip label={t('remote-ports.open-url')}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => void rpc.app.openExternalUrl.mutate({ url })}
                  aria-label={t('remote-ports.open-url')}
                >
                  <ExternalLink />
                </Button>
              </Tip>
            </>
          )}
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={running ? onStop : onStart}>
            {t(running ? 'remote-ports.stop' : 'remote-ports.start')}
          </Button>
          <Tip label={t('remote-ports.remove')}>
            <span className="inline-flex">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn('size-6 text-muted-foreground hover:text-danger', running && 'text-danger')}
                disabled={busy}
                onClick={onRemove}
                aria-label={t('remote-ports.remove')}
              >
                <Trash2 />
              </Button>
            </span>
          </Tip>
        </div>
      </div>
    </div>
  )
}

function parsePort(value: string): number | null {
  if (value.trim() === '') return null
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

function statusBadgeVariant(status: string): BadgeVariant {
  if (status === 'running') return 'success'
  if (status === 'failed') return 'danger'
  return 'outline'
}
