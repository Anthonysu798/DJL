/**
 * Password hashing with argon2id via Bun's native implementation.
 * Parameters follow the OWASP 2024 minimums (19 MiB, 2 iterations).
 */
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 19_456, timeCost: 2 });
}

export async function verifyPassword(input: {
  readonly hash: string;
  readonly password: string;
}): Promise<boolean> {
  return Bun.password.verify(input.password, input.hash);
}
