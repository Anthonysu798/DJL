import Foundation

@main enum RemotePushModelTests {
  static func main() {
    var completions = 0
    let once = RemotePushOnce<Int> { completions += $0 }
    once.call(1); once.call(100)
    precondition(completions == 1)
    // No plugin handler, multiple synchronous handlers, and delayed handlers
    // all share the same completion gate used by AppDelegate.
    for plugins in [0, 1, 3] {
      var count = 0
      let gate = RemotePushOnce<Void> { count += 1 }
      for _ in 0..<plugins { gate.call(()) }
      gate.call(())
      gate.call(())
      precondition(count == 1)
    }
    let inbox = RemotePushInbox(), now = Date(timeIntervalSince1970: 1000)
    let legacy = RemotePushInbox.envelope(["source": "djl.runCompletion", "threadId": "t", "turnId": "", "result": "completed"])
    guard legacy?["source"] as? String == "codex.runCompletion", legacy?["turnId"] == nil,
      RemotePushInbox.envelope(["source": "djl.runCompletion", "threadId": "t", "result": "running"]) == nil else {
      print("FAIL: legacy relay completion normalization"); exit(1)
    }
    let cloud: [AnyHashable: Any] = ["source": "djl.cloudRun", "conversationId": "c1", "runId": "r1", "status": "succeeded", "url": "djl://cloud/c/c1", "aps": ["alert": "private body"], "token": "secret"]
    let first = inbox.receive(cloud, now: now)!
    precondition(first["aps"] == nil && first["token"] == nil && first["eventId"] != nil)
    precondition(inbox.initial(now: now)!["eventId"] as? String == first["eventId"] as? String)
    inbox.acknowledge("wrong")
    precondition(inbox.initial(now: now) != nil)
    let second = inbox.receive(["source": "codex.structuredUserInput", "threadId": "t", "turnId": "turn", "macId": "untrusted"], now: now)!
    precondition(second["macId"] == nil)
    precondition(inbox.initial(now: now)!["eventId"] as? String == second["eventId"] as? String)
    inbox.acknowledge(first["eventId"] as! String)
    precondition(inbox.initial(now: now) != nil)
    precondition(inbox.initial(now: now.addingTimeInterval(301)) == nil)
    for mutation in [["url": "djl://cloud/c/other"], ["status": "running"], ["source": "unknown"], ["url": "djl://cloud/c/c1?approve=1"], ["conversationId": "../x"]] {
      var invalid = cloud
      for (key, value) in mutation { invalid[key] = value }
      precondition(inbox.receive(invalid, now: now) == nil)
    }
    precondition(inbox.receive(["source": "codex.runCompletion", "threadId": "t", "turnId": "../x"], now: now) == nil)
    let valid = inbox.receive(cloud, now: now)!
    inbox.acknowledge(valid["eventId"] as! String)
    precondition(inbox.initial(now: now) == nil)
    print("PASS: completion gate, identifier sanitization, coherence, latest-only inbox, ACK and expiry")
  }
}
