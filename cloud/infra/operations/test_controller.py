import tempfile
import hashlib
import hmac
import json
import subprocess
import time
import threading
import unittest
from pathlib import Path

from controller import Controller, Store, validate_operation, redact_log, counter_rate, read_host


class ControllerTests(unittest.TestCase):
    def test_operations_are_not_shell_commands(self):
        valid = dict(requestId="bee52ab9-2060-40c9-8c4d-df4884e7acdc", action="restart", target="admin", confirmation="RESTART ADMIN", reason="Service recovery")
        self.assertEqual(validate_operation(valid)["target"], "admin")
        for field, value in [("action", "exec"), ("target", "admin;reboot"), ("requestId", "../secret"), ("confirmation", "yes")]:
            with self.assertRaises(ValueError):
                validate_operation({**valid, field: value})
        with self.assertRaises(ValueError):
            validate_operation({**valid, "command": "cat /etc/shadow"})

    def test_logs_do_not_disclose_credentials_or_emails(self):
        self.assertNotIn("sk-private", redact_log('authorization: Bearer sk-private'))
        self.assertNotIn("test@example.com", redact_log('{"level":"error","msg":"Failed","email":"test@example.com","body":"private prompt"}'))
        self.assertNotIn("private prompt", redact_log('{"body":"private prompt"}'))
        self.assertIn("Ready", redact_log("Ready in 20ms"))

    def test_rate_handles_reset_and_zero_interval(self):
        self.assertEqual(counter_rate(200, 100, 10), 10)
        self.assertEqual(counter_rate(10, 100, 10), 0)
        self.assertEqual(counter_rate(200, 100, 0), 0)

    def test_idempotent_job_and_bounded_history(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / "state.sqlite")
            request = dict(requestId="bee52ab9-2060-40c9-8c4d-df4884e7acdc", action="restart", target="admin", confirmation="RESTART ADMIN", reason="Service recovery")
            first = store.enqueue(request)
            self.assertEqual(first, store.enqueue(request))
            with self.assertRaises(ValueError):
                store.enqueue({**request, "target": "api", "confirmation": "RESTART API"})
            self.assertEqual(len(store.jobs()), 1)
            for i in range(300):
                store.sample(dict(at=1000+i, cpu=50, memoryUsed=1, memoryTotal=2, swapUsed=0, swapTotal=0, diskUsed=1, diskTotal=2, receiveRate=3, transmitRate=4, diskReadRate=5, diskWriteRate=6, uptime=i, load=[1, 1, 1]), [], now=1300)
            self.assertLessEqual(len(store.history("hour", now=1300)), 121)

    def test_host_memory_uses_available_not_free(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "meminfo").write_text("MemTotal: 1000 kB\nMemAvailable: 600 kB\nMemFree: 100 kB\nSwapTotal: 200 kB\nSwapFree: 150 kB\n")
            (root / "stat").write_text("cpu  20 0 10 70 0 0 0 0\n")
            (root / "uptime").write_text("100.5 0\n")
            (root / "net").mkdir()
            (root / "net/dev").write_text("lo: 100 0 0 0 0 0 0 0 100 0 0 0 0 0 0 0\neth0: 200 0 0 0 0 0 0 0 300 0 0 0 0 0 0 0\n")
            (root / "net/route").write_text("Iface Destination Gateway\neth0 00000000 00000001\n")
            (root / "diskstats").write_text("")
            sample, counters = read_host(root)
            self.assertEqual(sample["memoryUsed"], 400*1024)
            self.assertEqual(sample["swapUsed"], 50*1024)
            self.assertEqual(counters["rx"], 200)

    def test_signed_requests_refuse_tampering_replay_and_stale_time(self):
        controller = Controller.__new__(Controller)
        controller.token = "test-only-key-with-more-than-43-characters-long"
        controller.nonces = {}
        controller.nonce_lock = threading.Lock()
        nonce = "bee52ab9-2060-40c9-8c4d-df4884e7acdc"
        timestamp = str(int(time.time()))
        message = "\n".join((timestamp, nonce, "GET", "/health", hashlib.sha256(b"").hexdigest())).encode()
        signature = hmac.new(controller.token.encode(), message, hashlib.sha256).hexdigest()
        headers = {"X-DJL-Timestamp":timestamp,"X-DJL-Nonce":nonce,"X-DJL-Signature":signature}
        self.assertFalse(controller.authenticate("GET","/logs",headers,b""))
        self.assertTrue(controller.authenticate("GET","/health",headers,b""))
        self.assertFalse(controller.authenticate("GET","/health",headers,b""))
        self.assertFalse(controller.authenticate("GET","/health",{**headers,"X-DJL-Timestamp":"1000000000"},b""))

    def test_backup_failure_resumes_originally_running_services(self):
        with tempfile.TemporaryDirectory() as directory:
            controller = Controller.__new__(Controller)
            controller.stack = Path(directory)
            controller.compose = ["docker", "compose"]
            controller.inspect = lambda target: {"State":{"Running":True}}
            commands = []
            def command(argv, **kwargs):
                commands.append(argv)
                if "pg_dump" in argv:
                    raise subprocess.CalledProcessError(1,argv)
                return ""
            controller.command = command
            with self.assertRaises(subprocess.CalledProcessError):
                controller.backup({"requestId":"bee52ab9-2060-40c9-8c4d-df4884e7acdc"})
            self.assertIn(["docker","compose","start","api","worker","s3"],commands)

    def test_failed_release_reinstates_previous_image(self):
        controller = Controller.__new__(Controller)
        controller.compose = ["docker","compose"]
        controller.releases = lambda:[{"id":"verified-test","service":"admin","image":"sha256:new","current":False}]
        controller.inspect = lambda target:{"Image":"sha256:previous"}
        controller.wait_ready = lambda target:False
        commands = []
        controller.command = lambda argv,**kwargs:commands.append(argv)
        with self.assertRaises(ValueError):
            controller.deploy({"action":"deploy","target":"admin","releaseId":"verified-test"})
        self.assertIn(["docker","tag","sha256:previous","djl-cloud-admin"],commands)
        self.assertIn(["docker","compose","up","-d","--no-deps","--no-build","admin"],commands)


if __name__ == "__main__":
    unittest.main()
