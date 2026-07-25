const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createElectronBackendRpcClient } = require("../src/electron-backend-rpc");

class FakeWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  send(raw) {
    this.sent.push(JSON.parse(raw));
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", 1006, Buffer.from("reconnect"));
  }

  receive(message) {
    this.emit("message", Buffer.from(JSON.stringify(message)));
  }
}

test("Electron backend RPC restores subscriptions and in-flight requests after reconnect", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const client = createElectronBackendRpcClient({
    endpoint: "http://127.0.0.1:5173/?token=secret",
    WebSocketImpl: FakeWebSocket,
    setTimeoutImpl(callback, delay) {
      const timer = { callback, delay, unref() {} };
      scheduled.push(timer);
      return timer;
    },
    clearTimeoutImpl() {},
  });

  const first = FakeWebSocket.instances[0];
  first.open();
  client.subscribe(
    "orchestration.subscribeThread",
    { threadId: "thread-1" },
    {
      onChunk() {},
    },
  );
  const requestPromise = client.request("orchestration.dispatchCommand", {
    type: "thread.archive",
    commandId: "stable-command-1",
    threadId: "thread-1",
  });
  const firstSubscription = first.sent.find(
    (message) => message.tag === "orchestration.subscribeThread",
  );
  const firstRequest = first.sent.find(
    (message) => message.tag === "orchestration.dispatchCommand",
  );
  assert.ok(firstSubscription);
  assert.ok(firstRequest);

  first.close();
  const reconnectTimer = scheduled.find((timer) => timer.delay === 750);
  assert.ok(reconnectTimer);
  reconnectTimer.callback();

  const second = FakeWebSocket.instances[1];
  second.open();
  const restoredSubscription = second.sent.find(
    (message) => message.tag === "orchestration.subscribeThread",
  );
  const retriedRequest = second.sent.find(
    (message) => message.tag === "orchestration.dispatchCommand",
  );
  assert.ok(restoredSubscription);
  assert.ok(retriedRequest);
  assert.equal(retriedRequest.payload.commandId, "stable-command-1");

  second.receive({
    _tag: "Exit",
    requestId: retriedRequest.id,
    exit: { _tag: "Success", value: { sequence: 8 } },
  });
  assert.deepEqual(await requestPromise, { sequence: 8 });
  client.shutdown();
});
