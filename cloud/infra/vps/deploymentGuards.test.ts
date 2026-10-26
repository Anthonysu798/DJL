import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
const source = new URL("./djl.sh", import.meta.url);
describe("host override preservation", () => {
  for (const action of [
    "check",
    "deploy",
    "up",
    "status",
    "verify",
    "backup",
    "codex-up",
    "codex-down",
  ]) {
    it(`uses explicit host override for ${action}`, () => {
      const dir = mkdtempSync(join(tmpdir(), "djl-compose-guard-"));
      try {
        mkdirSync(join(dir, "bin"));
        copyFileSync(source, join(dir, "djl.sh"));
        writeFileSync(join(dir, "compose.host.yml"), "services: {}\n");
        writeFileSync(
          join(dir, "bin/docker"),
          '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DJL_TEST_TRACE"\ncase "$*" in *"ps --all --quiet s3"*) printf "fixture-s3\\n";; esac\n',
          { mode: 0o755 },
        );
        const trace = join(dir, "trace");
        const result = spawnSync("bash", [join(dir, "djl.sh"), action], {
          env: {
            ...process.env,
            PATH: `${join(dir, "bin")}:${process.env.PATH}`,
            DJL_TEST_TRACE: trace,
          },
          encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        const commands = readFileSync(trace, "utf8")
          .split("\n")
          .filter((line) => line.startsWith("compose "));
        expect(commands.length).toBeGreaterThan(0);
        for (const command of commands)
          expect(command).toContain("--env-file .env -f compose.yml -f compose.host.yml");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe("deployment provenance gates", () => {
  for (const scenario of ["dirty", "wrong-version", "red-ci", "invalid-target"]) {
    it(`refuses ${scenario} before contacting the server`, () => {
      const dir = mkdtempSync(join(tmpdir(), "djl-deploy-guard-"));
      try {
        mkdirSync(join(dir, "bin"));
        copyFileSync(new URL("./deploy.sh", import.meta.url), join(dir, "deploy.sh"));
        const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
        expect(git("init", "-q").status).toBe(0);
        expect(git("add", "deploy.sh").status).toBe(0);
        expect(
          git(
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-qm",
            "fixture",
          ).status,
        ).toBe(0);
        const sha = git("rev-parse", "HEAD").stdout.trim();
        writeFileSync(join(dir, ".gitignore"), "bin\n.gitignore\n");
        writeFileSync(join(dir, "bin", "gh"), '#!/bin/sh\nprintf "failure\\n"\n', { mode: 0o755 });
        const trace = join(dir, "server-contact");
        writeFileSync(join(dir, "bin", "ssh"), '#!/bin/sh\ntouch "$DJL_TEST_TRACE"\nexit 99\n', {
          mode: 0o755,
        });
        if (scenario === "dirty") writeFileSync(join(dir, "uncommitted.txt"), "dirty");
        const result = spawnSync("bash", [join(dir, "deploy.sh")], {
          cwd: dir,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${join(dir, "bin")}:${process.env.PATH}`,
            DJL_TEST_TRACE: trace,
            VPS_HOST: "fixture@example.invalid",
            VPS_ROOT: "/srv/djl-cloud-staging",
            VPS_SSH_KEY: "fixture-key",
            VPS_KNOWN_HOSTS: "fixture-known-host",
            DJL_VERSION: scenario === "wrong-version" ? "missing-ref" : sha,
            DJL_DEPLOY_TARGET: scenario === "invalid-target" ? "unsafe" : "all",
          },
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(
          scenario === "invalid-target"
            ? /Invalid deployment target/
            : scenario === "dirty"
              ? /clean, committed/
              : scenario === "red-ci"
                ? /Cloud CI.*failure/
                : /revision/,
        );
        expect(() => readFileSync(trace)).toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

it("packages shared analytics sources and provides CI credentials to both deploy workflows", () => {
  const script = readFileSync(new URL("./deploy.sh", import.meta.url), "utf8");
  const ignore = readFileSync(new URL("../../../.dockerignore", import.meta.url), "utf8");
  expect(script).toContain("packages/shared/src");
  expect(ignore).toContain("!packages/shared/src/**");
  for (const file of ["cloud-deploy-staging.yml", "cloud-deploy-prod.yml"]) {
    const workflow = readFileSync(
      new URL(`../../../.github/workflows/${file}`, import.meta.url),
      "utf8",
    );
    expect(workflow).toMatch(
      /name: Back up, migrate, deploy, and verify VPS\n\s+env:\n\s+GH_TOKEN: \$\{\{ github.token \}\}\n\s+run: bash cloud\/infra\/vps\/deploy.sh/,
    );
  }
});
