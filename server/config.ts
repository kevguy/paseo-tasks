import { readBounded } from "./files";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
const absolute = z.string().max(4096).refine(isAbsolute, "Expected an absolute path");
export const configSchema = z.object({ wrapper: absolute.refine(p => p.endsWith("/claude-tools")), vaultRoot: absolute, ledgerPath: absolute, artifactRoots: z.array(absolute).max(10), hostLabel: z.string().min(1).max(200), pathDirectories: z.array(absolute).max(10).default([]) }).strict();
export type Config = z.infer<typeof configSchema>;
export async function loadConfig(): Promise<Config> {
  const path = process.env.PASEO_TASKS_CONFIG ?? join(homedir(), ".paseo-tasks", "config.json");
  if (!isAbsolute(path)) throw new Error("Configuration path must be absolute.");
  const raw = (await readBounded(path, 32768)).toString("utf8");
  return configSchema.parse(JSON.parse(raw));
}
