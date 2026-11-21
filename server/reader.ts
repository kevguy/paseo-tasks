import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { hostname, homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Config } from "./config";
import { taskId, rowSchema, type TaskRow, type TaskDetail } from "../shared/tasks";
const exec = promisify(execFile);
export const guards = ["--json", "--readonly", "--no-auto-import", "--no-auto-flush"];
export type Runner = (args: string[]) => Promise<unknown>;
export function runner(config: Config): Runner {
  return async args => {
    const { stdout } = await exec(config.wrapper, [...args, ...guards], { timeout: 15000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8", env: { ...process.env, PATH: [...config.pathDirectories, join(homedir(), "go/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH ?? ""].join(":"), GIT_OPTIONAL_LOCKS: "0" } });
    return JSON.parse(stdout);
  };
}
export const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const record = z.object({ id: taskId, title: z.string(), status: z.string(), priority: z.number().int().min(0).max(4).optional().nullable(), owner: z.string().optional().nullable(), assignee: z.string().optional().nullable(), issue_type: z.string().optional(), updated_at: z.string().optional() }).passthrough();
export type RawTask = z.infer<typeof record>;
export function records(value: unknown): RawTask[] { return z.array(record).max(201).parse(value); }
export function text(value: unknown, limit = 65536): string { return typeof value === "string" ? value.slice(0, limit) : ""; }
export function row(raw: RawTask): TaskRow { return rowSchema.parse({ id: raw.id, title: text(raw.title, 4096), status: text(raw.status, 100), priority: raw.priority ?? null, owner: text(raw.assignee || raw.owner, 4096) || null, type: text(raw.issue_type, 4096) || null, updatedAt: text(raw.updated_at, 4096) || null }); }
export function handoff(raw: RawTask): TaskDetail["handoff"] {
  const comments = Array.isArray(raw.comments) ? raw.comments.filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof c.text === "string") : [];
  const timestamp = (value: unknown) => { const parsed = Date.parse(text(value, 4096)); return Number.isFinite(parsed) ? parsed : 0; };
  const commentId = (value: unknown) => typeof value === "string" ? value.slice(0, 4096) : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  comments.sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at) || commentId(b.id).localeCompare(commentId(a.id), undefined, { numeric: true }));
  const selected = comments.find(c => /^#{1,6}\s+Session End\b/im.test(c.text as string)) ?? comments[0];
  if (selected) return { text: text(selected.text), author: text(selected.author, 4096) || null, createdAt: text(selected.created_at, 4096) || null, kind: /^#{1,6}\s+Session End\b/im.test(selected.text as string) ? "session-end" : "latest-comment" };
  return typeof raw.notes === "string" && raw.notes ? { text: text(raw.notes), author: null, createdAt: null, kind: "notes" } : null;
}
export function dependencies(raw: RawTask): TaskDetail["dependencies"] {
  const isRelationship = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const dependencies: Record<string, unknown>[] = Array.isArray(raw.dependencies) ? raw.dependencies.filter(isRelationship) : [];
  const dependents: Record<string, unknown>[] = [];
  if (Array.isArray(raw.dependents)) {
    for (const dependent of raw.dependents) {
      if (isRelationship(dependent)) dependents.push({ ...dependent, dependency_type: `dependent: ${text(dependent.dependency_type ?? dependent.type, 4096) || "related"}` });
    }
  }
  return [...dependencies, ...dependents].slice(0, 100).map(d => ({ id: text(d.id ?? d.depends_on_id, 4096), title: text(d.title, 4096), status: text(d.status, 4096) || "unknown", relationship: text(d.dependency_type ?? d.type, 4096) || "related" }));
}
export function source(config?: Config) { return { host: config?.hostLabel ?? hostname(), observedAt: new Date().toISOString(), path: null as string | null, revision: null as string | null, warnings: [] as string[] }; }
export async function authority(run: Runner): Promise<string> {
  const where = await run(["where"]);
  const parsed = z.object({ database_path: z.string().optional(), path: z.string().optional(), beads_dir: z.string().optional() }).passthrough().parse(where);
  const path = parsed.database_path ?? parsed.path ?? parsed.beads_dir;
  if (!path || !path.startsWith("/")) throw new Error("Beads authority path is unavailable.");
  return path;
}
