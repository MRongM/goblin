export type AiCliProvider = 'codex' | 'claude'

export type AiCliStatus = 'starting' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'

export interface AiCliExecutionState {
  provider: AiCliProvider
  status: AiCliStatus
  updatedAt: number
}

export interface DetectAiCliExecutionStateInput {
  processName: string
  chunk: string
  previous: AiCliExecutionState | null
}

const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/gu
const SHELL_COMMAND_RE =
  /(?:^|[\r\n])\s*(?:[$>%#]\s*)?(?:(?:npx|bunx|npm|pnpm|yarn|corepack)\s+)?(?:(?:exec|dlx)\s+)?(?:\S*\/)?(codex|claude)(?:\s|$)/iu
const SHELL_COMMAND_WITH_PREFIX_RE =
  /(?:^|[\r\n])\s*(?:\[[^\r\n]*\]\s*)?(?:[^$%#>➜❯\r\n]*\s+)?(?:[$%#]|>|➜|❯)\s+(?:(?:npx|bunx|npm|pnpm|yarn|corepack)\s+)?(?:(?:exec|dlx)\s+)?(?:\S*\/)?(codex|claude)(?:\s|$)/iu
const WAITING_RE =
  /\b(waiting|approval|approve|allow|confirm|select|choose|permission|press enter|yes\/no|\[y\/n\]|\[y\/N\])\b/iu
const FAILED_RE = /\b(error|failed|failure|exception|timed out|timeout)\b/iu
const CANCELLED_RE = /\b(cancelled|canceled|aborted|interrupted)\b/iu
const SUCCEEDED_RE = /\b(done|completed|success|succeeded|finished|exit code 0)\b/iu
const RUNNING_RE = /\b(thinking|working|running|processing|executing|reading|writing)\b/iu
const GENERIC_PROMPT_RE =
  /^(?:\[[^\r\n]*\]\s*)?(?:\S.*\s+)?(?:\$|%|#|>|➜|❯)\s*$/u
const SHELL_PROMPT_RE =
  /^(?:\[[^\r\n]*\]\s*)?(?:[a-zA-Z0-9_./:~-]+@[\w.-]+:[^$#%>\r\n]*|[A-Za-z0-9_./:~-]+|~\/?[^$#%>\r\n]*|PS\s+[^>\r\n]+>|[#$%>])\s*$/u
const TERMINAL_STATUSES = new Set<AiCliStatus>(['succeeded', 'failed', 'cancelled'])

export function detectAiCliExecutionState(input: DetectAiCliExecutionStateInput): AiCliExecutionState | null {
  try {
    const chunk = stripAnsi(input.chunk)
    const provider = detectProvider(input.processName, chunk, input.previous)
    if (!provider) return null
    const status = detectStatus(chunk, input.previous?.provider === provider ? input.previous.status : null)
    const previous = input.previous?.provider === provider ? input.previous : null
    if (previous && previous.status === status) return previous
    return { provider, status, updatedAt: Date.now() }
  } catch {
    return input.previous
  }
}

export function aiCliBusy(state: AiCliExecutionState | null | undefined): boolean {
  return state?.status === 'starting' || state?.status === 'running'
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
}

function detectProvider(
  processName: string,
  chunk: string,
  previous: AiCliExecutionState | null,
): AiCliProvider | null {
  const normalizedProcess = processName.trim().toLowerCase()
  if (normalizedProcess.includes('codex')) return 'codex'
  if (normalizedProcess.includes('claude')) return 'claude'
  const commandProvider =
    SHELL_COMMAND_RE.exec(chunk)?.[1]?.toLowerCase() ?? SHELL_COMMAND_WITH_PREFIX_RE.exec(chunk)?.[1]?.toLowerCase()
  if (commandProvider === 'codex' || commandProvider === 'claude') return commandProvider
  return previous?.provider ?? null
}

function detectStatus(chunk: string, previousStatus: AiCliStatus | null): AiCliStatus {
  if (CANCELLED_RE.test(chunk)) return 'cancelled'
  if (FAILED_RE.test(chunk)) return 'failed'
  if (SUCCEEDED_RE.test(chunk)) return 'succeeded'
  if (WAITING_RE.test(chunk)) return 'waiting'
  if (previousStatus && (previousStatus === 'starting' || previousStatus === 'running') && looksLikePrompt(chunk)) {
    return 'waiting'
  }
  if (RUNNING_RE.test(chunk)) return 'running'
  if (previousStatus && TERMINAL_STATUSES.has(previousStatus)) return previousStatus
  if (previousStatus === 'waiting') return 'waiting'
  return 'running'
}

function looksLikePrompt(chunk: string): boolean {
  const lines = chunk.split(/\r?\n/).map((line) => line.trim())
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].length === 0) continue
    if (SHELL_PROMPT_RE.test(lines[i])) return true
    if (lines[i].length <= 120 && GENERIC_PROMPT_RE.test(lines[i])) return true
  }
  return false
}
