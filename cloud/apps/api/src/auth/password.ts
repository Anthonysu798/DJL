/**
 * Password hashing with argon2id. @node-rs/argon2 is a prebuilt native binding
 * that behaves identically under Bun (production) and Node (vitest), so tests
 * exercise the same code path as production.
 * Parameters follow the OWASP 2024 minimums (19 MiB, 2 iterations).
 */
import { Algorithm, hash, verify } from "@node-rs/argon2";

const OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(input: {
  readonly hash: string;
  readonly password: string;
}): Promise<boolean> {
  try {
    return await verify(input.hash, input.password, OPTIONS);
  } catch {
    return false;
  }
}
