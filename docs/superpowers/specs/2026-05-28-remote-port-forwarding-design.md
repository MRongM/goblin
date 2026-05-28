# Remote Port Forwarding Design

## Goal

Add first-class port forwarding to remote repository tabs, similar to VS Code Forward Port. A user can forward a TCP port from the SSH host to the local machine, then open or copy a local `127.0.0.1` URL from Goblin.

The feature is scoped to SSH remote repositories. Local repositories do not show port forwarding controls.

## Confirmed Decisions

- Use an independent main-process port forward manager.
- Support both manual forwarding and remote listening-port discovery.
- Save forward configurations per remote repository, but do not auto-start them on app launch or repo reopen.
- Expose the UI from the remote repository toolbar with a `Ports` button and popover/panel.
- Bind forwarded ports only to `127.0.0.1`.
- If the requested local port is unavailable, automatically choose another available local port and show the actual port.
- Use existing SSH target data, including SSH config aliases and optional identity file paths.
- Do not collect or store passwords, passphrases, or private key contents.
- Do not add reverse forwarding, dynamic proxying, public `0.0.0.0` binding, or arbitrary remote command execution.

## Non-Goals

- No automatic restoration of running tunnels after app restart.
- No LAN-exposed port forwarding.
- No HTTPS detection or remote service health probing.
- No remote process management beyond listing listening ports.
- No forwarding for local repositories.
- No reuse of terminal replay, resize, or xterm state for background tunnels.

## Architecture

Port forwarding is a separate capability from the embedded terminal. It runs through a dedicated main-process manager instead of `terminal-core.ts`, because tunnels are long-running background SSH processes without xterm IO, replay buffers, or resize/write operations.

Suggested module boundaries:

| Layer | Responsibility | Files |
| --- | --- | --- |
| shared model | Port config/session/listening-port types and validation helpers | `src/shared/remote-ports.ts` |
| main SSH manager | Build SSH forwarding arguments, choose local ports, spawn and stop SSH processes, track active sessions | `src/main/ssh/port-forward.ts` |
| main RPC | Validate inputs and expose controlled procedures | `src/main/rpc.ts`, `src/shared/rpc.ts` |
| renderer store | Persist configs, mirror runtime sessions, route start/stop/scan calls | `src/renderer/stores/repos/*` |
| renderer UI | Toolbar `Ports` button and popover/panel | `src/renderer/components/repo-toolbar/*` or a focused `remote-ports` component |

The renderer never constructs SSH command lines. It sends a normalized `RemoteRepoTarget` and validated port numbers to main process RPC. Main owns shell boundaries, SSH arguments, process lifecycle, and local port selection.

## Data Model

Saved configuration and runtime state are intentionally separate.

Saved per-repo configuration:

```ts
interface RemotePortForwardConfig {
  id: string
  remotePort: number
  requestedLocalPort: number | null
  label: string | null
}
```

Runtime session state:

```ts
interface RemotePortForwardSession {
  configId: string
  repoId: string
  remotePort: number
  requestedLocalPort: number | null
  actualLocalPort: number
  localHost: '127.0.0.1'
  remoteHost: '127.0.0.1'
  status: 'starting' | 'running' | 'stopped' | 'failed'
  startedAt: number
  message?: string
}
```

Remote listening-port discovery result:

```ts
interface RemoteListeningPort {
  port: number
  protocol: 'tcp'
  processName: string | null
  pid: string | null
  address: string | null
}
```

`RepoState` should keep a remote-port section:

```ts
remotePorts: {
  configs: RemotePortForwardConfig[]
  sessions: Record<string, RemotePortForwardSession>
}
```

Only `configs` are persisted. `sessions` are runtime state and should not be restored as running after an app restart.

Config IDs should be stable UUIDs generated when the config is created. IDs should not depend on port or label values, so editing a config does not cause list identity churn.

## Main Process Behavior

Starting a forward:

1. Normalize and validate `RemoteRepoTarget`.
2. Validate `remotePort` and optional `requestedLocalPort` as integer ports in `1..65535`.
3. Use `requestedLocalPort` if available, otherwise default to `remotePort`.
4. If the requested local port is unavailable, find another free local port bound to `127.0.0.1`.
5. Spawn SSH as a background process:

```text
ssh -N -L 127.0.0.1:<actualLocalPort>:127.0.0.1:<remotePort> ...
```

The existing target rules apply:

- For an SSH config alias, use the alias as the destination and do not add `-p`.
- For a manual target, use `<user>@<host>` and add `-p <port>`.
- If `identityFile` is present, pass it through `-i` after the same home expansion used by existing SSH helpers.
- Preserve `StrictHostKeyChecking=yes` and connect timeout behavior consistent with existing SSH commands.

Session management:

- Starting the same config while it is already running returns the existing session.
- Stopping a config kills only that session's SSH process.
- Closing a remote repo tab stops all active forwards for that repo.
- App/window shutdown stops all active forwards.
- If the SSH process exits unexpectedly, the manager records a failed or stopped session with stderr/exit information and notifies the renderer.

## RPC Surface

Use a focused top-level `remotePorts.*` RPC namespace. Keeping it separate from `remote.*` makes process lifecycle operations distinct from remote repository read operations.

Required procedures:

```ts
remotePorts.start(input: {
  target: RemoteRepoTarget
  config: RemotePortForwardConfig
}): Promise<RemotePortForwardSession>

remotePorts.stop(input: {
  target: RemoteRepoTarget
  configId: string
}): Promise<RemotePortForwardSession | null>

remotePorts.list(input: {
  target: RemoteRepoTarget
}): Promise<RemotePortForwardSession[]>

remotePorts.scan(input: {
  target: RemoteRepoTarget
}): Promise<{ ports: RemoteListeningPort[]; message?: string }>

remotePorts.cleanupRepo(input: {
  target: RemoteRepoTarget
}): Promise<void>
```

Renderer state can call `list` after app focus, repo activation, or process-exit events to reconcile UI state.

When a forwarding SSH process exits unexpectedly, main should emit an RPC event carrying the updated session so the renderer can update the visible status without waiting for a manual refresh.

## Remote Port Discovery

Discovery is best-effort and non-blocking. It should not prevent manual forwarding.

Main process should try common commands in order and parse the first successful output:

1. `ss -ltnp`
2. `lsof -iTCP -sTCP:LISTEN -P -n`
3. `netstat -ltnp`

If all commands fail, return an empty `ports` list with a message. The UI should show the message inline and keep the manual add controls enabled unless diagnostics or start validation fails.

The scan command is read-only and should use the existing SSH command execution boundary. It must not expose a generic remote command RPC.

## UI

Remote repository toolbar:

- Add a `Ports` button near existing remote actions.
- The button opens a popover or panel.
- Local repositories do not show this control.

Panel content:

- Header with `Remote ports` and a scan/refresh button.
- Manual add row with remote port, optional local port, and Add.
- Saved config list with Start/Stop, Open in browser, Copy URL, and Remove.
- Discovered listening-port list with a one-click Forward action.

Display rules:

- Stopped config: show `stopped` and Start.
- Starting config: show `starting` and disable conflicting actions.
- Running config: show `running` and `http://127.0.0.1:<actualLocalPort>`.
- If `actualLocalPort` differs from `requestedLocalPort`, show a subtle `requested <port>` hint.
- Failed session: keep the saved config, show the failure message, and allow retry.

Open and copy:

- Open in browser uses `http://127.0.0.1:<actualLocalPort>`.
- Copy URL copies the same HTTP URL.
- Goblin does not infer HTTPS in the first version.

Remove:

- Removing a saved config first stops its active session, then removes the config.
- This is scoped cleanup for this feature, not a destructive repository operation.

## Store And Persistence

Remote port configs belong to repo state because they are per remote repository and should travel with the remote tab state/cache.

Suggested store actions:

- `addRemotePortForward(repoId, input)`
- `removeRemotePortForward(repoId, configId)`
- `startRemotePortForward(repoId, configId)`
- `stopRemotePortForward(repoId, configId)`
- `scanRemotePorts(repoId)`
- `refreshRemotePortSessions(repoId)`

Runtime sessions should follow existing resource-state conventions. If adding a dedicated resource is too heavy, keep the state local to `remotePorts` but still model busy/error explicitly. Do not put execution queue internals on `RepoState`.

Persistence:

- Persist `configs`.
- Do not persist `sessions` as active.
- On hydrate, show saved configs as stopped.
- On remote repo close, call cleanup for that repo and clear runtime sessions.

## Error Handling

- Invalid port input returns `error.invalid-arguments` or a focused remote-port error key.
- Requested local port conflict is handled automatically by choosing a new local port.
- SSH spawn failure marks the session failed and surfaces stderr or the thrown message.
- Unexpected SSH process exit marks the session failed or stopped and keeps the config.
- Scan failure shows an inline non-blocking message.
- Starting while diagnostics are currently running can either wait for validation or return a clear busy error; the implementation should match existing resource busy behavior.
- Starting when the remote target is malformed returns `error.invalid-arguments`.

## Safety Boundaries

- Renderer never builds SSH commands.
- Only local `127.0.0.1` binding is supported.
- Only remote `127.0.0.1:<remotePort>` targets are supported.
- Only TCP port numbers in `1..65535` are accepted.
- User label text never enters SSH or shell commands.
- No credentials or private key contents are stored.
- No `-R`, `-D`, public bind address, SOCKS proxy, or arbitrary remote command RPC is introduced.
- Active SSH tunnel processes are cleaned up when the owning repo/window/app is closed.

## Testing

Main process tests:

- SSH argument construction for alias and manual targets.
- Identity file expansion and port option behavior.
- Port validation rejects invalid and out-of-range values.
- Requested local port conflict chooses a different available port.
- Start is idempotent for an already running config.
- Stop kills only the matching session.
- Repo cleanup kills only that repo's sessions.
- Unexpected child-process exit updates the session status and message.
- Parsers cover representative `ss`, `lsof`, and `netstat` outputs.
- Scan failure returns an empty list with a message.

Renderer store tests:

- Remote repo can add and remove saved configs.
- Configs are persisted, sessions are not persisted as running.
- Start and stop call the remote-port RPC and update session state.
- Closing a remote repo triggers cleanup.
- Local repos do not expose remote-port actions.

UI tests:

- Remote toolbar shows the `Ports` button.
- Popover supports manual add.
- Running state displays `127.0.0.1:<actualLocalPort>`.
- Requested/local port mismatch displays both values.
- Discovered port Forward creates a saved config.
- Failed session remains retryable.

Verification:

- `bun run test`
- `bun run typecheck`
