# Tasks & Handoffs for Paseo

A portable panel for existing machine-level Beads tasks managed by `claude-tools`. It shows task status, ownership, priority, dependencies, notes, acceptance criteria, recorded session handoffs and explicitly linked harness history. Copy continuation context when you choose to resume a task. Preview permitted local text evidence without leaving Paseo.

Each host reads its own task database. Installing the same package on a second host does not copy tasks, configuration, evidence or company context. There is no second database, agent launcher or task editor. Existing `claude-tools` commands remain the mutation interface.

## Install from npm

With Paseo 0.16.2 or later, install the exact published release on the host:

```sh
paseo plugin install npm:@kevlai22/paseo-tasks@0.1.5
paseo plugin ls paseo-tasks
```

Keep the host online while Paseo downloads and prepares the package. Installing a plugin does not restart the daemon. Repeat on each host where you want to use it.

## Install on another host

Requirements: Paseo 0.12 or later with plugins enabled, Node 20 or later, Python 3 for the optional configuration helper, and a working local vault/`claude-tools` with Beads 0.48 or 0.49. Other Beads versions require a guarded compatibility check first.

1. Copy only the release `.tgz` to the host and verify its SHA-256 against the release receipt. Extract it into a persistent directory, for example `~/Projects/paseo-tasks/package`.
2. On that host, run `python3 package/examples/configure.py`. This checks that host's existing wrapper and writes `~/.paseo-tasks/config.json` only if absent. It never creates, imports, repairs or migrates a task store. An existing config is preserved.
3. Run `paseo plugin install /absolute/path/to/package`. The sidebar entry is **Tasks & Handoffs**. To update files in the already registered directory, replace only this plugin's package files and run `paseo plugin reload paseo-tasks`. If using a new release directory instead, first run `paseo plugin remove paseo-tasks`, then install the new directory; this briefly removes only this panel. Installing an existing ID directly is rejected. These commands do not require restarting the daemon.
4. Open the panel on that host and verify a task detail. If a CLI flag or source is unavailable, the panel reports unavailable rather than falling back to an exported file.

On macOS, the app CLI is `/Applications/Paseo.app/Contents/Resources/bin/paseo`; Linux desktop installations may use `/opt/Paseo/resources/bin/paseo`. Use the actual installed path. Enabling plugins on a host that has them disabled may require a daemon reload; schedule that separately so it does not interrupt active work.

## Configuration

See `examples/config.json`. All paths must be absolute and local to this host. `PASEO_TASKS_CONFIG` optionally selects another absolute configuration path. The wrapper must be the trusted `claude-tools` executable; no task text becomes shell input. `pathDirectories` adds installed CLI binary directories. Preview roots must be explicit folders containing intended task evidence. Configuration is local operator input and is not packaged with releases.

The helper allows this machine's archive and the local shared project folder. Preview requires a path reference in the selected task's description, notes, acceptance criteria or selected handoff, a permitted extension (`.md`, `.txt`, `.json`, `.log`), containment after resolving symlinks, and a regular UTF-8 file no larger than 256 KiB. Known sensitive directories are excluded. A reference is not an instruction to execute content. Only paired Paseo clients can reach the panel through the host's normal plugin RPC connection.

## Reading the panel

- Status is an observation of saved Beads records, not a probe of a running agent. Lists show at most 200 tasks ordered by priority. Beads 0.48/0.49 can apply the limit before custom sorting, so this is not a claim to show the newest tasks. Search covers title, ID and owner within that bounded view. An exact task ID uses a guarded direct lookup and can retrieve a task outside the list; the selected status filter still applies (choose All to find closed tasks). A truncated list is explicitly labeled.
- The latest session-end comment is selected by timestamp, with latest comment or notes as an identified fallback. Long fields are shortened with a warning. A continuation packet is bounded context: always re-read the authoritative task before acting.
- Harness history is linked only by one explicit run ID in the selected handoff. Repository, branch and sync are historical startup values. A missing/ambiguous link stays unknown; it never borrows another session by recency.
- Disconnected or failed reads demote cached status. Copy and evidence preview are disabled until a fresh connected detail is read. No task records are persisted by the plugin.
- Evidence previews show the exact path, observation time and SHA-256 of the bytes read. A hash establishes content identity, not approval or the correctness of the artifact's claims.

## Development

`npm ci`, `npm run typecheck`, `npm test`, `npm pack`. Follow the vault's heavy-slot and review rules. Tests write only synthetic fixtures under `.validation/`. Package source contains no host config or task data. The code uses Paseo-provided React, React Native, query and plugin APIs.

The upstream `paseo-beads` plugin was evaluated. This implementation is separate, with a small adapter for this vault's wrapper-owned task store and handoff conventions; no upstream implementation was copied. A generic Beads browser remains a reasonable choice for users without those conventions.
