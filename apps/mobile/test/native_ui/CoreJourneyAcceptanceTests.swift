import XCTest

final class CoreJourneyAcceptanceTests: XCTestCase {
  private let origin = "http://127.0.0.1:8896"

  private func fixture(_ path: String, body: [String: Any]? = nil) -> [String: Any] {
    var request = URLRequest(url: URL(string: origin + path)!)
    request.timeoutInterval = 8
    if let body {
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    }
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
      task.cancel()
      XCTFail("Local QA producer control timed out")
      return [:]
    }
    return result
  }

  private func attach(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }

  private func ready(_ element: XCUIElement) -> Bool {
    let visible = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"), object: element)
    let passed = XCTWaiter.wait(for: [visible], timeout: 12) == .completed
    XCTAssertTrue(passed, "Expected visible native control: \(element)")
    return passed
  }

  private func tap(_ element: XCUIElement) -> Bool {
    guard ready(element) else { attach("core59-control-missing"); return false }
    element.tap()
    return true
  }

  private func tapVisibleReasoning(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
    guard element.waitForExistence(timeout: 10), element.frame.width > 0,
      element.frame.height > 0, app.frame.contains(element.frame) else {
      XCTFail("Expected the observed visible reasoning heading bounds"); return false
    }
    // Flutter's visible custom button can report non-hittable after reconnection.
    // The observed bounded native touch remains functional; verify its result.
    element.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).tap()
    return true
  }

  func testOrdinaryStreamingResumeReconnectAndHistoryWithoutDuplicateSend() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    func label(_ text: String) -> XCUIElement {
      app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR value == %@", text, text)).firstMatch
    }
    func detail(_ text: String) -> XCUIElement {
      app.descendants(matching: .any).matching(NSPredicate(format: "value CONTAINS %@", text)).firstMatch
    }
    func openOriginalChat() -> Bool {
      tap(app.buttons["Open navigation"].firstMatch) && tap(label("Remote")) &&
        tap(app.buttons["Projects"].firstMatch) && tap(label("Fork of Mobile workspace QA"))
    }
    app.activate()
    guard openOriginalChat() else { return }
    let field = app.textFields.firstMatch
    guard ready(field) else { return }
    let initial = field.value as? String ?? ""
    let marker = "[reasoning] FINAL59C"
    XCTAssertTrue(initial.isEmpty || initial == "Follow up" || initial == marker)
    guard initial.isEmpty || initial == "Follow up" || initial == marker else { return }
    let before = fixture("/qa/state")
    guard let starts = before["turnStartCount"] as? Int, let turns = before["turnCount"] as? Int else {
      XCTFail("Expected the existing local fixture counters"); return
    }
    // This dedicated fixture's saved baseline prevents another Send after an
    // interrupted test has already submitted the one owned public message.
    guard starts == 13 && turns == 14 else {
      XCTFail("This QA journey already submitted or its fixture changed; do not resend"); return
    }
    XCTAssertEqual(before["threadCount"] as? Int, 4)
    XCTAssertEqual(before["forkCount"] as? Int, 3)
    XCTAssertEqual(before["pendingCount"] as? Int, 0)
    if initial != marker {
      guard tap(field) else { return }
      field.typeText(marker)
    }
    XCTAssertEqual(field.value as? String, marker)
    guard tap(app.buttons["Send to desktop"].firstMatch), tapVisibleReasoning(app.buttons["Reading files"].firstMatch, in: app) else { return }
    XCTAssertTrue(detail("Live summary detail.").waitForExistence(timeout: 5))
    guard ready(app.buttons["Stop turn"].firstMatch) else { return }
    var state = fixture("/qa/state")
    XCTAssertEqual(state["turnStartCount"] as? Int, starts + 1)
    XCTAssertEqual(state["turnCount"] as? Int, turns + 1)
    guard var phase = state["reasoning"] as? [String: Any], let turn = phase["turnId"] as? String,
      phase["threadId"] as? String == "native-thread-2", phase["stage"] as? String == "STREAM_INITIAL" else {
      XCTFail("Expected this chat's newly started reasoning barrier"); return
    }
    attach("core59-stream-initial")
    XCUIDevice.shared.press(.home)
    XCTAssertTrue(app.wait(for: .runningBackground, timeout: 5) || app.state == .runningBackgroundSuspended)
    let backgrounded = Date()
    let held = fixture("/qa/state")
    XCTAssertEqual(held["turnStartCount"] as? Int, starts + 1)
    XCTAssertEqual((held["reasoning"] as? [String: Any])?["turnId"] as? String, turn)
    XCTAssertLessThan(Date().timeIntervalSince(backgrounded), 10)
    app.activate()
    guard ready(app.buttons["Stop turn"].firstMatch) else { return }
    XCTAssertFalse(label("Unlock DJL").exists)
    attach("core59-resumed-active-stream")
    guard let dropSequence = fixture("/qa/state")["requestSequence"] as? Int else {
      XCTFail("Expected a fresh sequence after Home/resume and before socket drop"); return
    }
    print("CORE59_DROP_SEQUENCE \(dropSequence)")
    XCTAssertEqual(fixture("/qa/drop", body: [:])["ok"] as? Bool, true)
    let reconnected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      let current = self.fixture("/qa/state")
      let requests = current["requests"] as? [[String: Any]] ?? []
      return requests.contains { ($0["sequence"] as? Int ?? 0) > dropSequence && $0["method"] as? String == "initialize" }
    }, object: nil)
    guard XCTWaiter.wait(for: [reconnected], timeout: 20) == .completed else {
      XCTFail("Expected actual reinitialization after the controlled socket drop"); return
    }
    guard ready(app.buttons["Stop turn"].firstMatch) else { return }
    state = fixture("/qa/state")
    let requests = state["requests"] as? [[String: Any]] ?? []
    let reinitializations = requests.filter { ($0["sequence"] as? Int ?? 0) > dropSequence && $0["method"] as? String == "initialize" }
    XCTAssertEqual(reinitializations.count, 1)
    print("CORE59_REINITIALIZED_SEQUENCE \(reinitializations.first?["sequence"] ?? "missing")")
    XCTAssertEqual(state["turnStartCount"] as? Int, starts + 1)
    XCTAssertEqual(state["turnCount"] as? Int, turns + 1)
    guard let restored = state["reasoning"] as? [String: Any], restored["turnId"] as? String == turn,
      restored["stage"] as? String == "STREAM_INITIAL" else { XCTFail("Expected the retained exact stream"); return }
    phase = restored
    attach("core59-reconnected-active-stream")
    func advance(_ phase: [String: Any]) {
      let keys = ["threadId", "turnId", "itemId", "stage", "revision"]
      let expected = Dictionary(uniqueKeysWithValues: keys.compactMap { key in phase[key].map { (key, $0) } })
      XCTAssertEqual(expected.count, keys.count)
      XCTAssertEqual(fixture("/qa/reasoning/advance", body: expected)["ok"] as? Bool, true)
    }
    advance(phase)
    guard tapVisibleReasoning(app.buttons["Verifying response"].firstMatch, in: app) else { return }
    XCTAssertTrue(detail("Second summary detail.").waitForExistence(timeout: 5))
    XCTAssertTrue(detail("Content stream detail.").exists)
    state = fixture("/qa/state")
    guard let updated = state["reasoning"] as? [String: Any], updated["turnId"] as? String == turn,
      updated["stage"] as? String == "STREAM_UPDATED" else { XCTFail("Expected the exact second barrier"); return }
    attach("core59-stream-updated")
    advance(updated)
    let completed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      !app.buttons["Stop turn"].firstMatch.exists
    }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [completed], timeout: 10), .completed)
    attach("core59-stream-completed")
    guard openOriginalChat() else { return }
    XCTAssertTrue(label(marker).waitForExistence(timeout: 10))
    XCTAssertTrue(label("Reasoning native fixture complete.").exists)
    let value = label("Follow up").value as? String ?? ""
    XCTAssertTrue(value.isEmpty || value == "Follow up")
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    state = fixture("/qa/state")
    XCTAssertEqual(state["turnStartCount"] as? Int, starts + 1)
    XCTAssertEqual(state["turnCount"] as? Int, turns + 1)
    XCTAssertEqual(state["threadCount"] as? Int, 4)
    XCTAssertEqual(state["forkCount"] as? Int, 3)
    XCTAssertEqual(state["pendingCount"] as? Int, 0)
    let final = state["reasoning"] as? [String: Any]
    XCTAssertEqual(final?["turnId"] as? String, turn)
    XCTAssertEqual(final?["stage"] as? String, "COMPLETE")
    XCTAssertEqual(final?["detailCompletedCount"] as? Int, 1)
    XCTAssertEqual(final?["turnCompletedCount"] as? Int, 1)
    attach("core59-original-history-restored")
  }
}
