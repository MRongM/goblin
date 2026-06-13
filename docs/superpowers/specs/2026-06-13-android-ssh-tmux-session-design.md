# Android SSH Tmux Session Design

## Summary

Android built-in SSH remote terminals should prefer a remote tmux session for each workspace path. If tmux is available, Goblin attaches to or creates a stable tmux session so the remote shell can survive SSH disconnects. If tmux is missing or cannot start, Goblin falls back to the existing native SSH shell behavior and keeps the terminal usable.

This design only applies to the Android built-in SSH terminal. External Termux handoff remains unchanged.

## Goals

- Detect tmux when opening an Android built-in SSH remote terminal.
- Use one stable tmux session per `user@host:port + remotePath`.
- Reconnect to the same tmux session after Android network loss, SSH disconnect, or app restart.
- Let other SSH clients see the same terminal output when they attach to the same tmux session.
- Fall back to native SSH shell when tmux is unavailable or tmux startup fails.
- Keep existing SSH authentication, host-key trust, PTY allocation, session records, reconnect, foreground service, emulator, and UI behavior intact.

## Non-Goals

- Do not change external Termux handoff commands.
- Do not add UI toggles, badges, or settings for tmux.
- Do not persist tmux metadata in `TerminalSessionRecord`.
- Do not add tmux list, kill, cleanup, or read-only attach controls.
- Do not synchronize output from unrelated SSH shells that are not attached to the same tmux session.
- Do not make tmux a hard dependency for Android SSH terminals.

## Current State

`SshTerminalService` opens an SSHJ session, allocates an `xterm-256color` PTY, starts a shell, starts a reader thread, and schedules startup input from `SshTerminalStartupCommand.initialInputForRemotePath(remotePath)`.

The current startup input only enters the selected workspace:

```sh
cd '<remotePath>' && pwd
```

This means terminal lifetime depends on the SSH shell. If the SSH connection is lost, running shell state and full-screen terminal programs are lost unless the remote command itself survives independently.

`TerminalSessionManager`, `TerminalController`, the Android emulator layer, and terminal UI already support reconnecting Goblin's local session record. They do not currently provide remote process continuity.

## Selected Approach

Use a startup shell script injected into the existing SSHJ shell after PTY allocation.

The script checks for `tmux` on the remote host. If present, it changes into the selected workspace and runs tmux in the foreground:

```sh
tmux new-session -A -s '<stable-session-name>'
```

If tmux is not present, it changes into the workspace and executes the user's shell:

```sh
exec "${SHELL:-sh}"
```

If tmux exits successfully, the remote shell exits. If tmux returns a startup error, the script prints one short diagnostic line and then falls back to the same native shell path.

This keeps the change in the SSH startup boundary and avoids new lifecycle ownership in `TerminalSessionManager`.

## Alternatives Considered

### Direct SSHJ exec Command

Allocate PTY and run one composed remote command through SSHJ `exec(...)` instead of `startShell()` plus startup input.

This makes the remote command more explicit, but it changes the current shell channel behavior and increases risk around input, output, and exit handling.

### Separate Probe Channel

Open a separate SSH command or channel to detect tmux before opening the terminal shell.

This separates detection from terminal startup, but adds another remote operation, more authentication and failure cases, and no clear user benefit for this scope.

### Selected Startup Script

The startup script is the smallest compatible change. It reuses the current PTY shell, reader thread, input path, write watchdog, reconnect flow, and tests around startup command generation.

## Architecture

### `SshTerminalService`

Keep current responsibilities:

- Create SSHJ client.
- Apply keepalive.
- Verify host key.
- Authenticate.
- Allocate PTY.
- Start shell.
- Read output.
- Write input.
- Resize and close the shell.

Change only startup input construction:

- Call a target-aware startup helper after `startShell()`.
- Schedule the generated input through the existing delayed startup input path.

### `SshTerminalStartupCommand`

Extend the helper from path-only `cd` input to target-aware terminal startup input.

Expected helper shape:

- `initialInputForTarget(target: RemoteTarget): String?`
- `tmuxSessionName(target: RemoteTarget): String`
- existing `startupInputFailureOutput(error: Throwable): String`

The tmux session name is derived from `target.authority` and normalized `remotePath`. It should be stable and shell-safe, for example `goblin-<shortHash>`.

The session name must:

- contain only safe characters such as ASCII letters, digits, `_`, and `-`;
- be bounded in length;
- avoid embedding raw paths directly;
- map the same `user@host:port + remotePath` to the same value;
- map different remote paths to different values with practical collision resistance.

### Unchanged Components

`TerminalController`, `TerminalSessionManager`, the emulator controller, foreground service, persistence store, and Compose UI should not learn about tmux. They still operate against a single interactive SSH PTY.

## Startup Script Semantics

For a selected workspace path:

1. Normalize a blank path to `/`.
2. Quote the path with existing shell-quoting rules.
3. Check `command -v tmux >/dev/null 2>&1`.
4. If tmux exists:
   - `cd` into the workspace.
   - run `tmux new-session -A -s '<session>'` in the foreground.
   - if tmux exits with status `0`, exit the startup shell with status `0`.
   - if tmux exits with a non-zero status, print `tmux unavailable (exit <status>); falling back to shell`.
   - `exec "${SHELL:-sh}"`.
5. If tmux does not exist:
   - `cd` into the workspace.
   - `exec "${SHELL:-sh}"`.

If `cd` fails, do not create tmux from the wrong directory. Let the shell show the `cd` failure and exit so the existing terminal failure/exit diagnostics remain responsible for the session outcome.

## Reconnect And Multi-Client Behavior

Goblin cannot resume the original SSH transport. It can reconnect to the same remote tmux session.

When Android loses network, SSH disconnects, or the app restarts, the remote tmux session continues on the server if the server and tmux server remain alive. A later Goblin reconnect to the same `user@host:port + remotePath` runs the same startup script and attaches to the existing tmux session.

Other SSH clients can see the same terminal state only when they attach to the same tmux session. This is tmux multi-client behavior, not Goblin output broadcasting. A separate plain SSH shell that is not attached to the tmux session is unrelated and will not be visible in Goblin.

Multiple clients attached to the same tmux session share interactive state. Input from one client is visible to the others.

## Error Handling

- tmux missing: silently fall back to native shell.
- tmux startup failure: print one clear diagnostic line with the exit status, then fall back to native shell.
- tmux normal exit: exit the startup shell normally.
- workspace `cd` failure: do not hide the shell error or start tmux from another directory.
- startup input write failure: keep using `startupInputFailureOutput(error)`.
- blocked writes and half-open SSH connections: keep existing write timeout and heartbeat behavior.

## Testing

Add focused JVM tests around startup command generation:

- Remote workspace startup input includes tmux detection.
- Startup input includes `tmux new-session -A -s`.
- Startup input includes native shell fallback.
- tmux session name is stable for the same target.
- different remote paths generate different session names.
- tmux session name only contains safe characters and is length-bounded.
- paths with spaces and single quotes are shell-quoted correctly.
- root path uses `cd '/'` and still uses tmux-first startup.
- the script does not embed raw unquoted path values in command positions.

Update old path-only expectations:

- remove the assertion that startup input does not contain `exec`;
- update path-only `cd && pwd` tests to the new tmux-first startup semantics.

Run verification:

- `./gradlew test`
- `bun run typecheck`
- `bun run test`

## Acceptance Criteria

- Opening an Android built-in SSH terminal for a workspace on a host with tmux attaches to or creates the stable workspace tmux session.
- Closing or losing SSH does not kill the remote tmux session.
- Reconnecting the same workspace attaches back to the same tmux session when it still exists.
- Another SSH client attached to the same tmux session sees the same terminal state and subsequent output.
- Hosts without tmux still open a usable native SSH shell.
- tmux startup failure falls back to a usable native SSH shell after showing a short diagnostic.
- External Termux handoff behavior is unchanged.
