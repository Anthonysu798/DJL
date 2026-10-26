"""Private DJL host controller. No shell, arbitrary paths, images, or container targets."""
import hashlib
import hmac
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

TARGETS = ("api", "worker", "admin", "web", "postgres", "redis", "s3", "operations-gateway", "codex-broker")
APP_TARGETS = ("api", "worker", "admin", "web")
ACTIONS = ("restart", "backup", "deploy", "rollback", "reboot", "acknowledge")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
FIELDS = ("at", "cpu", "memoryUsed", "memoryTotal", "swapUsed", "swapTotal", "diskUsed", "diskTotal", "receiveRate", "transmitRate", "diskReadRate", "diskWriteRate", "uptime")


def validate_operation(raw):
    if not isinstance(raw, dict) or set(raw) - {"requestId", "action", "target", "releaseId", "confirmation", "reason"}:
        raise ValueError("Unsupported operation fields.")
    if not UUID.fullmatch(str(raw.get("requestId", ""))):
        raise ValueError("Invalid request ID.")
    action, target = raw.get("action"), raw.get("target")
    if action not in ACTIONS or not isinstance(target, str):
        raise ValueError("Unsupported operation.")
    if action in ("backup", "reboot"):
        if target != "vps":
            raise ValueError("Invalid VPS target.")
        confirmation = "BACK UP DJL" if action == "backup" else "REBOOT VPS"
    elif action == "acknowledge":
        if not UUID.fullmatch(target):
            raise ValueError("Invalid alert ID.")
        confirmation = "ACKNOWLEDGE ALERT"
    else:
        if target not in TARGETS:
            raise ValueError("Invalid service.")
        confirmation = ("ROLL BACK" if action == "rollback" else action.upper()) + " " + target.upper()
    if action in ("deploy", "rollback"):
        if target not in APP_TARGETS or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", str(raw.get("releaseId", ""))):
            raise ValueError("Choose a verified application release.")
    if raw.get("confirmation") != confirmation:
        raise ValueError("Confirmation does not match.")
    reason = raw.get("reason")
    if not isinstance(reason, str) or not 3 <= len(reason.strip()) <= 500:
        raise ValueError("A reason is required.")
    return {**raw, "reason": reason.strip()}


def redact_log(line):
    line = re.sub(r"\x1b\[[0-9;]*m", "", line)[:2000]
    try:
        data = json.loads(line)
        if isinstance(data, dict):
            data = {k: v for k, v in data.items() if k in ("level", "msg", "code", "status", "traceId", "time", "timestamp", "durationMs", "latencyMs", "service") and isinstance(v, (str, int, float, bool))}
            line = json.dumps(data, separators=(",", ":"))
    except (ValueError, TypeError):
        pass
    if re.search(r"(?i)(authorization|password|secret|api[_-]?key|cookie|credential|prompt|response.?body|\btoken\b|private.?key|\b(?:DETAIL|STATEMENT|QUERY|VALUES|INSERT|UPDATE|SELECT)\b)", line):
        return "[Sensitive log entry omitted]"
    line = re.sub(r"(?i)\bBearer\s+\S+", "Bearer [redacted]", line)
    line = re.sub(r"\b(?:sk-|rk-|whsec_|AIza)[A-Za-z0-9_-]+", "[redacted]", line)
    line = re.sub(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.-]+", "[redacted]", line)
    line = re.sub(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", "[email]", line)
    return line


def counter_rate(current, previous, elapsed):
    return max(0, current - previous) / elapsed if elapsed > 0 else 0


def read_host(proc=Path("/proc"), previous=None):
    now = time.time()
    mem = {}
    for line in (proc / "meminfo").read_text().splitlines():
        key, value = line.split(":", 1)
        mem[key] = int(value.strip().split()[0]) * 1024
    cpu = [int(v) for v in (proc / "stat").read_text().splitlines()[0].split()[1:9]]
    total, idle = sum(cpu), cpu[3] + cpu[4]
    interfaces = {line.split()[0] for line in (proc / "net/route").read_text().splitlines()[1:] if len(line.split()) > 1 and line.split()[1] == "00000000"}
    rx, tx = 0, 0
    for line in (proc / "net/dev").read_text().splitlines():
        if ":" not in line:
            continue
        name, values = line.split(":", 1)
        if name.strip() in interfaces:
            parts = values.split()
            rx += int(parts[0])
            tx += int(parts[8])
    major, minor = os.major(os.stat("/").st_dev), os.minor(os.stat("/").st_dev)
    reads, writes = 0, 0
    for line in (proc / "diskstats").read_text().splitlines():
        parts = line.split()
        if len(parts) > 9 and int(parts[0]) == major and int(parts[1]) == minor:
            reads, writes = int(parts[5])*512, int(parts[9])*512
    counters = dict(at=now, cpu=total, idle=idle, rx=rx, tx=tx, reads=reads, writes=writes)
    elapsed = now - previous["at"] if previous else 0
    rate = lambda name: counter_rate(counters[name], previous[name], elapsed) if previous else 0
    cpu_pct = None
    if previous and total > previous["cpu"]:
        cpu_pct = max(0, min(100, 100*(1-(idle-previous["idle"])/(total-previous["cpu"]))))
    disk = os.statvfs("/")
    sample = dict(at=now, cpu=cpu_pct, memoryUsed=max(0, mem["MemTotal"]-mem.get("MemAvailable", mem.get("MemFree", 0))), memoryTotal=mem["MemTotal"], swapUsed=max(0, mem.get("SwapTotal", 0)-mem.get("SwapFree", 0)), swapTotal=mem.get("SwapTotal", 0), diskUsed=(disk.f_blocks-disk.f_bfree)*disk.f_frsize, diskTotal=disk.f_blocks*disk.f_frsize, receiveRate=rate("rx"), transmitRate=rate("tx"), diskReadRate=rate("reads"), diskWriteRate=rate("writes"), uptime=float((proc / "uptime").read_text().split()[0]), load=list(os.getloadavg()))
    return sample, counters


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.db.executescript("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;" +
            "CREATE TABLE IF NOT EXISTS samples (" + ",".join(f"{name} REAL" for name in FIELDS) + ");" +
            "CREATE INDEX IF NOT EXISTS sample_time ON samples(at);" +
            "CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, payload TEXT, status TEXT, created REAL, finished REAL, message TEXT);" +
            "CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY, fingerprint TEXT, severity TEXT, title TEXT, opened REAL, closed REAL, acknowledged REAL);" +
            "CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY, created REAL, bytes INTEGER);")
        self.db.execute("UPDATE jobs SET status='failed',finished=?,message='Controller restarted. Outcome may be unknown; inspect the service before retrying.' WHERE status='running'", (time.time(),))
        self.db.commit()
        self.latest = None
        self.services = []

    def sample(self, sample, services, now=None):
        now = now or time.time()
        with self.lock, self.db:
            self.latest, self.services = sample, services
            self.db.execute("INSERT INTO samples VALUES (" + ",".join("?" for _ in FIELDS) + ")", [sample[k] for k in FIELDS])
            self.db.execute("DELETE FROM samples WHERE at < ?", (now-7*86400,))
            active = []
            for key, used, total, title in (("memory", sample["memoryUsed"], sample["memoryTotal"], "Memory usage"), ("disk", sample["diskUsed"], sample["diskTotal"], "Disk usage")):
                if total and used / total >= .85:
                    active.append((key, "critical" if used/total >= .95 else "warning", f"{title} is {used/total:.0%}"))
            if (sample["cpu"] or 0) >= 90:
                active.append(("cpu", "warning", "CPU usage is above 90%"))
            for service in services:
                if service["state"] != "running" or service["health"] in ("unhealthy", "starting"):
                    active.append(("service-"+service["service"], "critical", service["service"]+" needs attention"))
            fingerprints = {item[0] for item in active}
            for row in self.db.execute("SELECT id,fingerprint FROM alerts WHERE closed IS NULL").fetchall():
                if row["fingerprint"] not in fingerprints:
                    self.db.execute("UPDATE alerts SET closed=? WHERE id=?", (now, row["id"]))
            for key, severity, title in active:
                row = self.db.execute("SELECT id FROM alerts WHERE fingerprint=? AND closed IS NULL", (key,)).fetchone()
                if row:
                    self.db.execute("UPDATE alerts SET title=?,severity=? WHERE id=?", (title, severity, row["id"]))
                else:
                    self.db.execute("INSERT INTO alerts VALUES(?,?,?,?,?,NULL,NULL)", (str(uuid.uuid4()), key, severity, title, now))
            self.db.execute("DELETE FROM alerts WHERE closed IS NOT NULL AND closed < ?", (now-30*86400,))

    def history(self, interval, now=None):
        if interval not in ("hour", "day", "week"):
            raise ValueError("Invalid history interval.")
        seconds = {"hour": 3600, "day": 86400, "week": 7*86400}[interval]
        bucket = math.ceil(seconds/120)
        with self.lock:
            rows = self.db.execute("SELECT " + ",".join(f"AVG({name}) AS {name}" for name in FIELDS) + " FROM samples WHERE at >= ? GROUP BY CAST(at/? AS INTEGER) ORDER BY at LIMIT 121", ((now or time.time())-seconds, bucket)).fetchall()
        return [{**dict(row), "load": []} for row in rows]

    def enqueue(self, operation):
        payload = json.dumps(operation, sort_keys=True, separators=(",", ":"))
        with self.lock, self.db:
            row = self.db.execute("SELECT payload FROM jobs WHERE id=?", (operation["requestId"],)).fetchone()
            if row:
                if row["payload"] != payload:
                    raise ValueError("Request ID already used for another operation.")
                return operation["requestId"]
            pending = self.db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')").fetchone()[0]
            if pending >= 4:
                raise ValueError("Another operation is running. Try again after it finishes.")
            self.db.execute("INSERT INTO jobs VALUES(?,?,'queued',?,NULL,'Waiting for execution')", (operation["requestId"], payload, time.time()))
        return operation["requestId"]

    def jobs(self):
        with self.lock:
            rows = self.db.execute("SELECT * FROM jobs ORDER BY created DESC LIMIT 30").fetchall()
        return [dict(id=r["id"], action=json.loads(r["payload"])["action"], target=json.loads(r["payload"])["target"], status=r["status"], createdAt=r["created"], finishedAt=r["finished"], message=r["message"]) for r in rows]

    def job(self, request_id):
        if not UUID.fullmatch(request_id):
            raise ValueError("Invalid operation ID.")
        with self.lock:
            row = self.db.execute("SELECT * FROM jobs WHERE id=?", (request_id,)).fetchone()
        if not row:
            return None
        operation = json.loads(row["payload"])
        return dict(id=row["id"], action=operation["action"], target=operation["target"], status=row["status"], createdAt=row["created"], finishedAt=row["finished"], message=row["message"])

    def finish(self, request_id, status, message):
        with self.lock, self.db:
            self.db.execute("UPDATE jobs SET status=?,finished=?,message=? WHERE id=?", (status, time.time(), message, request_id))


class Controller:
    def __init__(self, config):
        address = ipaddress.ip_address(config["bindHost"])
        if not address.is_private or address.is_unspecified:
            raise ValueError("Controller must bind to a private host interface.")
        self.config = config
        self.state = Path(config["stateDir"])
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.store = Store(self.state / "state.sqlite")
        self.token = Path(config["secretFile"]).read_text().strip()
        self.nonces = {}
        self.nonce_lock = threading.Lock()
        if len(self.token) < 43:
            raise ValueError("Controller credential must have at least 256 bits.")
        self.stack = Path(config["stackPath"])
        self.compose = ["docker", "compose", "--env-file", str(self.stack / "cloud/infra/vps/.env")]
        for file in config["composeFiles"]:
            self.compose += ["-f", str(self.stack / file)]

    def command(self, argv, timeout=20, output=None, merge_error=False):
        result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=output or subprocess.PIPE, stderr=subprocess.STDOUT if merge_error else subprocess.PIPE, cwd=self.stack, timeout=timeout, check=True)
        return result.stdout.decode(errors="replace") if result.stdout else ""

    def authenticate(self, method, path, headers, body):
        timestamp = headers.get("X-DJL-Timestamp", "")
        nonce = headers.get("X-DJL-Nonce", "")
        signature = headers.get("X-DJL-Signature", "")
        if not re.fullmatch(r"\d{10}", timestamp) or abs(time.time()-int(timestamp)) > 30 or not UUID.fullmatch(nonce) or not re.fullmatch(r"[a-f0-9]{64}", signature):
            return False
        message = "\n".join((timestamp,nonce,method,path,hashlib.sha256(body).hexdigest())).encode()
        expected = hmac.new(self.token.encode(),message,hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature,expected):
            return False
        with self.nonce_lock:
            self.nonces = {key:at for key,at in self.nonces.items() if time.time()-at < 60}
            if nonce in self.nonces or len(self.nonces) >= 10000:
                return False
            self.nonces[nonce] = time.time()
        return True

    def inspect(self, service):
        return json.loads(self.command(self.docker(service)+["inspect", self.container(service)]))[0]

    def docker(self, service):
        if service != "codex-broker":
            return ["docker"]
        return ["runuser", "-u", "djl-codex", "--", "env", "DOCKER_HOST=unix:///run/djl-codex-control/docker.sock", "DOCKER_CONFIG=/tmp/djl-operations-docker", "docker"]

    def container(self, service):
        return "djl-codex-pilot-codex-broker-1" if service == "codex-broker" else "djl-cloud-"+service+"-1"

    def service_ready(self, service):
        from urllib.request import urlopen
        info = self.inspect(service)
        if not info["State"]["Running"] or info["State"].get("Health", {}).get("Status", "healthy") != "healthy":
            return False
        endpoints = {"api":"http://127.0.0.1:8787/ready", "admin":"http://127.0.0.1:3001/login", "web":"http://127.0.0.1:3002/sign-in", "operations-gateway":"http://127.0.0.1:8788/ready"}
        if service in endpoints:
            try:
                return urlopen(endpoints[service], timeout=3).status == 200
            except OSError:
                return False
        return True

    def wait_ready(self, service):
        for _ in range(60):
            if self.service_ready(service):
                return True
            time.sleep(2)
        return False

    def collect(self):
        previous = None
        while True:
            try:
                sample, previous = read_host(previous=previous)
                services = []
                for target in TARGETS:
                    try:
                        info = self.inspect(target)
                        stats = json.loads(self.command(self.docker(target)+["stats", "--no-stream", "--format", "{{json .}}", self.container(target)], timeout=5))
                        memory = stats.get("MemUsage", "0B / 0B").split("/")
                        services.append(dict(service=target, state=info["State"]["Status"], health=info["State"].get("Health", {}).get("Status", "not-configured"), cpu=float(stats.get("CPUPerc", "0%").rstrip("%")), memoryUsed=byte_size(memory[0]), memoryLimit=byte_size(memory[-1]), restarts=info.get("RestartCount", 0), image=info["Image"][:19]))
                    except (subprocess.SubprocessError, ValueError, KeyError):
                        services.append(dict(service=target, state="unavailable", health="unknown", cpu=0, memoryUsed=0, memoryLimit=0, restarts=0, image="unavailable"))
                self.store.sample(sample, services)
            except (OSError, ValueError):
                pass
            time.sleep(10)

    def releases(self):
        data = json.loads(Path(self.config["releaseFile"]).read_text())
        valid = []
        for item in data:
            if item.get("service") not in APP_TARGETS or item.get("status") != "passed" or not isinstance(item.get("checks"), int) or item["checks"] <= 0 or not re.fullmatch(r"sha256:[a-f0-9]{64}", item.get("imageId", "")):
                continue
            try:
                info = json.loads(self.command(["docker", "image", "inspect", item["imageId"]]))[0]
                current = self.inspect(item["service"])["Image"] == info["Id"]
            except (subprocess.SubprocessError, ValueError, KeyError):
                continue
            valid.append(dict(id=item["id"], service=item["service"], label=item["label"], image=item["imageId"], current=current, checks=item["checks"]))
        return valid

    def overview(self, interval):
        with self.store.lock:
            alerts = [dict(id=r["id"], severity=r["severity"], title=r["title"], openedAt=r["opened"], acknowledgedAt=r["acknowledged"]) for r in self.store.db.execute("SELECT * FROM alerts WHERE closed IS NULL ORDER BY opened DESC LIMIT 30").fetchall()]
            backups = [dict(id=r["id"], createdAt=r["created"], bytes=r["bytes"], database=True, files=True) for r in self.store.db.execute("SELECT * FROM backups ORDER BY created DESC LIMIT 20").fetchall()]
            latest, services = self.store.latest, self.store.services
        return dict(host=self.config.get("label", "DJL staging VPS"), sampledAt=latest["at"] if latest else 0, latest=latest, services=services, history=self.store.history(interval), alerts=alerts, jobs=self.store.jobs(), backups=backups, releases=self.releases())

    def logs(self, service):
        if service not in TARGETS:
            raise ValueError("Choose a DJL service.")
        lines = self.command(self.docker(service)+["logs", "--tail", "100", "--since", "1h", self.container(service)], merge_error=True)
        return dict(service=service, lines=[redact_log(line) for line in lines.splitlines()[-100:]], at=time.time())

    def backup(self, operation):
        disk = os.statvfs(self.stack)
        if disk.f_bavail*disk.f_frsize < 1024**3:
            raise ValueError("At least 1 GiB of free disk is required before starting a backup.")
        directory = self.stack / "cloud/infra/vps/backups" / ("ops-"+operation["requestId"])
        directory.mkdir(mode=0o700, parents=True, exist_ok=False)
        running = [s for s in ("api", "worker", "s3") if self.inspect(s)["State"]["Running"]]
        try:
            if running:
                self.command(self.compose + ["stop", *running], timeout=90)
            for name, argv in (
                ("postgres.dump", ["docker", "exec", "djl-cloud-postgres-1", "pg_dump", "-U", "djl_admin", "-Fc", "djl"]),
                ("files.tar.gz", ["docker", "run", "--rm", "--read-only", "--cpus", "0.5", "--memory", "256m", "--pids-limit", "64", "--network", "none", "--security-opt", "no-new-privileges", "--cap-drop", "ALL", "--volumes-from", "djl-cloud-s3-1:ro", "--entrypoint", "tar", "chrislusf/seaweedfs:4.47", "-czf", "-", "-C", "/data", "."]),
            ):
                with (directory / name).open("xb") as output:
                    os.chmod(directory / name, 0o600)
                    self.command(argv, timeout=180, output=output)
            size = sum(p.stat().st_size for p in directory.iterdir())
            with self.store.lock, self.store.db:
                self.store.db.execute("INSERT INTO backups VALUES(?,?,?)", (operation["requestId"], time.time(), size))
        finally:
            if running:
                self.command(self.compose + ["start", *running], timeout=90)
        return "Database and file backup saved privately on this VPS."

    def deploy(self, operation):
        release = next((r for r in self.releases() if r["id"] == operation["releaseId"] and r["service"] == operation["target"]), None)
        if not release:
            raise ValueError("Verified release unavailable.")
        if operation["action"] == "rollback" and release["current"]:
            raise ValueError("Choose a previous verified release.")
        target = operation["target"]
        prior = self.inspect(target)["Image"]
        image_tag = {"api": "djl-cloud-api:local", "worker": "djl-cloud-worker", "admin": "djl-cloud-admin", "web": "djl-cloud-web"}[target]
        self.command(["docker", "tag", release["image"], image_tag])
        try:
            self.command(self.compose + ["up", "-d", "--no-deps", "--no-build", target], timeout=90)
            if self.wait_ready(target):
                return "Verified release applied."
            raise ValueError("Service did not become healthy.")
        except (subprocess.SubprocessError, ValueError):
            self.command(["docker", "tag", prior, image_tag])
            self.command(self.compose + ["up", "-d", "--no-deps", "--no-build", target], timeout=90)
            raise ValueError("Deployment failed; previous image restored.")

    def execute(self, operation):
        action = operation["action"]
        if action == "restart":
            target = operation["target"]
            if target == "codex-broker":
                self.command(self.docker(target)+["restart", self.container(target)], timeout=90)
            else:
                self.command(self.compose + ["restart", target], timeout=90)
            if not self.wait_ready(target):
                raise ValueError("Service is not ready after restart.")
            return "Selected DJL service restarted and passed its readiness check."
        if action == "backup":
            return self.backup(operation)
        if action in ("deploy", "rollback"):
            return self.deploy(operation)
        if action == "reboot":
            self.command(["systemd-run", "--on-active=10s", "--unit=djl-ops-reboot-"+operation["requestId"], "/usr/bin/systemctl", "reboot"])
            return "VPS reboot scheduled in 10 seconds."
        with self.store.lock, self.store.db:
            changed = self.store.db.execute("UPDATE alerts SET acknowledged=? WHERE id=? AND closed IS NULL", (time.time(), operation["target"])).rowcount
        if not changed:
            raise ValueError("Alert is no longer active.")
        return "Alert acknowledged."

    def worker(self):
        while True:
            with self.store.lock, self.store.db:
                row = self.store.db.execute("SELECT id,payload,created FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
                if row:
                    self.store.db.execute("UPDATE jobs SET status='running',message='Operation in progress' WHERE id=?", (row["id"],))
            if row:
                try:
                    if time.time()-row["created"] > 300:
                        raise ValueError("Queued authorization expired.")
                    operation = validate_operation(json.loads(row["payload"]))
                    message = self.execute(operation)
                    self.store.finish(row["id"], "scheduled" if operation["action"] == "reboot" else "succeeded", message)
                except Exception:
                    self.store.finish(row["id"], "failed", "Operation failed. Inspect service health before retrying.")
            else:
                time.sleep(1)


def byte_size(text):
    match = re.fullmatch(r"\s*([0-9.]+)\s*([KMGT]?i?B)\s*", text)
    if not match:
        return 0
    units = {"B": 1, "kB": 1000, "KB": 1000, "MB": 1000**2, "GB": 1000**3, "TB": 1000**4, "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "TiB": 1024**4}
    return float(match[1])*units.get(match[2], 1)


def serve(config):
    controller = Controller(config)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def respond(self, status, value):
            body = json.dumps(value, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 0 or length > 4096 or (self.command == "GET" and length):
                    return False
                self.request_body = self.rfile.read(length)
                return controller.authenticate(self.command,self.path,self.headers,self.request_body)
            except (ValueError, OSError):
                return False

        def do_GET(self):
            if not self.authorized():
                return self.respond(401, {"error": "Unauthorized"})
            try:
                url = urlparse(self.path)
                query = parse_qs(url.query)
                if url.path == "/overview":
                    return self.respond(200, controller.overview(query.get("range", ["hour"])[0]))
                if url.path == "/logs":
                    return self.respond(200, controller.logs(query.get("service", ["api"])[0]))
                if url.path == "/health":
                    return self.respond(200, {"ready": controller.store.latest is not None})
                if url.path.startswith("/operations/"):
                    job = controller.store.job(url.path.removeprefix("/operations/"))
                    return self.respond(200 if job else 404, job or {"error": "Operation not found"})
                self.respond(404, {"error": "Not found"})
            except ValueError:
                self.respond(400, {"error": "Invalid request"})
            except Exception:
                self.respond(503, {"error": "Controller temporarily unavailable"})

        def do_POST(self):
            if not self.authorized():
                return self.respond(401, {"error": "Unauthorized"})
            if self.path != "/operations":
                return self.respond(404, {"error": "Not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096:
                    raise ValueError("Invalid body size")
                operation = validate_operation(json.loads(self.request_body))
                self.respond(202, {"id": controller.store.enqueue(operation)})
            except (ValueError, TypeError):
                self.respond(400, {"error": "Operation refused"})
            except Exception:
                self.respond(503, {"error": "Controller temporarily unavailable"})

    threading.Thread(target=controller.collect, daemon=True).start()
    threading.Thread(target=controller.worker, daemon=True).start()
    class Server(ThreadingHTTPServer):
        daemon_threads = True
        request_queue_size = 16

        def get_request(self):
            connection, address = super().get_request()
            connection.settimeout(5)
            return connection, address
    server = Server((config["bindHost"], config.get("port", 9085)), Handler)
    server.timeout = 10
    server.serve_forever()


if __name__ == "__main__":
    os.umask(0o077)
    serve(json.loads(Path("/etc/djl-operations/config.json").read_text()))
