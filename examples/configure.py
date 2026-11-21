#!/usr/bin/env python3
"""Configure this host only; never create or change Beads state."""
import json
import os
from pathlib import Path
import subprocess

home = Path.home()
vault = home / "Projects/Obsidian-Vault"
wrapper = vault / "claude_workspace/tools/claude-tools"
config_path = home / ".paseo-tasks/config.json"
if config_path.exists():
    print("Existing Tasks & Handoffs configuration preserved.")
    raise SystemExit(0)
paths = [str(home / "go/bin"), str(home / ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
env = dict(os.environ, PATH=os.pathsep.join(paths + [os.environ.get("PATH", "")]))
try:
    result = subprocess.run([str(wrapper), "where", "--json", "--readonly", "--no-auto-import", "--no-auto-flush"], env=env, capture_output=True, text=True, timeout=15, check=True)
    where = json.loads(result.stdout)
    bead_path = Path(where["path"])
    machines = vault / "claude_workspace/machines"
    relative = bead_path.relative_to(machines)
    machine = relative.parts[0]
    if len(relative.parts) < 2 or relative.parts[1] != "beads":
        raise ValueError("Unexpected local Beads layout")
    if not Path(where["database_path"]).is_file():
        raise ValueError("The existing task database is unavailable")
except Exception:
    raise SystemExit("Local guarded claude-tools read failed. Check this host's vault and existing Beads setup; no configuration was changed.")
config = {"wrapper": str(wrapper), "vaultRoot": str(vault), "ledgerPath": str(machines / machine / "logs/harness-run-ledger.jsonl"), "artifactRoots": [str(machines / machine / "archives"), str(vault / "claude_workspace/shared/projects")], "hostLabel": machine, "pathDirectories": paths}
config_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
fd = os.open(config_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as stream:
    json.dump(config, stream, indent=2)
    stream.write("\n")
print("Created host-local Tasks & Handoffs configuration. No task data was copied or changed.")
