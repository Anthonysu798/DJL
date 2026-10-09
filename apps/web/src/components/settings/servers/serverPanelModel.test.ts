// FILE: serverPanelModel.test.ts
// Purpose: Unit tests for the pure Servers panel helpers (form mapping, validation, preview, formatting, status).
// Layer: Web settings model tests
// Depends on: serverPanelModel helpers and @synara/contracts server types

import type { ServerId, ServerRecord, ServerTestOutcome } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  detectPrivateKeyType,
  emptyServerForm,
  formatBytes,
  formFromRecord,
  isStatsStale,
  percent,
  previewSshCommand,
  statusKey,
  statusTone,
  toCreateInput,
  toUpdateInput,
  uptimeParts,
  validateServerForm,
  type ServerFormValues,
} from "./serverPanelModel";

const id = "srv-1" as ServerId;

function record(overrides: Partial<ServerRecord> = {}): ServerRecord {
  return {
    id,
    name: "Prod",
    host: "example.com",
    port: 22,
    username: "deploy",
    auth: { type: "agent" },
    tags: ["prod"],
    permissionTier: "read-only",
    notes: "",
    source: "manual",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function form(overrides: Partial<ServerFormValues> = {}): ServerFormValues {
  return {
    ...emptyServerForm(),
    name: "Prod",
    host: "example.com",
    port: "22",
    username: "deploy",
    ...overrides,
  };
}

function tested(outcome: ServerTestOutcome): ServerRecord {
  return record({ lastTest: { at: 1, outcome } });
}

describe("emptyServerForm", () => {
  it("returns a fresh object each call with agent auth, port 22 and read-only tier", () => {
    const a = emptyServerForm();
    const b = emptyServerForm();
    expect(a).not.toBe(b);
    expect(a.tags).not.toBe(b.tags);
    expect(a).toEqual({
      name: "",
      host: "",
      port: "22",
      username: "",
      authType: "agent",
      keyPath: "",
      passphrase: "",
      keepPassphrase: false,
      privateKey: "",
      keepPrivateKey: false,
      password: "",
      keepPassword: false,
      tags: [],
      permissionTier: "read-only",
      notes: "",
    });
  });
});

describe("formFromRecord", () => {
  it("maps a keyPath record and keeps the saved passphrase", () => {
    const values = formFromRecord(
      record({
        auth: { type: "keyPath", path: "~/.ssh/id_ed25519", hasPassphrase: true },
        port: 2222,
        tags: ["a", "b"],
        permissionTier: "full",
        notes: "hi",
      }),
    );
    expect(values).toMatchObject({
      name: "Prod",
      host: "example.com",
      port: "2222",
      username: "deploy",
      authType: "keyPath",
      keyPath: "~/.ssh/id_ed25519",
      passphrase: "",
      keepPassphrase: true,
      privateKey: "",
      keepPrivateKey: false,
      password: "",
      keepPassword: false,
      tags: ["a", "b"],
      permissionTier: "full",
      notes: "hi",
    });
  });

  it("keeps the saved key for importedKey and the saved password for password auth", () => {
    expect(
      formFromRecord(record({ auth: { type: "importedKey", hasPassphrase: false } })),
    ).toMatchObject({ authType: "importedKey", keepPrivateKey: true, keepPassphrase: false });
    expect(formFromRecord(record({ auth: { type: "password" } }))).toMatchObject({
      authType: "password",
      keepPassword: true,
    });
  });

  it("does not share the tags array with the record", () => {
    const rec = record({ tags: ["x"] });
    expect(formFromRecord(rec).tags).not.toBe(rec.tags);
  });
});

describe("validateServerForm", () => {
  it("passes a complete agent form", () => {
    expect(validateServerForm(form(), "create")).toEqual({});
  });

  it("reports nameRequired", () => {
    expect(validateServerForm(form({ name: "  " }), "create").name).toBe("nameRequired");
  });

  it("reports hostRequired and hostInvalid", () => {
    expect(validateServerForm(form({ host: "" }), "create").host).toBe("hostRequired");
    for (const host of ["-evil", "bad host", "a b", "ho\tst", "[", "exa mple.com"]) {
      expect(validateServerForm(form({ host }), "create").host, host).toBe("hostInvalid");
    }
    for (const host of [
      "example.com",
      "10.0.0.1",
      "[::1]",
      "[2001:db8::1]",
      "box",
      "my-vps.local",
    ]) {
      expect(validateServerForm(form({ host }), "create").host, host).toBeUndefined();
    }
  });

  it("reports portInvalid for non-integers and out-of-range values", () => {
    for (const port of ["", "0", "65536", "abc", "22.5", "-1", " 22"]) {
      expect(validateServerForm(form({ port }), "create").port, port).toBe("portInvalid");
    }
    for (const port of ["1", "22", "65535"]) {
      expect(validateServerForm(form({ port }), "create").port, port).toBeUndefined();
    }
  });

  it("reports usernameRequired for empty, leading-dash and whitespace usernames", () => {
    for (const username of ["", "-root", "a b", "a@b"]) {
      expect(validateServerForm(form({ username }), "create").username, username).toBe(
        "usernameRequired",
      );
    }
  });

  it("reports keyPathRequired for key file auth", () => {
    expect(validateServerForm(form({ authType: "keyPath" }), "create").keyPath).toBe(
      "keyPathRequired",
    );
    expect(
      validateServerForm(form({ authType: "keyPath", keyPath: "~/.ssh/id" }), "create").keyPath,
    ).toBeUndefined();
  });

  it("reports keyRequired and keyInvalid for imported keys", () => {
    expect(validateServerForm(form({ authType: "importedKey" }), "create").privateKey).toBe(
      "keyRequired",
    );
    expect(
      validateServerForm(form({ authType: "importedKey", privateKey: "not a key" }), "create")
        .privateKey,
    ).toBe("keyInvalid");
    expect(
      validateServerForm(
        form({ authType: "importedKey", privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc" }),
        "create",
      ).privateKey,
    ).toBeUndefined();
  });

  it("accepts an empty imported key in edit mode only when the saved key is kept", () => {
    expect(
      validateServerForm(form({ authType: "importedKey", keepPrivateKey: true }), "edit")
        .privateKey,
    ).toBeUndefined();
    expect(
      validateServerForm(form({ authType: "importedKey", keepPrivateKey: false }), "edit")
        .privateKey,
    ).toBe("keyRequired");
    expect(
      validateServerForm(form({ authType: "importedKey", keepPrivateKey: true }), "create")
        .privateKey,
    ).toBe("keyRequired");
  });

  it("reports passwordRequired unless the saved password is kept in edit mode", () => {
    expect(validateServerForm(form({ authType: "password" }), "create").password).toBe(
      "passwordRequired",
    );
    expect(
      validateServerForm(form({ authType: "password", keepPassword: true }), "create").password,
    ).toBe("passwordRequired");
    expect(
      validateServerForm(form({ authType: "password", keepPassword: true }), "edit").password,
    ).toBeUndefined();
    expect(
      validateServerForm(form({ authType: "password", password: "pw" }), "create").password,
    ).toBeUndefined();
  });

  it("reports tagInvalid when any tag fails the tag pattern", () => {
    expect(validateServerForm(form({ tags: ["ok", "bad tag"] }), "create").tags).toBe("tagInvalid");
    expect(validateServerForm(form({ tags: ["ok", "x".repeat(33)] }), "create").tags).toBe(
      "tagInvalid",
    );
    expect(
      validateServerForm(form({ tags: ["ok", "prod-1", "日本"] }), "create").tags,
    ).toBeUndefined();
  });
});

describe("toCreateInput", () => {
  it("builds agent auth without secrets", () => {
    expect(toCreateInput(form({ name: " Prod ", host: " example.com ", tags: ["a"] }))).toEqual({
      name: "Prod",
      host: "example.com",
      port: 22,
      username: "deploy",
      auth: { type: "agent" },
      tags: ["a"],
      permissionTier: "read-only",
      notes: "",
    });
  });

  it("builds keyPath auth with hasPassphrase and the passphrase secret", () => {
    const input = toCreateInput(
      form({ authType: "keyPath", keyPath: "~/.ssh/id", passphrase: "shh", port: "2222" }),
    );
    expect(input.port).toBe(2222);
    expect(input.auth).toEqual({ type: "keyPath", path: "~/.ssh/id", hasPassphrase: true });
    expect(input.secret).toEqual({ passphrase: "shh" });
  });

  it("builds importedKey auth with the private key secret", () => {
    const input = toCreateInput(form({ authType: "importedKey", privateKey: "PEM" }));
    expect(input.auth).toEqual({ type: "importedKey", hasPassphrase: false });
    expect(input.secret).toEqual({ privateKey: "PEM" });
  });

  it("builds password auth with the password secret and ignores other fields", () => {
    const input = toCreateInput(
      form({ authType: "password", password: "pw", privateKey: "PEM", passphrase: "x" }),
    );
    expect(input.auth).toEqual({ type: "password" });
    expect(input.secret).toEqual({ password: "pw" });
  });
});

describe("toUpdateInput", () => {
  it("includes only changed patch fields", () => {
    const previous = record();
    const input = toUpdateInput(id, formFromRecord(previous), previous);
    expect(input).toEqual({ id, patch: {} });

    const changed = toUpdateInput(
      id,
      { ...formFromRecord(previous), name: "Staging", port: "2200", tags: ["prod"] },
      previous,
    );
    expect(changed).toEqual({ id, patch: { name: "Staging", port: 2200 } });
  });

  it("emits clearSecrets when a keep-flag is false and the field is empty", () => {
    const previous = record({ auth: { type: "password" } });
    const input = toUpdateInput(id, { ...formFromRecord(previous), keepPassword: false }, previous);
    expect(input.clearSecrets).toEqual(["password"]);
    expect(input.secret).toBeUndefined();
    expect(input.patch).toEqual({});
  });

  it("keeps a saved secret when the keep-flag is true and the field is empty", () => {
    const previous = record({ auth: { type: "importedKey", hasPassphrase: true } });
    const input = toUpdateInput(id, formFromRecord(previous), previous);
    expect(input).toEqual({ id, patch: {} });
  });

  it("clears the passphrase and flips hasPassphrase when the passphrase is dropped", () => {
    const previous = record({
      auth: { type: "keyPath", path: "~/.ssh/id", hasPassphrase: true },
    });
    const input = toUpdateInput(
      id,
      { ...formFromRecord(previous), keepPassphrase: false },
      previous,
    );
    expect(input.patch.auth).toEqual({ type: "keyPath", path: "~/.ssh/id", hasPassphrase: false });
    expect(input.clearSecrets).toEqual(["passphrase"]);
  });

  it("sends a replacement secret without clearing it", () => {
    const previous = record({ auth: { type: "password" } });
    const input = toUpdateInput(
      id,
      { ...formFromRecord(previous), keepPassword: false, password: "new" },
      previous,
    );
    expect(input.secret).toEqual({ password: "new" });
    expect(input.clearSecrets).toBeUndefined();
  });

  it("clears secrets that the new auth method no longer uses", () => {
    const previous = record({ auth: { type: "importedKey", hasPassphrase: true } });
    const input = toUpdateInput(id, { ...formFromRecord(previous), authType: "agent" }, previous);
    expect(input.patch.auth).toEqual({ type: "agent" });
    expect(input.clearSecrets).toEqual(["privateKey", "passphrase"]);
  });
});

describe("previewSshCommand", () => {
  it("reflects port, key path and username@host", () => {
    expect(
      previewSshCommand(
        form({ authType: "keyPath", keyPath: "~/.ssh/id", port: "2222", host: "host" }),
      ),
    ).toBe("ssh -p 2222 -i ~/.ssh/id deploy@host");
  });

  it("marks password auth as askpass-delivered", () => {
    expect(
      previewSshCommand(form({ authType: "password", password: "hunter2", host: "host" })),
    ).toBe("ssh -p 22 deploy@host  # password via askpass");
  });

  it("never contains the password, passphrase or private key", () => {
    const secrets = { password: "hunter2", passphrase: "open-sesame", privateKey: "PEMSECRET" };
    for (const authType of ["agent", "keyPath", "importedKey", "password"] as const) {
      const preview = previewSshCommand(form({ authType, keyPath: "~/.ssh/id", ...secrets }));
      expect(preview).toContain("deploy@example.com");
      for (const secret of Object.values(secrets)) expect(preview).not.toContain(secret);
    }
  });

  it("falls back to placeholders and the default port when fields are empty", () => {
    expect(previewSshCommand(emptyServerForm())).toBe("ssh -p 22 user@host");
  });
});

describe("detectPrivateKeyType", () => {
  it("recognises the common PEM headers and rejects garbage", () => {
    expect(detectPrivateKeyType("-----BEGIN OPENSSH PRIVATE KEY-----\nabc")).toBe("OpenSSH");
    expect(detectPrivateKeyType("-----BEGIN RSA PRIVATE KEY-----\nabc")).toBe("RSA");
    expect(detectPrivateKeyType("-----BEGIN EC PRIVATE KEY-----\nabc")).toBe("EC");
    expect(detectPrivateKeyType("-----BEGIN PRIVATE KEY-----\nabc")).toBe("PKCS#8");
    expect(detectPrivateKeyType("  \n-----BEGIN PRIVATE KEY-----\nabc")).toBe("PKCS#8");
    expect(detectPrivateKeyType("garbage")).toBeNull();
    expect(detectPrivateKeyType("")).toBeNull();
    expect(detectPrivateKeyType("-----BEGIN PUBLIC KEY-----")).toBeNull();
  });
});

describe("formatBytes", () => {
  it("formats bytes with binary units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(8123456 * 1024)).toBe("7.7 GB");
    expect(formatBytes(1024)).toBe("1 KB");
  });
});

describe("percent", () => {
  it("rounds and clamps to 0-100", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBe(0);
    expect(percent(5, 4)).toBe(100);
    expect(percent(-1, 4)).toBe(0);
  });
});

describe("uptimeParts", () => {
  it("splits seconds into days, hours and minutes", () => {
    expect(uptimeParts(90061)).toEqual({ days: 1, hours: 1, minutes: 1 });
    expect(uptimeParts(59)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});

describe("isStatsStale", () => {
  const now = 1_000_000_000;
  it("is stale without stats or after ten minutes", () => {
    expect(isStatsStale(undefined, now)).toBe(true);
    expect(isStatsStale({ collectedAt: now - 9 * 60_000 }, now)).toBe(false);
    expect(isStatsStale({ collectedAt: now - 11 * 60_000 }, now)).toBe(true);
  });
});

describe("statusKey", () => {
  it("prefers pending state, then last outcome, then neverTested", () => {
    expect(statusKey(record(), null)).toBe("neverTested");
    expect(statusKey(record(), "test")).toBe("testing");
    expect(statusKey(record(), "refresh")).toBe("refreshing");
    expect(statusKey(tested("ok"), "test")).toBe("testing");
    const expected: Record<ServerTestOutcome, string> = {
      ok: "ok",
      "host-key-unknown": "hostKeyUnknown",
      "host-key-changed": "hostKeyChanged",
      "auth-failed": "authFailed",
      unreachable: "unreachable",
      timeout: "timeout",
      "askpass-unsupported": "askpassUnsupported",
      error: "error",
    };
    for (const [outcome, key] of Object.entries(expected) as [ServerTestOutcome, string][]) {
      expect(statusKey(tested(outcome), null), outcome).toBe(key);
    }
  });
});

describe("statusTone", () => {
  it("maps every outcome to a tone", () => {
    expect(statusTone(record())).toBe("neutral");
    expect(statusTone(tested("ok"))).toBe("success");
    expect(statusTone(tested("host-key-unknown"))).toBe("warning");
    for (const outcome of [
      "host-key-changed",
      "auth-failed",
      "unreachable",
      "timeout",
      "askpass-unsupported",
      "error",
    ] as const) {
      expect(statusTone(tested(outcome)), outcome).toBe("danger");
    }
  });
});
