// FILE: commandPolicy.ts
// Purpose: Decides whether a shell command is safe to run unattended on a read-only server.
//          Pure: every pipeline segment's verb must be on the allowlist and no write-shaped
//          syntax may appear anywhere.
// Layer: Servers domain helpers

export type ReadOnlyVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/** Verbs that are always read-only regardless of their arguments. */
const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  "cat",
  "ls",
  "ll",
  "df",
  "du",
  "free",
  "uptime",
  "hostname",
  "uname",
  "whoami",
  "id",
  "ps",
  "top",
  "htop",
  "journalctl",
  "tail",
  "head",
  "grep",
  "egrep",
  "rg",
  "find",
  "stat",
  "file",
  "wc",
  "sort",
  "uniq",
  "awk",
  "cut",
  "tr",
  "echo",
  "printf",
  "env",
  "printenv",
  "date",
  "ss",
  "netstat",
  "ip",
  "ifconfig",
  "lsof",
  "which",
  "type",
  "test",
  "true",
  "nproc",
  "lscpu",
  "lsblk",
  "lsb_release",
  "mount",
  "dmesg",
  "last",
  "w",
  "who",
  "dig",
  "nslookup",
]);

/** Tokens that make a command write-shaped wherever they appear. */
const FORBIDDEN_TOKENS: ReadonlySet<string> = new Set([
  "sudo",
  "su",
  "rm",
  "mv",
  "chmod",
  "chown",
  "dd",
  "kill",
  "killall",
  "pkill",
  "reboot",
  "shutdown",
  "halt",
  "poweroff",
  "tee",
]);

const FORBIDDEN_SYNTAX: ReadonlyArray<readonly [pattern: string, label: string]> = [
  [">", '">" (output redirection)'],
  ["$(", '"$(" (command substitution)'],
  ["`", '"`" (command substitution)'],
];

/** Wrappers that run the next token as the real command. */
const TRANSPARENT_PREFIXES: ReadonlySet<string> = new Set(["command", "exec", "env"]);

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

type SubcommandRule = (args: ReadonlyArray<string>) => boolean;

const firstPositional = (args: ReadonlyArray<string>) => args.find((arg) => !arg.startsWith("-"));
const positionalIn =
  (...allowed: string[]): SubcommandRule =>
  (args) => {
    const sub = firstPositional(args);
    return sub !== undefined && allowed.includes(sub);
  };
const firstArgIn =
  (...allowed: string[]): SubcommandRule =>
  (args) =>
    args[0] !== undefined && allowed.includes(args[0]);

/** Verbs allowed only with a read-only subcommand or flag shape. */
const RESTRICTED_COMMANDS: Readonly<Record<string, SubcommandRule>> = {
  systemctl: positionalIn(
    "status",
    "list-units",
    "list-timers",
    "is-active",
    "is-enabled",
    "show",
    "cat",
  ),
  docker: (args) => {
    const sub = firstPositional(args);
    if (sub === "compose") {
      const rest = args.slice(args.indexOf("compose") + 1);
      return positionalIn("ls", "ps")(rest);
    }
    return (
      sub !== undefined &&
      ["ps", "images", "logs", "inspect", "stats", "version", "info"].includes(sub)
    );
  },
  git: positionalIn("status", "log", "diff", "show", "branch", "remote", "rev-parse"),
  sed: (args) => !args.some((arg) => arg === "--in-place" || /^-[a-zA-Z]*i/.test(arg)),
  ping: (args) => args.some((arg) => arg === "-c" || /^-[a-zA-Z]*c\d*$/.test(arg)),
  nginx: (args) => args.length > 0 && args.every((arg) => ["-t", "-T", "-v"].includes(arg)),
  apt: firstArgIn("list"),
  "apt-get": firstArgIn("list"),
  dpkg: firstArgIn("-l", "-s"),
  pip: firstArgIn("list", "show"),
  pip3: firstArgIn("list", "show"),
  node: firstArgIn("-v", "--version"),
  npm: firstArgIn("ls", "-v", "--version"),
  python3: firstArgIn("--version", "-V"),
  python: firstArgIn("--version", "-V"),
  curl: (args) => args.some((arg) => arg === "-I" || arg === "--head" || /^-[a-zA-Z]*I/.test(arg)),
};

const SEGMENT_SEPARATOR = /\|\||&&|\||;|\r?\n/;

function refuse(reason: string): ReadOnlyVerdict {
  return { allowed: false, reason: `Read-only server refused the command: ${reason}.` };
}

function baseName(token: string): string {
  const slash = token.lastIndexOf("/");
  return slash === -1 ? token : token.slice(slash + 1);
}

/** Splits on whitespace, keeping single- and double-quoted spans together. */
function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const char of segment) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current.length > 0) tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function evaluateSegment(segment: string): ReadOnlyVerdict {
  let tokens = tokenize(segment);
  if (tokens.length === 0) return refuse("empty pipeline segment");

  const forbidden = tokens.map(baseName).find((token) => FORBIDDEN_TOKENS.has(token));
  if (forbidden) return refuse(`"${forbidden}" is not allowed`);

  while (
    tokens.length > 1 &&
    (ENV_ASSIGNMENT.test(tokens[0]!) || TRANSPARENT_PREFIXES.has(tokens[0]!))
  ) {
    tokens = tokens.slice(1);
  }
  const verb = baseName(tokens[0]!);
  const args = tokens.slice(1);
  if (READ_ONLY_COMMANDS.has(verb)) return { allowed: true };
  const rule = RESTRICTED_COMMANDS[verb];
  if (rule === undefined) return refuse(`"${verb}" is not on the read-only command list`);
  return rule(args)
    ? { allowed: true }
    : refuse(`"${segment.trim()}" is not a read-only use of ${verb}`);
}

export function evaluateReadOnlyCommand(command: string): ReadOnlyVerdict {
  if (command.trim().length === 0) return refuse("empty command");
  for (const [pattern, label] of FORBIDDEN_SYNTAX) {
    if (command.includes(pattern)) return refuse(`${label} is not allowed`);
  }
  for (const segment of command.split(SEGMENT_SEPARATOR)) {
    const verdict = evaluateSegment(segment);
    if (!verdict.allowed) return verdict;
  }
  return { allowed: true };
}
