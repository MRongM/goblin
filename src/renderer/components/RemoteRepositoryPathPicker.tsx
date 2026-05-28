import { useEffect, useState } from 'react'
import { ChevronRight, Folder, Loader2 } from 'lucide-react'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { rpc } from '#/renderer/rpc.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import type { RemoteDirectoryEntry, RemoteDirectoryListing, RemoteRepoTarget } from '#/shared/remote-repo.ts'

interface Props {
  target: RemoteRepoTarget | null
  value: string
  onSelect: (path: string) => void
  onClose: () => void
}

export function RemoteRepositoryPathPicker({ target, value, onSelect, onClose }: Props) {
  const t = useT()
  const [path, setPath] = useState(value || '/')
  const [listing, setListing] = useState<RemoteDirectoryListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!target) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const home = await rpc.remote.home.query({ target })
        if (cancelled) return
        setPath(home)
        await loadDirectory(target, home, () => cancelled, setListing, setError)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [target])

  async function jump(nextPath: string) {
    if (!target || !isAbsoluteRemotePath(nextPath)) {
      setError(t('remote.path-absolute-required'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      setPath(nextPath)
      await loadDirectory(target, nextPath, () => false, setListing, setError)
    } finally {
      setLoading(false)
    }
  }

  if (!target) {
    return (
      <section className="rounded-md border border-border p-3 text-xs text-muted-foreground">
        {t('remote.picker-blocked')}
      </section>
    )
  }

  return (
    <section className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">{t('remote.picker-title')}</div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t('dialog.close')}
        </Button>
      </div>
      <div className="mb-2 flex gap-2">
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void jump(path.trim())}>
          {loading && <Loader2 className="animate-spin" />}
          {t('remote.picker-go')}
        </Button>
      </div>
      {error && <div className="mb-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div>}
      <div className="max-h-56 overflow-auto rounded-md border border-border">
        {(listing?.entries ?? []).map((entry) => (
          <DirectoryRow
            key={entry.path}
            entry={entry}
            onBrowse={() => void jump(entry.path)}
            onSelect={(selected) => {
              onSelect(selected)
              onClose()
            }}
          />
        ))}
        {!loading && listing?.entries.length === 0 && (
          <div className="px-2 py-3 text-xs text-muted-foreground">{t('remote.picker-empty')}</div>
        )}
        {loading && <div className="px-2 py-3 text-xs text-muted-foreground">{t('remote.loading')}</div>}
      </div>
      {listing?.truncated && <div className="mt-2 text-xs text-muted-foreground">{t('remote.picker-truncated')}</div>}
    </section>
  )
}

function DirectoryRow({
  entry,
  onBrowse,
  onSelect,
}: {
  entry: RemoteDirectoryEntry
  onBrowse: () => void
  onSelect: (path: string) => void
}) {
  const selectable = entry.status === 'repo' || entry.status === 'in repo'
  const unreadable = entry.status === 'unreadable'
  return (
    <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 last:border-b-0" title={entry.message}>
      <Button type="button" variant="ghost" size="icon" className="size-6" disabled={unreadable} onClick={onBrowse}>
        <ChevronRight />
      </Button>
      <Folder className="size-3.5 shrink-0 text-muted-foreground" />
      <button
        type="button"
        disabled={!selectable || unreadable}
        onClick={() => onSelect(entry.path)}
        className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-mono text-xs text-foreground disabled:cursor-default disabled:text-muted-foreground"
      >
        {entry.name}
      </button>
      <Badge variant={entry.status === 'repo' ? 'success' : entry.status === 'unreadable' ? 'warning' : 'secondary'}>
        {entry.status}
      </Badge>
    </div>
  )
}

async function loadDirectory(
  target: RemoteRepoTarget,
  path: string,
  isCancelled: () => boolean,
  setListing: (listing: RemoteDirectoryListing | null) => void,
  setError: (error: string | null) => void,
) {
  const listing = await rpc.remote.listDirectory.query({ target, path })
  if (isCancelled()) return
  setListing(listing)
  setError(listing.message ?? null)
}

function isAbsoluteRemotePath(value: string): boolean {
  return value.startsWith('/') && !value.includes('\0')
}
