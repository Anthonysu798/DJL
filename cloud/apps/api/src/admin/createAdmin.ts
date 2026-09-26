/**
 * Bootstrap the first admin from a trusted shell (later team members are invited from the UI):
 *   DATABASE_URL=... bun apps/api/src/admin/createAdmin.ts --email you@slcor.com --name "Anthony" --role admin
 * Prompts for the password on stdin if --password is not given. Never run
 * this with a password in shell history on a shared machine.
 */
import { createDatabase } from "@djl/db";

import { AdminAuth } from "./AdminAuth.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
const email = args.get("email");
const name = args.get("name") ?? email ?? "";
const role = (args.get("role") ?? "admin") as "admin" | "employee";
if (role !== "admin" && role !== "employee") {
  console.error("--role must be admin or employee");
  process.exit(1);
}
let password = args.get("password");
if (!email) {
  console.error("--email is required");
  process.exit(1);
}
if (!password) {
  process.stdout.write("Password (min 14 chars): ");
  for await (const line of console) {
    password = line.trim();
    break;
  }
}
if (!password || password.length < 14) {
  console.error("password must be at least 14 characters");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
const secret = process.env.BETTER_AUTH_SECRET;
if (!url || !secret) {
  console.error("DATABASE_URL and BETTER_AUTH_SECRET are required");
  process.exit(1);
}
const { db, close } = createDatabase(url, { max: 1 });
try {
  // This script only creates a row; it never signs anyone in, so lockouts are unused.
  const lockouts = { isLocked: async () => false, noteFailure: async () => {} };
  const admin = await new AdminAuth(db, { appSecret: secret, ipSalt: secret, lockouts }).create({
    email,
    name,
    role,
    password,
  });
  console.log(JSON.stringify({ created: admin }));
} finally {
  await close();
}
