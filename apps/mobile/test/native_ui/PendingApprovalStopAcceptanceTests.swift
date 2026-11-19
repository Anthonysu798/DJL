import XCTest

final class PendingApprovalStopAcceptanceTests: XCTestCase {
  private func state() -> [String: Any] {
    var request = URLRequest(url: URL(string: "http://127.0.0.1:8896/qa/state")!)
    request.timeoutInterval = 8
    let finished = DispatchSemaphore(value: 0)
    var result: [String: Any] = [:]
    let task = URLSession.shared.dataTask(with: request) { data, response, error in
      XCTAssertNil(error)
      XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
      if let data { result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:] }
      finished.signal()
    }
    task.resume()
    guard finished.wait(timeout: .now() + 10) == .success else {
      task.cancel(); XCTFail("Local QA state read timed out"); return [:]
    }
    return result
  }

  private func attach(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }

  private func tap(_ element: XCUIElement) -> Bool {
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"), object: element)
    guard XCTWaiter.wait(for: [ready], timeout: 12) == .completed else {
      XCTFail("Expected visible native control: \(element)")
      attach("stop60-control-missing"); return false
    }
    element.tap()
    return true
  }

  func testStopPendingApprovalWithoutAnswerOrReplay() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    func text(_ value: String) -> XCUIElement {
      app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR value == %@", value, value)).firstMatch
    }
    func openOriginalChat() -> Bool {
      tap(app.buttons["Open navigation"].firstMatch) && tap(text("Remote")) &&
        tap(app.buttons["Projects"].firstMatch) && tap(text("Fork of Mobile workspace QA"))
    }
    app.activate()
    guard openOriginalChat() else { return }
    let field = app.textFields.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    guard field.exists else { return }
    let marker = "CANCEL60", value = field.value as? String ?? ""
    guard value.isEmpty || value == "Follow up" || value == marker else {
      XCTFail("Only the original empty composer or exact owned draft is accepted"); return
    }
    let before = state()
    guard before["turnStartCount"] as? Int == 14, before["turnCount"] as? Int == 15,
      before["pendingCount"] as? Int == 0, let sequence = before["requestSequence"] as? Int else {
      XCTFail("Expected one-shot baseline; do not repeat a submitted QA message"); return
    }
    if value != marker {
      guard tap(field) else { return }
      field.typeText(marker)
    }
    XCTAssertEqual(field.value as? String, marker)
    guard tap(app.buttons["Send to desktop"].firstMatch) else { return }
    let approve = app.buttons["Approve once"].firstMatch
    let command = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "Update the disposable QA workspace file", "Update the disposable QA workspace file")).firstMatch
    XCTAssertTrue(approve.waitForExistence(timeout: 10))
    XCTAssertTrue(command.exists)
    var current = state()
    XCTAssertEqual(current["turnStartCount"] as? Int, 15)
    XCTAssertEqual(current["turnCount"] as? Int, 16)
    XCTAssertEqual(current["pendingCount"] as? Int, 1)
    attach("stop60-pending-unanswered")
    guard openOriginalChat() else { return }
    XCTAssertTrue(approve.waitForExistence(timeout: 10))
    XCTAssertTrue(command.exists)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    current = state()
    XCTAssertEqual(current["turnStartCount"] as? Int, 15)
    XCTAssertEqual(current["turnCount"] as? Int, 16)
    XCTAssertEqual(current["pendingCount"] as? Int, 1)
    attach("stop60-navigation-preserves-request")
    guard tap(app.buttons["Stop turn"].firstMatch) else { return }
    let stopped = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      !approve.exists && !app.buttons["Stop turn"].firstMatch.exists
    }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [stopped], timeout: 10), .completed)
    current = state()
    XCTAssertEqual(current["pendingCount"] as? Int, 0)
    attach("stop60-interrupted-request-cleared")
    guard openOriginalChat() else { return }
    XCTAssertTrue(text(marker).waitForExistence(timeout: 10))
    let empty = app.textFields.firstMatch.value as? String ?? ""
    XCTAssertTrue(empty.isEmpty || empty == "Follow up")
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    XCTAssertFalse(approve.exists)
    XCTAssertFalse(app.buttons["Stop turn"].firstMatch.exists)
    current = state()
    XCTAssertEqual(current["turnStartCount"] as? Int, 15)
    XCTAssertEqual(current["turnCount"] as? Int, 16)
    XCTAssertEqual(current["threadCount"] as? Int, 4)
    XCTAssertEqual(current["forkCount"] as? Int, 3)
    XCTAssertEqual(current["pendingCount"] as? Int, 0)
    let requests = (current["requests"] as? [[String: Any]] ?? []).filter { ($0["sequence"] as? Int ?? 0) > sequence }
    XCTAssertEqual(requests.filter { $0["method"] as? String == "turn/start" }.count, 1)
    let interrupts = requests.filter { $0["method"] as? String == "turn/interrupt" }
    XCTAssertEqual(interrupts.count, 1)
    XCTAssertEqual(interrupts.first?["threadId"] as? String, "native-thread-2")
    attach("stop60-original-history-restored")
  }
}
