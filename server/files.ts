import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, extname } from "node:path";
import type { Config } from "./config";
import type { TaskDetail } from "../shared/tasks";
import { hash } from "./reader";
const MAX_FILE = 256 * 1024;
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel !== "" && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel); };
const denied = (path: string) => /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.ssh|\.aws|\.config|\.git|\.paseo|node_modules|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|shared\/reference)(?:\/|$)/i.test(path);
export async function safePath(config: Config, candidate: string): Promise<string> {
  if (!isAbsolute(candidate) || denied(candidate) || ![".md", ".txt", ".json", ".log"].includes(extname(candidate).toLowerCase())) throw new Error("This reference is not permitted for preview.");
  const resolved = await realpath(candidate);
  if (denied(resolved)) throw new Error("This reference is not permitted for preview.");
  const roots = await Promise.all(config.artifactRoots.map(root => realpath(root).catch(() => "")));
  if (!roots.some(root => root && inside(root, resolved))) throw new Error("This reference is outside the configured preview folders.");
  return resolved;
}
export async function readBounded(path: string, cap = MAX_FILE): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > cap) throw new Error("This file is too large or is not a regular text file.");
    const bytes = Buffer.alloc(cap + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > cap) throw new Error("This file is too large.");
    const body = bytes.subarray(0, bytesRead);
    if (body.includes(0)) throw new Error("This file is not text.");
    new TextDecoder("utf-8", { fatal: true }).decode(body);
    return body;
  } finally { await handle.close(); }
}
export function references(config: Config, body: string): TaskDetail["references"] {
  const found = new Map<string, TaskDetail["references"][number]>();
  // References are data, never commands. Only local explicit paths are candidates.
  const pattern = /(?:\/[^\s<>"'`()[\]{}]+|claude_workspace\/[^\s<>"'`()[\]{}]+)\.(?:md|txt|json|log)(?::\d+(?:-\d+)?)?/g;
  for (const match of body.matchAll(pattern)) {
    const clean = match[0].replace(/:\d+(?:-\d+)?$/, "");
    if (clean.length > 4096 || denied(clean)) continue;
    const path = isAbsolute(clean) ? resolve(clean) : resolve(config.vaultRoot, clean);
    if (!config.artifactRoots.some(root => inside(resolve(root), path))) continue;
    const id = hash(path).slice(0, 24);
    found.set(id, { id, path, label: relative(config.vaultRoot, path) });
    if (found.size === 30) break;
  }
  return [...found.values()];
}
export async function recordedRun(config: Config, body: string): Promise<TaskDetail["run"]> {
  const ids = [...new Set(body.match(/\bhr-\d{8}T\d{6}Z-[a-f0-9]{8,64}\b/g) ?? [])];
  if (ids.length !== 1) return null; // Ambiguous comments are not an association.
  const id = ids[0];
  const unknown = { id, found: false, project: null, branch: null, syncStatus: null, timestamp: null };
  try {
    const file = await open(config.ledgerPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let tail: string;
    try {
      const stat = await file.stat();
      if (!stat.isFile()) return unknown;
      const start = Math.max(0, stat.size - 2 * 1024 * 1024);
      const buf = Buffer.alloc(stat.size - start);
      const { bytesRead } = await file.read(buf, 0, buf.length, start);
      tail = buf.subarray(0, bytesRead).toString("utf8");
      if (start) tail = tail.slice(tail.indexOf("\n") + 1);
    } finally { await file.close(); }
    for (const line of tail.split("\n").reverse()) {
      let entry; try { entry = JSON.parse(line); } catch { continue; }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      if (entry.harness_run_id !== id || entry.event !== "session-start") continue;
      const str = (x: unknown) => typeof x === "string" ? x.slice(0, 4096) : null;
      return { id, found: true, project: str(entry.project_dir ?? entry.project_root), branch: str(entry.branch), syncStatus: str(entry.sync_status), timestamp: str(entry.timestamp) };
    }
  } catch { /* Missing ledger is explicitly unknown. */ }
  return unknown;
}
