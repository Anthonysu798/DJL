#!/usr/bin/env python3
"""Exercise only protocol/status/error paths. Never requests permissions or app input."""
import json
import selectors
import subprocess
import sys
from pathlib import Path

executable = Path(sys.argv[1]) if len(sys.argv) == 2 else Path(__file__).parent / ".build/DJL Computer Use.app/Contents/MacOS/DJLComputerUse"
process = subprocess.Popen([str(executable.resolve())], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
selector = selectors.DefaultSelector()
selector.register(process.stdout, selectors.EVENT_READ)

def read():
    if not selector.select(10):
        raise AssertionError("Helper did not respond within ten seconds")
    line = process.stdout.readline()
    assert line, f"Helper exited: {process.poll()}, stderr={process.stderr.read()!r}"
    return json.loads(line)

def request(request, expected=None, owner="native-smoke"):
    identifier = f"request-{request_count[0]}"
    request_count[0] += 1
    process.stdin.write((json.dumps({"id": identifier, "threadId": owner, "request": request}) + "\n").encode())
    process.stdin.flush()
    frame = read()
    assert frame["id"] == identifier, frame
    response = frame["response"]
    assert response["method"] == request["method"], response
    if expected:
        assert response["error"]["code"] == expected, response
    else:
        assert "result" in response and "error" not in response, response
    return response

request_count = [0]
try:
    status = request({"method": "status"})["result"]
    assert status["platform"] == "darwin" and status["capabilities"]["passiveHistory"] is True
    request({"method": "status", "unexpected": True}, "invalid-request")
    request({"method": "stop", "sessionId": "unknown-session"}, "unauthorized-session")
    request({"method": "session.observe", "sessionId": "unknown-session"}, "unauthorized-session", owner="another-thread")
    for method in ["history.list", "history.settings", "history.clear"]:
        request({"method": method}, "unsupported")
    assert request({"method": "stop"})["result"] == {"stoppedSessionIds": []}
    process.stdin.write(b"malformed-json\n")
    process.stdin.flush()
    assert read()["response"]["error"]["code"] == "invalid-request"
    process.stdin.write(b"x" * 262145 + b"\n")
    process.stdin.flush()
    assert read()["response"]["error"]["code"] == "invalid-request"
    request({"method": "status"})
    process.stdin.close()
    assert process.wait(timeout=10) == 0
    print(json.dumps({"passed": True, "requests": request_count[0], "permissions": status["permissions"], "targetInputTested": False}))
finally:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
