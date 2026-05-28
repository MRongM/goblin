import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge, type BadgeVariant } from '#/renderer/components/ui/badge.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import type {
  RemoteDiagnosticCategory,
  RemoteDiagnosticStage,
  RemoteDiagnosticStageName,
  RemoteDiagnosticsResult,
} from '#/shared/remote-repo.ts'
import { useT } from '#/renderer/stores/i18n.ts'

const STAGE_ORDER: RemoteDiagnosticStageName[] = ['ssh', 'shell', 'git', 'path', 'repo']

const DEFAULT_STAGES: RemoteDiagnosticStage[] = STAGE_ORDER.map((name) => ({
  name,
  label: stageLabel(name),
  status: 'pending',
}))

interface Props {
  diagnostics: RemoteDiagnosticsResult | null
  loading: boolean
  onRetry: () => void
}

export function RemoteDiagnosticsPanel({ diagnostics, loading, onRetry }: Props) {
  const t = useT()
  const [showDetails, setShowDetails] = useState(false)
  const stages = diagnostics?.stages?.length ? diagnostics.stages : DEFAULT_STAGES
  const details = diagnostics?.details || diagnostics?.stages.map((stage) => stage.details).filter(Boolean).join('\n')

  return (
    <section className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">{t('remote.diagnostics-title')}</div>
        <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={onRetry}>
          {loading && <Loader2 className="animate-spin" />}
          {t('remote.retry-diagnostics')}
        </Button>
      </div>
      <div className="space-y-1.5">
        {stages.map((stage) => (
          <div key={stage.name} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{stage.label || stageLabel(stage.name)}</span>
            <Badge variant={stageVariant(stage, loading)}>{stage.category ?? stage.status}</Badge>
          </div>
        ))}
      </div>
      {diagnostics?.category && (
        <div className="mt-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          {diagnosticCategoryMessage(diagnostics.category)}
        </div>
      )}
      {details && (
        <div className="mt-2">
          <Button type="button" variant="ghost" size="sm" className="px-0" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? t('remote.hide-details') : t('remote.show-details')}
          </Button>
          {showDetails && (
            <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[10px] text-muted-foreground">
              {details}
            </pre>
          )}
        </div>
      )}
    </section>
  )
}

export function diagnosticCategoryMessage(category: RemoteDiagnosticCategory): string {
  switch (category) {
    case 'host key':
      return 'Host key verification failed. Confirm the host in your system SSH setup, then retry.'
    case 'auth failed':
      return 'Authentication failed. Check your system SSH config, ssh-agent, or key access, then retry.'
    case 'unreachable':
      return 'The SSH host could not be reached. Check the host name, network, VPN, or port.'
    case 'git missing':
      return 'Git was not found on the remote host.'
    case 'path missing':
      return 'The remote path does not exist or is not a directory.'
    case 'not a repo':
      return 'The remote path is not a Git repository.'
    case 'timeout':
      return 'The SSH check timed out.'
    case 'cancelled':
      return 'The SSH check was cancelled.'
    case 'shell failed':
      return 'Goblin reached SSH, but the remote shell did not run the setup check.'
    case 'config changed':
      return 'The SSH config now resolves to a different target.'
    case 'unknown':
      return 'The remote check failed for an unknown reason.'
  }
}

function stageVariant(stage: RemoteDiagnosticStage, loading: boolean): BadgeVariant {
  if (loading && stage.status === 'pending') return 'secondary'
  if (stage.status === 'passed') return 'success'
  if (stage.status === 'failed') return 'warning'
  if (stage.status === 'skipped') return 'secondary'
  return 'outline'
}

function stageLabel(name: RemoteDiagnosticStageName): string {
  switch (name) {
    case 'ssh':
      return 'SSH reachable'
    case 'shell':
      return 'Shell available'
    case 'git':
      return 'Git installed'
    case 'path':
      return 'Path exists'
    case 'repo':
      return 'Git repository valid'
  }
}
