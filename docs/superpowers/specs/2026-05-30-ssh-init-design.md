# SSH Initialization For Manual Remote Repositories Design

## Goal

Add a one-click SSH initialization flow to the Add remote SSH repository dialog so a user can prepare passwordless SSH access for a manually entered remote host before adding the repository.

The flow must:

- Check whether the local default SSH public/private key exists.
- Generate `~/.ssh/id_ed25519` when no default key exists.
- Recreate `~/.ssh/id_ed25519.pub` from the private key when only the public key is missing.
- Use a temporary server password to install the public key on the remote host.
- Never persist the password, private key contents, or private key passphrase.
- Automatically run the existing remote repository diagnostics after public key installation succeeds.

## Non-Goals

- Do not support SSH config mode initialization in this phase.
- Do not save server passwords, private key contents, or passphrases.
- Do not add a general-purpose remote shell RPC.
- Do not overwrite or reset remote `authorized_keys`.
- Do not silently accept or replace host keys.
- Do not store `~/.ssh/id_ed25519` as `RemoteRepoTarget.identityFile`; default OpenSSH behavior should find it.

## User Flow

The initialization entry appears only in manual mode, directly below the `host/user/port` inputs.

1. The user enters `host`, `user`, and optional `port`.
2. The user clicks `Initialize SSH access`.
3. Goblin checks the local default SSH key.
4. If the host key is unknown, Goblin shows the host, port, key type, and SHA256 fingerprint. The user must confirm before Goblin writes to `known_hosts`.
5. Goblin asks for the temporary server password.
6. Goblin installs the public key on the remote host with duplicate-key protection.
7. Goblin clears the password from renderer state.
8. Goblin runs the existing `remote.testRepository` diagnostics.
9. The user continues with browse, test connection, or add repository in the existing dialog.

SSH config mode should either hide the initialization entry or show a short disabled hint explaining that initialization is available only for manual host/user input.

## Architecture

Add a narrow main-process SSH initialization module:

```text
src/main/ssh/initialization.ts
```

This module owns:

- local key discovery and generation,
- public key material reads,
- host key probing and fingerprint calculation,
- `known_hosts` writes after user confirmation,
- public key installation through password-authenticated SSH.

Renderer owns only form state and UI state. It may temporarily hold the password in React state while the initialization operation is pending, but must clear it after success, failure, cancellation, or dialog close.

The existing remote repository model remains unchanged. `RemoteRepoTarget` continues to represent an SSH target and must not gain any password-like fields.

## RPC Surface

Expose controlled procedures under `remote.*`:

```ts
remote.prepareSshInit({
  host: string
  user: string
  port?: number
})

remote.trustSshHostKey({
  host: string
  port: number
  key: string
  fingerprint: string
})

remote.initializeSshAccess({
  host: string
  user: string
  port: number
  password: string
})
```

`prepareSshInit` returns a small state object:

- key status: existing, generated, or public-key-recreated;
- host key status: trusted, unknown and needs confirmation, or changed and blocked;
- host key line, key type, and SHA256 fingerprint details when confirmation is needed.

`trustSshHostKey` writes only a host key for the same host/port pair. Main must recompute or verify the provided key's SHA256 fingerprint before appending it to `known_hosts`; renderer confirmation is not enough by itself.

`initializeSshAccess` installs the public key. It must not include the password in command arguments, logs, returned error details, or persistent state.

## Local Key Handling

Use system-default OpenSSH paths:

```text
~/.ssh/id_ed25519
~/.ssh/id_ed25519.pub
```

Behavior:

- If both private and public key exist, use them.
- If the private key exists and the public key is missing, run `ssh-keygen -y -f ~/.ssh/id_ed25519` and write the `.pub` file.
- If neither exists, create `~/.ssh` with mode `700`, then run:

```text
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -C "goblin@<local-hostname>"
```

After generation, ensure the private key is mode `600` and the public key is readable by the current user.

The generated key has no passphrase. This matches the one-click goal and avoids adding passphrase handling or storage.

## Host Key Handling

Before password installation, Goblin checks whether the host key is already trusted.

Allowed states:

- Trusted: continue.
- Unknown: use `ssh-keyscan -p <port> <host>` and `ssh-keygen -lf - -E sha256` or equivalent parsing to show a fingerprint. Continue only after user confirmation.
- Changed: stop and show a high-risk warning. Goblin must not overwrite or remove existing `known_hosts` entries.

Confirmed unknown host keys are appended to the current user's `known_hosts`. The write should preserve existing entries.

The append line must be built in main from the verified host, port, and key material. It must not accept an arbitrary preformatted `known_hosts` line from renderer input.

## Public Key Installation

Installation targets the remote user's `~/.ssh/authorized_keys`.

Preferred behavior:

1. Use local `ssh-copy-id` when available and compatible.
2. Fall back to an equivalent SSH command that runs a POSIX `sh` script remotely.

The equivalent remote script should:

```sh
umask 077
mkdir -p "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
grep -qxF "<public-key>" "$HOME/.ssh/authorized_keys" || printf '%s\n' "<public-key>" >> "$HOME/.ssh/authorized_keys"
chmod 700 "$HOME/.ssh"
chmod 600 "$HOME/.ssh/authorized_keys"
```

The implementation must shell-quote the public key and remote script safely. Re-running initialization with the same key is success and should not duplicate the key.

Password handling may require PTY interaction because OpenSSH password prompts generally require a TTY. Prefer the smallest local abstraction that can send the temporary password to either `ssh-copy-id` or `ssh` while redacting transcript output.

## UI Details

Add a focused `SshInitializationPanel` or similarly scoped component inside `AddRemoteRepositoryDialog`.

States:

- idle,
- preparing-key,
- needs-host-key-confirmation,
- waiting-for-password,
- installing-public-key,
- testing-connection,
- success,
- failed.

Button enablement:

- The initialization button is enabled only in manual mode.
- `host` and `user` must be non-empty.
- `port` must be valid or empty, defaulting to 22.
- The dialog's other network actions should be disabled while initialization is active.

Password UI:

- Use a password input.
- Text must state that Goblin uses the password only for this installation attempt and never saves it.
- Clear the field after success, failure, cancellation, or dialog close.

Success behavior:

- Show a short success status.
- Automatically call the same test flow used by the existing `Test connection` button.
- Do not auto-fill the private key field.

## Error Handling

Host key unknown:

- Show the fingerprint and require confirmation.
- Cancel means no write to `known_hosts`.

Host key changed:

- Stop the flow.
- Tell the user to inspect and repair `known_hosts` manually.

Local key failure:

- Return a concise error such as SSH directory not writable, `ssh-keygen` missing, or key file not readable.

Password authentication failure:

- Show an authentication failure.
- Allow retry.
- Do not include password or raw interaction transcript.

Public key already installed:

- Treat as success.
- Continue to diagnostics.

Cancellation:

- Use the existing abort mechanism where possible.
- Clear renderer password state.
- Do not attempt to roll back a public key that may already have been installed.

## Security Requirements

- Password must never be stored in settings, session state, repo state, log files, command arguments, or returned error details.
- Private key contents must never be read into renderer state.
- Main may read the public key for installation.
- RPC validation must reject null bytes, invalid ports, empty host/user values, and oversized input strings.
- Error formatting must redact password-like values and avoid full command lines.
- Host key changes are blocked, not downgraded to a normal confirmation.

## Tests

Shared/RPC:

- Manual initialization schemas accept valid `host/user/port/password`.
- Invalid ports, empty host/user, null bytes, and empty password are rejected.
- Password-like fields are not accepted on `RemoteRepoTarget`.

Main SSH initialization:

- Existing `id_ed25519` and `.pub` are reused.
- Missing `.pub` is regenerated from the private key.
- Missing key pair generates `ed25519` with empty passphrase.
- Unknown host key returns confirmation details.
- Changed host key blocks initialization.
- Confirmed host key appends to `known_hosts`.
- Public key installation deduplicates `authorized_keys`.
- Error output is redacted.

Renderer:

- Initialization entry appears only in manual mode.
- Button enablement follows host/user/port validity.
- Password is cleared after completion, failure, cancellation, and close.
- Successful initialization calls existing diagnostics.
- Failed initialization leaves the rest of the add-remote form usable.

Regression:

- Existing remote add, diagnostics, path picker, private key field, and remote target normalization tests still pass.
- Final verification should include `bun run typecheck` and `bun run test`.

## Open Decisions Resolved

- Password input is application-managed but temporary and non-persistent.
- Key path is the system default `~/.ssh/id_ed25519`.
- Generated key has no passphrase.
- Initialization supports manual mode only.
- `known_hosts` unknown-host confirmation is handled in-app.
- Host key changes are blocked.
- Public key installation deduplicates remote `authorized_keys`.
- Successful initialization automatically runs existing connection diagnostics.
