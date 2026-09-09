import { describe, expect, it } from "vitest";

import { evaluateReadOnlyCommand } from "./commandPolicy";

const allowed = [
  "uptime",
  "ls -la /var/log",
  "cat /etc/os-release",
  "df -h | grep sda",
  "ps aux | grep nginx | head -20",
  "systemctl status nginx",
  "systemctl list-units --type=service",
  "journalctl -u nginx -n 100 --no-pager",
  "tail -n 200 /var/log/syslog",
  "docker ps",
  "docker logs --tail 50 web",
  "docker compose ps",
  "git status && git log --oneline -5",
  "FOO=bar env | grep FOO",
  "command ls /tmp",
  "sed -n '1,20p' /etc/hosts",
  "ping -c 3 example.com",
  "curl -I https://example.com",
  "nginx -t",
  "apt list --installed",
  "node --version; npm -v",
  "free -m\ndf -h",
  "grep -r ERROR /var/log/app || true",
  "test -f /etc/nginx/nginx.conf",
  "awk '{print $1}' /var/log/auth.log | sort | uniq -c",
];

const refused: ReadonlyArray<[command: string, reasonFragment: string]> = [
  ["rm -rf /tmp/x", "rm"],
  ["sudo ls", "sudo"],
  ["ls > out.txt", ">"],
  ["cat a >> b", ">"],
  ["echo $(whoami)", "$("],
  ["echo `id`", "`"],
  ["systemctl restart nginx", "systemctl"],
  ["docker run -it ubuntu", "docker"],
  ["git push origin main", "git"],
  ["sed -i 's/a/b/' file", "sed"],
  ["apt install vim", "apt"],
  ["ping example.com", "ping"],
  ["curl https://example.com", "curl"],
  ["ls | tee out.txt", "tee"],
  ["kill -9 123", "kill"],
  ["cat /etc/passwd; reboot", "reboot"],
  ["vim /etc/hosts", "vim"],
  ["nginx -s reload", "nginx"],
  ["mv a b", "mv"],
  ["chmod 777 /", "chmod"],
  ["npm install", "npm"],
  ["bash -c 'ls'", "bash"],
  ["", "empty"],
];

describe("evaluateReadOnlyCommand", () => {
  it.each(allowed)("allows %j", (command) => {
    expect(evaluateReadOnlyCommand(command)).toEqual({ allowed: true });
  });

  it.each(refused)("refuses %j", (command, reasonFragment) => {
    const verdict = evaluateReadOnlyCommand(command);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason.toLowerCase()).toContain(reasonFragment);
  });
});
