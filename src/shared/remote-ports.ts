export interface RemotePortForwardConfig {
  id: string
  remotePort: number
  requestedLocalPort: number | null
  label: string | null
}

export type RemotePortForwardStatus = 'starting' | 'running' | 'stopped' | 'failed'

export interface RemotePortForwardSession {
  configId: string
  repoId: string
  remotePort: number
  requestedLocalPort: number | null
  actualLocalPort: number
  localHost: '127.0.0.1'
  remoteHost: '127.0.0.1'
  status: RemotePortForwardStatus
  startedAt: number
  message?: string
}

export interface RemoteListeningPort {
  port: number
  protocol: 'tcp'
  processName: string | null
  pid: string | null
  address: string | null
}

export interface RemotePortScanResult {
  ports: RemoteListeningPort[]
  message?: string
}

export interface RemotePortForwardConfigInput {
  id?: unknown
  remotePort?: unknown
  requestedLocalPort?: unknown
  label?: unknown
}

export interface RemotePortForwardUrlInput {
  localHost: '127.0.0.1'
  actualLocalPort: number
}

export function remotePortForwardConfig(input: {
  id: string
  remotePort: number
  requestedLocalPort: number | null
  label: string | null
}): RemotePortForwardConfig {
  const config = normalizeRemotePortForwardConfig(input)
  if (!config) throw new TypeError('Invalid remote port forward config')
  return config
}

export function normalizeRemotePortForwardConfig(input: RemotePortForwardConfigInput): RemotePortForwardConfig | null {
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const remotePort = normalizePort(input.remotePort)
  const requestedLocalPort = normalizeOptionalPort(input.requestedLocalPort)
  const label = normalizeLabel(input.label)
  if (!safeText(id) || remotePort === null || requestedLocalPort === undefined) return null
  return { id, remotePort, requestedLocalPort, label }
}

export function normalizeRemotePortForwardConfigs(value: unknown): RemotePortForwardConfig[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const configs: RemotePortForwardConfig[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const config = normalizeRemotePortForwardConfig(item as RemotePortForwardConfigInput)
    if (!config || seen.has(config.id)) continue
    seen.add(config.id)
    configs.push(config)
  }
  return configs
}

export function normalizeRemotePortConfigMap(value: unknown): Record<string, RemotePortForwardConfig[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([repoId, raw]) => [repoId, normalizeRemotePortForwardConfigs(raw)] as const)
    .filter(([repoId, configs]) => safeText(repoId) && configs.length > 0)
  return Object.fromEntries(entries)
}

export function isValidRemotePort(value: unknown): value is number {
  return normalizePort(value) !== null
}

export function formatRemotePortForwardUrl(input: RemotePortForwardUrlInput): string {
  return `http://${input.localHost}:${input.actualLocalPort}`
}

function normalizePort(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return null
  return value >= 1 && value <= 65535 ? value : null
}

function normalizeOptionalPort(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null
  return normalizePort(value) ?? undefined
}

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const label = value.trim()
  return safeText(label) ? label : null
}

function safeText(value: string): boolean {
  return value.length > 0 && !value.includes('\0')
}
