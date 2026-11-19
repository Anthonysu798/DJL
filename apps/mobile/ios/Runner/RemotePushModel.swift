import Foundation

/// Shared by plugin forwarding and the local fallback, including async plugins.
final class RemotePushOnce<Value> {
  private let lock = NSLock()
  private var completion: ((Value) -> Void)?
  init(_ completion: @escaping (Value) -> Void) { self.completion = completion }
  func call(_ value: Value) {
    lock.lock()
    let callback = completion
    completion = nil
    lock.unlock()
    callback?(value)
  }
}

/// One latest validated intent. Receipt time is native-owned, never payload-owned.
final class RemotePushInbox {
  private var pending: [String: Any]?
  private var receivedAt: Date?
  static func validID(_ raw: Any?) -> String? {
    guard let value = raw as? String, !value.isEmpty, value.count <= 512,
      value.rangeOfCharacter(from: CharacterSet(charactersIn: "/\\?#").union(.controlCharacters).union(.whitespacesAndNewlines)) == nil
    else { return nil }
    return value
  }
  static func envelope(_ info: [AnyHashable: Any]) -> [String: Any]? {
    guard var source = info["source"] as? String else { return nil }
    let legacy = source == "djl.runCompletion"
    if legacy {
      guard let result = info["result"] as? String, ["completed", "failed"].contains(result) else { return nil }
      source = "codex.runCompletion"
    }
    if source == "djl.cloudRun" {
      guard let conversation = validID(info["conversationId"]), let run = validID(info["runId"]),
        let status = info["status"] as? String, ["succeeded", "failed"].contains(status),
        let url = info["url"] as? String,
        let encoded = conversation.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.!~*'()")),
        url == "djl://cloud/c/\(encoded)"
      else { return nil }
      return ["source": source, "conversationId": conversation, "runId": run, "status": status, "url": url]
    }
    guard ["codex.runCompletion", "codex.structuredUserInput"].contains(source),
      let thread = validID(info["threadId"]) else { return nil }
    var value: [String: Any] = ["source": source, "threadId": thread]
    if let turn = info["turnId"], !(legacy && turn as? String == "") {
      guard let id = validID(turn) else { return nil }
      value["turnId"] = id
    }
    return value
  }
  @discardableResult
  func receive(_ info: [AnyHashable: Any], now: Date = Date()) -> [String: Any]? {
    guard var value = Self.envelope(info) else { return nil }
    value["eventId"] = UUID().uuidString
    value["receivedAt"] = now.timeIntervalSince1970 * 1000
    pending = value
    receivedAt = now
    return value
  }
  func initial(now: Date = Date()) -> [String: Any]? {
    guard let receivedAt, now.timeIntervalSince(receivedAt) >= 0,
      now.timeIntervalSince(receivedAt) <= 300 else { pending = nil; self.receivedAt = nil; return nil }
    return pending
  }
  func acknowledge(_ id: String) {
    if pending?["eventId"] as? String == id { pending = nil; receivedAt = nil }
  }
}
