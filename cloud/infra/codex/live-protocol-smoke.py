"""Operator smoke using a host Docker CLI, not a Docker socket mounted into a service."""
import json
import os
import signal
import subprocess
import uuid

run_id = str(uuid.uuid4())
name = "djl-codex-" + run_id
network = os.environ.get("CODEX_TEST_NETWORK", "djl-codex-live-smoke")
token = os.environ["CODEX_BROKER_TOKEN"]
process = subprocess.Popen([
    "docker", "run", "--rm", "-i", "--name", name, "--network", network,
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--pids-limit", "256", "--memory", "1g", "--cpus", "1",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m",
    "--tmpfs", "/state:rw,nosuid,size=512m,uid=1000,gid=1000",
    "--user", "1000:1000", "--workdir", "/", "djl-codex:0.125.0",
], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
next_id = 0
tool_ok = False
final_ok = False


def send(value):
    process.stdin.write(json.dumps(value) + "\n")
    process.stdin.flush()


def frame():
    global tool_ok, final_ok
    line = process.stdout.readline()
    if not line:
        raise RuntimeError("Codex stream ended unexpectedly")
    event = json.loads(line)
    item = event.get("params", {}).get("item", {})
    if event.get("method") == "item/completed":
        if item.get("type") == "commandExecution":
            tool_ok = "DJL_CODEX_TOOL_OK" in item.get("aggregatedOutput", "")
        if item.get("type") == "agentMessage":
            final_ok = "DJL_CODEX_PROTOCOL_OK" in item.get("text", "")
    if event.get("method") == "error":
        raise RuntimeError("Codex reported a runtime error")
    return event


def rpc(method, params):
    global next_id
    next_id += 1
    current = next_id
    send({"id": current, "method": method, "params": params})
    while True:
        event = frame()
        if event.get("id") == current and "method" not in event:
            if "error" in event:
                raise RuntimeError("App Server RPC failed")
            return event["result"]


def timeout(_signal, _frame):
    raise TimeoutError("Live Codex smoke timed out")


signal.signal(signal.SIGALRM, timeout)
signal.alarm(100)
try:
    send({"model": "nemotron-3.5-lightning-free", "token": token, "gatewayUrl": "http://codex-broker:8090/v1"})
    rpc("initialize", {"clientInfo": {"name": "djl_live_smoke", "version": "0.1.0"}, "capabilities": {}})
    send({"method": "initialized"})
    thread = rpc("thread/start", {"model": "nemotron-3.5-lightning-free", "modelProvider": "djl", "cwd": "/workspace", "approvalPolicy": "never", "sandbox": "danger-full-access"})
    rpc("turn/start", {"threadId": thread["thread"]["id"], "input": [{"type": "text", "text": "Run printf DJL_CODEX_TOOL_OK in the workspace, then reply exactly DJL_CODEX_PROTOCOL_OK.", "text_elements": []}]})
    while True:
        event = frame()
        if event.get("method") == "turn/completed":
            ok = event["params"]["turn"]["status"] == "completed"
            print(json.dumps({"codexVersion": "0.125.0", "modelSource": "openrouter", "model": "nvidia/nemotron-3.5-lightning:free", "completed": ok, "commandTool": tool_ok, "finalMarker": final_ok}))
            if not (ok and tool_ok and final_ok):
                raise RuntimeError("Live Codex tool round trip failed")
            break
finally:
    signal.alarm(0)
    subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    process.kill()
