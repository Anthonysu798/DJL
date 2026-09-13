/**
 * DJL Cloud session persistence.
 *
 * The session token is a credential, so it lives in the server's secrets
 * directory as a mode 0600 file and is never part of settings.json (which is
 * streamed to the renderer). The file is small and rewritten atomically.
 */
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CloudSession {
  readonly apiBaseUrl: string;
  readonly token: string;
  readonly userId: string;
  readonly email: string;
  readonly orgId: string;
  readonly createdAt: string;
}

const FILE_NAME = "djl-cloud-session.json";

export function cloudSessionPath(secretsDir: string): string {
  return join(secretsDir, FILE_NAME);
}

export async function readCloudSession(secretsDir: string): Promise<CloudSession | null> {
  try {
    const raw = await readFile(cloudSessionPath(secretsDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<CloudSession>;
    if (
      typeof parsed.token !== "string" ||
      typeof parsed.apiBaseUrl !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.orgId !== "string"
    )
      return null;
    return {
      apiBaseUrl: parsed.apiBaseUrl,
      token: parsed.token,
      userId: parsed.userId,
      email: parsed.email,
      orgId: parsed.orgId,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function writeCloudSession(secretsDir: string, session: CloudSession): Promise<void> {
  await mkdir(secretsDir, { recursive: true, mode: 0o700 });
  const target = cloudSessionPath(secretsDir);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(session), { mode: 0o600 });
  await chmod(temp, 0o600);
  const { rename } = await import("node:fs/promises");
  await rename(temp, target);
}

export async function clearCloudSession(secretsDir: string): Promise<void> {
  await rm(cloudSessionPath(secretsDir), { force: true });
}
