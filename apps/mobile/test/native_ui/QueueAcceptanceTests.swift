import XCTest
import CoreGraphics

final class QueueAcceptanceTests: XCTestCase {
  private func fixture() -> [String: Any] {
    let done = DispatchSemaphore(value: 0)
    var result: [String: Any] = [:]
    URLSession.shared.dataTask(with: URL(string: "http://127.0.0.1:8896/qa/state")!) { data, response, error in
      XCTAssertNil(error)
      XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
      if let data { result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:] }
      done.signal()
    }.resume()
    XCTAssertEqual(done.wait(timeout: .now() + 8), .success)
    return result
  }
  private func waitState(_ predicate: ([String: Any]) -> Bool) -> [String: Any]? {
    let deadline = Date().addingTimeInterval(12)
    repeat {
      let state = fixture()
      if predicate(state) { return state }
      let tick = XCTestExpectation(description: "Owned queue stage")
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { tick.fulfill() }
      _ = XCTWaiter.wait(for: [tick], timeout: 1)
    } while Date() < deadline
    XCTFail("Owned queue fixture did not reach the expected stage")
    return nil
  }
  private func label(_ app: XCUIApplication, _ text: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", text)).firstMatch
  }
  private func tap(_ element: XCUIElement) -> Bool {
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"), object: element)
    guard XCTWaiter.wait(for: [ready], timeout: 10) == .completed else {
      XCTFail("Expected native queue control: \(element)"); return false
    }
    element.tap(); return true
  }
  private func attach(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }
  private func openChat(_ app: XCUIApplication) -> Bool {
    tap(app.buttons["Open navigation"].firstMatch) && tap(label(app, "Remote")) &&
      tap(app.buttons["Projects"].firstMatch) && tap(label(app, "Fork of Mobile workspace QA"))
  }
  private func send(_ app: XCUIApplication, _ text: String) -> Bool {
    let field = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR label == %@ OR value == %@", "Follow up", "Guide the current turn", text)).firstMatch
    guard tap(field) else { return false }
    let initial = field.value as? String ?? ""
    guard initial.isEmpty || initial == "Follow up" || initial == "Guide the current turn" || initial == text else {
      XCTFail("Preserve the existing unsent draft"); return false
    }
    if initial != text { field.typeText(text) }
    guard field.value as? String == text else { XCTFail("Typed QA input differs; do not send"); return false }
    return tap(app.buttons["Send to desktop"].firstMatch)
  }

  private func question79Tap(_ app: XCUIApplication, _ title: String) -> Bool {
    func visible() -> XCUIElement? {
      app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).allElementsBoundByIndex.first(where: {
        let frame = $0.frame
        return $0.isEnabled && frame.width >= 10 && frame.height >= 10 && app.frame.contains(CGPoint(x: frame.midX, y: frame.midY))
      })
    }
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in visible() != nil }, object: app)
    guard XCTWaiter.wait(for: [ready], timeout: 8) == .completed, let control = visible() else {
      print("QUESTION79_AX_CONTROL \(title) appFrame=\(app.frame)")
      print(app.debugDescription)
      XCTFail("Expected visible question control: \(title)"); return false
    }
    let frame = control.frame
    app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
    return true
  }

  private func question79Page(_ app: XCUIApplication, _ page: String) -> Bool {
    let label = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", page)).firstMatch
    let exists = label.waitForExistence(timeout: 8)
    XCTAssertTrue(exists, "Expected the current question page: \(page)")
    return exists
  }

  func testQuestion81DismissalKeyboardFocus() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.questioncomposer80")
    app.activate()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    if app.buttons["Open question fixture"].waitForExistence(timeout: 5) {
      guard question79Tap(app, "Open question fixture") else { return }
    }
    guard question79Tap(app, "Reset fixture"), question79Tap(app, "Ask question"),
      question79Tap(app, "ESC"), question79Tap(app, "Release cancellation") else { return }
    XCTAssertTrue(app.buttons["Composer options"].waitForExistence(timeout: 8))
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8))
    let draft = app.descendants(matching: .any).matching(NSPredicate(format: "value == %@", "Retained local QA draft")).firstMatch
    XCTAssertTrue(draft.waitForExistence(timeout: 8))
    attachSettledPlanSession("question81-accepted-focused-keyboard")
    guard question79Tap(app, "Reset fixture") else { return }
    let hidden = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
    XCTAssertEqual(XCTWaiter.wait(for: [hidden], timeout: 8), .completed)
    attachSettledPlanSession("question81-reset-unfocused")
  }

  func testQuestion80ComposerCancellation() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.questioncomposer80")
    app.activate()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    if app.buttons["Open question fixture"].waitForExistence(timeout: 5) {
      guard question79Tap(app, "Open question fixture") else { return }
    }
    guard question79Tap(app, "Reset fixture") else { return }
    XCTAssertTrue(app.buttons["Composer options"].waitForExistence(timeout: 8))
    guard question79Tap(app, "Ask question"), question79Page(app, "Choose scope") else { return }
    XCTAssertFalse(app.buttons["Composer options"].exists)
    attachSettledPlanSession("question80-pending-light")
    guard question79Tap(app, "Only local QA"), question79Tap(app, "ESC") else { return }
    XCTAssertTrue(app.buttons["Closing..."].waitForExistence(timeout: 8))
    XCTAssertFalse(app.buttons["Closing..."].isEnabled)
    XCTAssertFalse(app.buttons["Composer options"].exists)
    attachSettledPlanSession("question80-closing")
    guard question79Tap(app, "Reject cancellation") else { return }
    XCTAssertTrue(app.buttons["ESC"].waitForExistence(timeout: 8))
    XCTAssertTrue(app.buttons["Send"].isEnabled)
    XCTAssertFalse(app.buttons["Composer options"].exists)
    attachSettledPlanSession("question80-rejected-retained")
    guard question79Tap(app, "Theme") else { return }
    attachSettledPlanSession("question80-rejected-dark")
    guard question79Tap(app, "Theme"), question79Tap(app, "Reset fixture"),
      question79Tap(app, "Ask question"), question79Tap(app, "ESC"),
      question79Tap(app, "Release cancellation") else { return }
    XCTAssertTrue(app.buttons["Composer options"].waitForExistence(timeout: 8))
    XCTAssertFalse(app.buttons["ESC"].exists)
    attachSettledPlanSession("question80-accepted-draft-restored")
  }

  func testQuestion79SwiftReferencePagingAndThemes() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.swiftquestions79")
    app.activate()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    guard question79Tap(app, "Reset"), question79Page(app, "1 of 2") else { return }
    attachSettledPlanSession("question79-swift-page1-light")
    guard question79Tap(app, "Ship it now") else { return }
    attachSettledPlanSession("question79-swift-page1-selected")
    guard question79Tap(app, "Next"), question79Page(app, "2 of 2"),
      question79Tap(app, "iOS Simulator"), question79Tap(app, "Pixel 9") else { return }
    attachSettledPlanSession("question79-swift-page2-selected")
    guard question79Tap(app, "Back"), question79Page(app, "1 of 2"),
      question79Tap(app, "Next"), question79Page(app, "2 of 2"), question79Tap(app, "Send") else { return }
    XCTAssertFalse(app.buttons["Send"].firstMatch.isEnabled)
    guard question79Tap(app, "Reset"), question79Tap(app, "Theme"), question79Page(app, "1 of 2") else { return }
    attachSettledPlanSession("question79-swift-page1-dark")
  }

  func testQuestion79FlutterFixturePagingAndThemes() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.questions79")
    app.activate()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    if app.buttons["Open plan fixture"].waitForExistence(timeout: 5) {
      guard question79Tap(app, "Open plan fixture") else { return }
    }
    guard question79Tap(app, "Legacy questions"), question79Page(app, "1 of 2") else { return }
    attachSettledPlanSession("question79-flutter-page1-light")
    guard question79Tap(app, "Ship it now") else { return }
    attachSettledPlanSession("question79-flutter-page1-selected")
    guard question79Tap(app, "Next"), question79Page(app, "2 of 2"),
      question79Tap(app, "iOS Simulator"), question79Tap(app, "Pixel 9") else { return }
    attachSettledPlanSession("question79-flutter-page2-selected")
    guard question79Tap(app, "Back"), question79Page(app, "1 of 2"),
      question79Tap(app, "Next"), question79Page(app, "2 of 2"), question79Tap(app, "Send") else { return }
    XCTAssertTrue(app.buttons["Response sent"].firstMatch.waitForExistence(timeout: 8))
    attachSettledPlanSession("question79-flutter-answer-sent")
    guard question79Tap(app, "Legacy questions"), question79Page(app, "1 of 2") else { return }
    let y = label(app, "Render fixture").frame.midY
    let theme = app.buttons["Toggle preview theme"]
    if !theme.exists || !app.frame.contains(CGPoint(x: theme.frame.midX, y: theme.frame.midY)) {
      app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: app.frame.width * 0.85, dy: y))
        .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: app.frame.width * 0.2, dy: y)))
    }
    guard question79Tap(app, "Toggle preview theme") else { return }
    attachSettledPlanSession("question79-flutter-page1-dark")
  }

  func testLegacy78IsolatedQuestionnaireRenderingAndExplicitAnswer() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.plans78")
    app.activate()
    defer {
      app.terminate()
      XCUIApplication(bundleIdentifier: "app.djl.mobile").activate()
    }
    if app.buttons["Open plan fixture"].waitForExistence(timeout: 5) {
      guard tap(app.buttons["Open plan fixture"]) else { return }
    }
    guard label(app, "Render fixture").waitForExistence(timeout: 8) else {
      XCTFail("Expected isolated render fixture, never a paired app"); return
    }
    let toolbarY = label(app, "Render fixture").frame.midY
    func visibleFixture(_ target: XCUIElement) -> Bool {
      guard target.exists else { return false }
      let frame = target.frame
      return frame.width > 0 && frame.height >= 32 && app.frame.contains(CGPoint(x: frame.midX, y: frame.midY))
    }
    func tapFixture(_ target: XCUIElement) -> Bool {
      guard visibleFixture(target) else { XCTFail("Expected a visible fixture control"); return false }
      let frame = target.frame
      app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
      return true
    }
    func revealToolbar(_ target: XCUIElement) -> Bool {
      for _ in 0..<4 {
        if visibleFixture(target) { return true }
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: app.frame.width * 0.85, dy: toolbarY))
          .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: app.frame.width * 0.2, dy: toolbarY)))
      }
      XCTFail("Render toolbar control must remain reachable"); return false
    }
    let legacy = app.buttons["Legacy questions"]
    guard revealToolbar(legacy), tapFixture(legacy) else { return }
    let question = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Which rollout path should we take?")).firstMatch
    guard question.waitForExistence(timeout: 8) else { XCTFail("Expected the actual merged questionnaire label"); return }
    XCTAssertFalse(app.buttons["Cancel turn"].exists)
    app.swipeDown()
    app.swipeDown()
    attachSettledPlanSession("legacy78-ios-questionnaire-light")
    let theme = app.buttons["Toggle preview theme"]
    guard revealToolbar(theme), tapFixture(theme) else { return }
    attachSettledPlanSession("legacy78-ios-questionnaire-dark")
    guard tapFixture(theme) else { return }
    func selectVisible(_ text: String, scrollUp: Bool = true) -> Bool {
      let option = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", text)).firstMatch
      for _ in 0..<10 {
        if visibleFixture(option) { return tapFixture(option) }
        if scrollUp { app.swipeUp() } else { app.swipeDown() }
      }
      XCTFail("Expected scrollable questionnaire control: \(text)"); return false
    }
    guard selectVisible("Ship it now", scrollUp: false), selectVisible("iOS Simulator"),
      selectVisible("Pixel 9"), selectVisible("Send answers") else { return }
    XCTAssertTrue(app.buttons["Response sent"].waitForExistence(timeout: 8))
    attachSettledPlanSession("legacy78-ios-questionnaire-answer-sent")
  }

  func testApprovedOriginalFixtureQueuesRestoresDeletesAndFlushesOneEcho() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 15,
      before["turnCount"] as? Int == 16,
      before["threadCount"] as? Int == 4,
      before["pendingCount"] as? Int == 0 else {
      XCTFail("Queue68 baseline already changed; do not resend"); return
    }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    guard openChat(app), send(app, "[reasoning] QUEUE68-HOLD"),
      let held = waitState({ ($0["reasoning"] as? [String: Any])?["stage"] as? String == "STREAM_INITIAL" && $0["turnStartCount"] as? Int == 16 }) else { return }
    XCTAssertTrue(app.buttons["Stop turn"].firstMatch.waitForExistence(timeout: 5))
    exerciseQueue(app, held: held)
  }

  func testContinueOwnedQueue68HeldTurnWithoutResendingStart() {
    let held = fixture()
    guard held["turnStartCount"] as? Int == 16, held["turnCount"] as? Int == 17,
      (held["reasoning"] as? [String: Any])?["stage"] as? String == "STREAM_INITIAL",
      (held["lastInput"] as? [[String: Any]])?.first?["text"] as? String == "[reasoning] QUEUE68-HOLD" else {
      XCTFail("Expected exactly the already submitted Queue68 hold; do not resend"); return
    }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    guard openChat(app) else { return }
    exerciseQueue(app, held: held)
  }

  private func theme(_ app: XCUIApplication, from original: String, to value: String) -> Bool {
    guard tap(app.buttons["Open navigation"].firstMatch), tap(label(app, "Remote")),
      tap(app.buttons["Settings"].firstMatch) else { return false }
    let row = label(app, "Theme")
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    XCTAssertEqual(row.value as? String, original)
    guard tap(row), tap(label(app, value)) else { return false }
    let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@ AND enabled == true", value), object: row)
    guard XCTWaiter.wait(for: [changed], timeout: 10) == .completed else {
      XCTFail("Expected the approved QA appearance"); return false
    }
    return tap(app.buttons["Done"].firstMatch)
  }

  func testCurrentQueue68fix2DarkAndSystemDeliversOneEcho() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 17, before["turnCount"] as? Int == 18,
      before["pendingCount"] as? Int == 0,
      (before["lastInput"] as? [[String: Any]])?.first?["text"] as? String == "[echo] QUEUE68-A" else {
      XCTFail("Current-build queue journey baseline changed; do not resend"); return
    }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    var restoreSystem = false
    defer {
      if restoreSystem {
        if label(app, "Queued").exists && app.buttons["Done"].firstMatch.isHittable {
          app.buttons["Done"].firstMatch.tap()
        }
        if app.buttons["Open navigation"].firstMatch.exists {
          _ = theme(app, from: "Dark", to: "System")
        }
      }
    }
    guard theme(app, from: "System", to: "Dark") else { return }
    restoreSystem = true
    guard openChat(app), send(app, "[reasoning] QUEUE68FIX2-HOLD"),
      let held = waitState({ ($0["reasoning"] as? [String: Any])?["stage"] as? String == "STREAM_INITIAL" && $0["turnStartCount"] as? Int == 18 }) else { return }
    XCTAssertTrue(label(app, "Follow up").waitForExistence(timeout: 5), "The busy hint must match the source queue action")
    guard send(app, "[echo] QUEUE68FIX2-A"), openChat(app), tap(app.buttons["Queued messages"].firstMatch) else { return }
    XCTAssertTrue(label(app, "[echo] QUEUE68FIX2-A").exists)
    attach("queue68fix2-ios-queue-dark")
    let local = fixture()
    XCTAssertEqual(local["turnStartCount"] as? Int, 18)
    XCTAssertEqual(local["turnCount"] as? Int, 19)
    let methods: ([String: Any]) -> Int = { state in
      ((state["requests"] as? [[String: Any]]) ?? []).filter { $0["method"] as? String == "turn/steer" }.count
    }
    XCTAssertEqual(methods(local), methods(held))
    guard tap(app.buttons["Done"].firstMatch), theme(app, from: "Dark", to: "System") else { return }
    restoreSystem = false
    guard openChat(app), tap(app.buttons["Queued messages"].firstMatch) else { return }
    attach("queue68fix2-ios-queue-system")
    guard tap(app.buttons["Done"].firstMatch), tap(app.buttons["Stop turn"].firstMatch),
      let done = waitState({ $0["turnStartCount"] as? Int == 19 && $0["turnCount"] as? Int == 20 }) else { return }
    let answer = app.descendants(matching: .any).matching(NSPredicate(format: "value CONTAINS %@", "Saved native conversation history. [echo] QUEUE68FIX2-A")).firstMatch
    XCTAssertTrue(answer.waitForExistence(timeout: 10))
    let idle = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["Stop turn"].firstMatch)
    XCTAssertEqual(XCTWaiter.wait(for: [idle], timeout: 5), .completed)
    XCTAssertEqual(methods(done), methods(held))
    XCTAssertEqual(done["threadCount"] as? Int, 4)
    XCTAssertEqual(done["pendingCount"] as? Int, 0)
    guard openChat(app) else { return }
    XCTAssertTrue(answer.waitForExistence(timeout: 10))
    XCTAssertTrue(label(app, "Follow up").exists)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    XCTAssertFalse(app.buttons["Queued messages"].firstMatch.exists)
    attach("queue68fix2-ios-queue-retained-system")
  }

  func testCurrentRecovery69StopAndQueueAfterBackground() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 19, before["turnCount"] as? Int == 20,
      before["pendingCount"] as? Int == 0,
      (before["lastInput"] as? [[String: Any]])?.first?["text"] as? String == "[echo] QUEUE68FIX2-A" else {
      XCTFail("Current-build queue journey baseline changed; do not resend"); return
    }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    var restoreSystem = false
    defer {
      if restoreSystem {
        if label(app, "Queued").exists && app.buttons["Done"].firstMatch.isHittable {
          app.buttons["Done"].firstMatch.tap()
        }
        if app.buttons["Open navigation"].firstMatch.exists {
          _ = theme(app, from: "Dark", to: "System")
        }
      }
    }
    guard theme(app, from: "System", to: "Dark") else { return }
    restoreSystem = true
    guard openChat(app), send(app, "[reasoning] RECOVERY69-HOLD"),
      let held = waitState({ ($0["reasoning"] as? [String: Any])?["stage"] as? String == "STREAM_INITIAL" && $0["turnStartCount"] as? Int == 20 }) else { return }
    XCTAssertTrue(label(app, "Follow up").waitForExistence(timeout: 5), "The busy hint must match the source queue action")
    guard send(app, "[echo] RECOVERY69-A"), openChat(app), tap(app.buttons["Queued messages"].firstMatch) else { return }
    XCTAssertTrue(label(app, "[echo] RECOVERY69-A").exists)
    attach("recovery69-ios-queue-dark")
    let local = fixture()
    XCTAssertEqual(local["turnStartCount"] as? Int, 20)
    XCTAssertEqual(local["turnCount"] as? Int, 21)
    let methods: ([String: Any]) -> Int = { state in
      ((state["requests"] as? [[String: Any]]) ?? []).filter { $0["method"] as? String == "turn/steer" }.count
    }
    XCTAssertEqual(methods(local), methods(held))
    guard tap(app.buttons["Done"].firstMatch) else { return }
    XCUIDevice.shared.press(.home)
    app.activate()
    XCTAssertEqual(fixture()["turnStartCount"] as? Int, 20, "Resume must preserve the volatile queue without resending")
    guard theme(app, from: "Dark", to: "System") else { return }
    restoreSystem = false
    guard openChat(app), tap(app.buttons["Queued messages"].firstMatch) else { return }
    attach("recovery69-ios-queue-system")
    guard tap(app.buttons["Done"].firstMatch), tap(app.buttons["Stop turn"].firstMatch),
      let done = waitState({ $0["turnStartCount"] as? Int == 21 && $0["turnCount"] as? Int == 22 }) else { return }
    let answer = app.descendants(matching: .any).matching(NSPredicate(format: "value CONTAINS %@", "Saved native conversation history. [echo] RECOVERY69-A")).firstMatch
    XCTAssertTrue(answer.waitForExistence(timeout: 10))
    let idle = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["Stop turn"].firstMatch)
    XCTAssertEqual(XCTWaiter.wait(for: [idle], timeout: 5), .completed)
    XCTAssertEqual(methods(done), methods(held))
    XCTAssertEqual(done["threadCount"] as? Int, 4)
    XCTAssertEqual(done["pendingCount"] as? Int, 0)
    guard openChat(app) else { return }
    XCTAssertTrue(answer.waitForExistence(timeout: 10))
    XCTAssertTrue(label(app, "Follow up").exists)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    XCTAssertFalse(app.buttons["Queued messages"].firstMatch.exists)
    attach("recovery69-ios-queue-retained-system")
  }

  func testCurrentPreflight70ValidStartStopAndQueue() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 21,
      before["turnCount"] as? Int == 22,
      before["threadCount"] as? Int == 4,
      before["pendingCount"] as? Int == 0 else {
      XCTFail("Preflight70 baseline changed; do not resend"); return
    }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    guard openChat(app), send(app, "[reasoning] PREFLIGHT70-HOLD"),
      let held = waitState({ $0["turnStartCount"] as? Int == 22 &&
        ($0["reasoning"] as? [String: Any])?["stage"] as? String == "STREAM_INITIAL" }),
      send(app, "[echo] PREFLIGHT70-A"), openChat(app),
      tap(app.buttons["Queued messages"].firstMatch) else { return }
    XCTAssertTrue(label(app, "[echo] PREFLIGHT70-A").exists)
    XCTAssertEqual(fixture()["turnStartCount"] as? Int, 22)
    attach("preflight70-ios-local-queue-system")
    guard tap(app.buttons["Done"].firstMatch), tap(app.buttons["Stop turn"].firstMatch),
      let done = waitState({ $0["turnStartCount"] as? Int == 23 &&
        $0["turnCount"] as? Int == 24 && $0["pendingCount"] as? Int == 0 }) else { return }
    let requests: ([String: Any], String) -> Int = { state, method in
      ((state["requests"] as? [[String: Any]]) ?? []).filter { $0["method"] as? String == method }.count
    }
    XCTAssertEqual(requests(done, "turn/interrupt"), requests(held, "turn/interrupt") + 1)
    XCTAssertEqual(requests(done, "turn/steer"), requests(held, "turn/steer"))
    guard openChat(app) else { return }
    let answer = app.descendants(matching: .any).matching(NSPredicate(format:
      "value CONTAINS %@", "Saved native conversation history. [echo] PREFLIGHT70-A")).firstMatch
    XCTAssertTrue(answer.waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["Stop turn"].firstMatch.exists)
    XCTAssertFalse(app.buttons["Queued messages"].firstMatch.exists)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    XCTAssertTrue(label(app, "Follow up").exists)
    attach("preflight70-ios-retained-system")
  }

  func testCurrentCheckpoint71ValidStartStopQueueAndDiff() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 23,
      before["turnCount"] as? Int == 24,
      before["threadCount"] as? Int == 4,
      before["pendingCount"] as? Int == 0 else {
      XCTFail("Checkpoint71 baseline changed; do not resend"); return
    }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    guard openChat(app), send(app, "[reasoning] CHECKPOINT71-HOLD"),
      let held = waitState({ $0["turnStartCount"] as? Int == 24 &&
        ($0["reasoning"] as? [String: Any])?["stage"] as? String == "STREAM_INITIAL" }),
      send(app, "[echo] CHECKPOINT71-A"), openChat(app),
      tap(app.buttons["Queued messages"].firstMatch) else { return }
    XCTAssertTrue(label(app, "[echo] CHECKPOINT71-A").exists)
    XCTAssertEqual(fixture()["turnStartCount"] as? Int, 24)
    attach("checkpoints71-ios-local-queue-system")
    guard tap(app.buttons["Done"].firstMatch), tap(app.buttons["Stop turn"].firstMatch),
      let done = waitState({ $0["turnStartCount"] as? Int == 25 &&
        $0["turnCount"] as? Int == 26 && $0["pendingCount"] as? Int == 0 }) else { return }
    let requests: ([String: Any], String) -> Int = { state, method in
      ((state["requests"] as? [[String: Any]]) ?? []).filter { $0["method"] as? String == method }.count
    }
    XCTAssertEqual(requests(done, "turn/interrupt"), requests(held, "turn/interrupt") + 1)
    XCTAssertEqual(requests(done, "turn/steer"), requests(held, "turn/steer"))
    guard openChat(app) else { return }
    let answer = app.descendants(matching: .any).matching(NSPredicate(format:
      "value CONTAINS %@", "Saved native conversation history. [echo] CHECKPOINT71-A")).firstMatch
    XCTAssertTrue(answer.waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["Stop turn"].firstMatch.exists)
    XCTAssertFalse(app.buttons["Queued messages"].firstMatch.exists)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    XCTAssertTrue(label(app, "Follow up").exists)
    attach("checkpoints71-ios-retained-system")
    let sequence = fixture()["requestSequence"] as? Int ?? 0
    guard tap(app.buttons["Thread actions"].firstMatch),
      tap(label(app, "More actions")),
      tap(label(app, "Turn changes and restore")) else { return }
    XCTAssertTrue(label(app, "Turn changes").waitForExistence(timeout: 10))
    guard let loaded = waitState({ state in
      ((state["requests"] as? [[String: Any]]) ?? []).contains { request in
        request["method"] as? String == "workspace/checkpointDiff" &&
          (request["sequence"] as? Int ?? 0) > sequence &&
          request["threadId"] as? String == "native-thread-2"
      }
    }) else { return }
    XCTAssertEqual(loaded["turnStartCount"] as? Int, 25)
    attach("checkpoints71-ios-turn-changes")
    guard tap(app.buttons["Back"].firstMatch) else { return }
    XCTAssertTrue(answer.waitForExistence(timeout: 10))
  }

  func testContinueCheckpoint71ReadOnlyTurnChangesWithoutResending() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 25,
      before["turnCount"] as? Int == 26,
      before["pendingCount"] as? Int == 0,
      (before["lastInput"] as? [[String: Any]])?.first?["text"] as? String == "[echo] CHECKPOINT71-A" else {
      XCTFail("Expected completed71 journey; never resend its start"); return
    }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    let sequence = before["requestSequence"] as? Int ?? 0
    if !label(app, "More actions").exists {
      guard tap(app.buttons["Thread actions"].firstMatch) else { return }
    }
    guard tap(label(app, "More actions")),
      tap(label(app, "Turn changes and restore")) else { return }
    XCTAssertTrue(label(app, "Turn changes").waitForExistence(timeout: 10))
    guard let loaded = waitState({ state in
      ((state["requests"] as? [[String: Any]]) ?? []).contains { request in
        request["method"] as? String == "workspace/checkpointDiff" &&
          (request["sequence"] as? Int ?? 0) > sequence &&
          request["threadId"] as? String == "native-thread-2"
      }
    }) else { return }
    XCTAssertEqual(loaded["turnStartCount"] as? Int, 25)
    XCTAssertEqual(loaded["turnCount"] as? Int, 26)
    XCTAssertFalse(((loaded["requests"] as? [[String: Any]]) ?? []).contains {
      $0["method"] as? String == "workspace/checkpointRestoreApply" &&
        ($0["sequence"] as? Int ?? 0) > sequence
    })
    attach("checkpoints71-ios-turn-changes")
    guard tap(app.buttons["Back"].firstMatch) else { return }
    let answer = app.descendants(matching: .any).matching(NSPredicate(format:
      "value CONTAINS %@", "Saved native conversation history. [echo] CHECKPOINT71-A")).firstMatch
    XCTAssertTrue(answer.waitForExistence(timeout: 10))
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    XCTAssertFalse(app.buttons["Queued messages"].firstMatch.exists)
    attach("checkpoints71-ios-restored-empty-system")
  }


  private func plan82Metrics(_ app: XCUIApplication, _ tag: String) {
    print("PLAN82_FRAME \(tag) \(app.frame)")
    for text in ["Active plan", "Done", "Plan", "Preparing the rollout in small, safe steps so the response stays visible while work is happening.", "The assistant is organizing the work before execution.", "Inspect the current conversation layout and top overlay behavior", "Completed", "Move the active plan out of the timeline overlay and into a compact accessory", "In progress", "Open the full task list in a sheet when the compact row is tapped", "Pending"] {
      let element = label(app, text)
      if element.exists { print("PLAN82_METRIC \(tag) \(text) \(element.frame)") }
    }
  }

  private func plan82ExpandFromGrabber(_ app: XCUIApplication) {
    let before = label(app, "Active plan").frame.minY
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.481))
      .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.13)))
    let expanded = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      let header = self.label(app, "Active plan")
      return header.exists && header.frame.minY < min(200, before - 100)
    }, object: app)
    XCTAssertEqual(XCTWaiter.wait(for: [expanded], timeout: 8), .completed, "Dragging the plan grabber must expand the sheet")
  }

  func testPlan82SwiftGrabberExpansion() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.swiftplan75")
    app.activate()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    guard question79Tap(app, "Progress"), question79Tap(app, "Open active plan") else { return }
    plan82ExpandFromGrabber(app)
    plan82Metrics(app, "swift-expanded")
    attachSettledPlanSession("plan82-swift-expanded")
    guard question79Tap(app, "Done") else { return }
  }

  func testPlan82FlutterGrabberExpansion() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.questioncomposer80")
    app.activate()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    if app.buttons["Open plan fixture"].waitForExistence(timeout: 5) {
      guard question79Tap(app, "Open plan fixture") else { return }
    }
    guard question79Tap(app, "Progress"), question79Tap(app, "Open active plan") else { return }
    plan82ExpandFromGrabber(app)
    plan82Metrics(app, "flutter-expanded")
    attachSettledPlanSession("plan82-flutter-expanded")
    guard question79Tap(app, "Done") else { return }
  }

  func testPlan82SwiftDetailsMetrics() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.swiftplan75")
    app.activate()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    guard question79Tap(app, "Progress"), question79Tap(app, "Open active plan") else { return }
    XCTAssertTrue(label(app, "Active plan").waitForExistence(timeout: 8))
    plan82Metrics(app, "swift-light")
    guard question79Tap(app, "Done"), question79Tap(app, "Theme"),
      question79Tap(app, "Open active plan") else { return }
    plan82Metrics(app, "swift-dark")
    guard question79Tap(app, "Done"), question79Tap(app, "Theme") else { return }
  }

  func testPlan82FlutterDetailsBaseline() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.questioncomposer80")
    app.activate()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    if app.buttons["Open plan fixture"].waitForExistence(timeout: 5) {
      guard question79Tap(app, "Open plan fixture") else { return }
    }
    guard question79Tap(app, "Progress"), question79Tap(app, "Open active plan") else { return }
    XCTAssertTrue(label(app, "Active plan").waitForExistence(timeout: 8))
    plan82Metrics(app, "flutter-light")
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "Pending", "Pending")).firstMatch.exists, "The plan steps must remain accessible")
    attachSettledPlanSession("plan82-flutter-detail-light")
    guard question79Tap(app, "Done") else { return }
    let y = label(app, "Render fixture").frame.midY
    let theme = app.buttons["Toggle preview theme"]
    if !theme.exists || !app.frame.contains(CGPoint(x: theme.frame.midX, y: theme.frame.midY)) {
      app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: app.frame.width * 0.85, dy: y))
        .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: app.frame.width * 0.2, dy: y)))
    }
    guard question79Tap(app, "Toggle preview theme"), question79Tap(app, "Open active plan") else { return }
    XCTAssertTrue(label(app, "Active plan").waitForExistence(timeout: 8))
    plan82Metrics(app, "flutter-dark")
    attachSettledPlanSession("plan82-flutter-detail-dark")
    guard question79Tap(app, "Done"), question79Tap(app, "Toggle preview theme") else { return }
  }

  func testPlan75FlutterRenderingFixture() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.plans75")
    app.activate()
    let openFixture = app.buttons["Open plan fixture"].firstMatch
    if openFixture.waitForExistence(timeout: 2) {
      guard tap(openFixture) else { return }
    }
    XCTAssertTrue(label(app, "Render fixture").waitForExistence(timeout: 10))
    let active = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Open active plan")).firstMatch
    XCTAssertTrue(active.waitForExistence(timeout: 10))
    attach("plans75-flutter-progress-light")
    guard tap(active) else { return }
    XCTAssertTrue(label(app, "Active plan").waitForExistence(timeout: 10))
    attach("plans75-flutter-detail-light")
    guard tap(app.buttons["Done"].firstMatch), tap(app.buttons["Result"].firstMatch) else { return }
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Proposed plan")).firstMatch.waitForExistence(timeout: 10))
    attach("plans75-flutter-result-collapsed-light")
    let expand = app.buttons.matching(NSPredicate(format: "label == %@ OR label CONTAINS %@", "Expand", "Expand plan")).firstMatch
    guard tap(expand) else { return }
    let collapse = app.buttons.matching(NSPredicate(format: "label == %@ OR label CONTAINS %@", "Collapse", "Collapse plan")).firstMatch
    XCTAssertTrue(collapse.waitForExistence(timeout: 5))
    attach("plans75-flutter-result-expanded-light")
    guard tap(collapse), tap(app.buttons["Toggle preview theme"].firstMatch) else { return }
    let settledTheme = XCTestExpectation(description: "Finish theme animation before recording contrast")
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { settledTheme.fulfill() }
    wait(for: [settledTheme], timeout: 2)
    attach("plans75-flutter-result-dark")
    guard tap(app.buttons["Progress"].firstMatch), tap(active) else { return }
    XCTAssertTrue(label(app, "Active plan").waitForExistence(timeout: 10))
    attach("plans75-flutter-detail-dark")
    guard tap(app.buttons["Done"].firstMatch), tap(app.buttons["Toggle preview theme"].firstMatch) else { return }
  }

  func testPlan75SourceRenderingReference() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.swiftplan75")
    app.activate()
    XCTAssertTrue(label(app, "Source render fixture").waitForExistence(timeout: 10))
    attach("plans75-swift-progress-light")
    guard tap(app.buttons["Open active plan"].firstMatch) else { return }
    XCTAssertTrue(label(app, "Active plan").waitForExistence(timeout: 10))
    attach("plans75-swift-detail-light")
    guard tap(app.buttons["Done"].firstMatch), tap(app.buttons["Result"].firstMatch) else { return }
    XCTAssertTrue(label(app, "Proposed plan").waitForExistence(timeout: 10))
    attach("plans75-swift-result-collapsed-light")
    guard tap(app.buttons["Expand plan"].firstMatch) else { return }
    XCTAssertTrue(app.buttons["Collapse plan"].firstMatch.waitForExistence(timeout: 5))
    attach("plans75-swift-result-expanded-light")
    guard tap(app.buttons["Collapse plan"].firstMatch), tap(app.buttons["Theme"].firstMatch) else { return }
    attach("plans75-swift-result-dark")
    guard tap(app.buttons["Progress"].firstMatch), tap(app.buttons["Open active plan"].firstMatch) else { return }
    XCTAssertTrue(label(app, "Active plan").waitForExistence(timeout: 10))
    attach("plans75-swift-detail-dark")
    guard tap(app.buttons["Done"].firstMatch), tap(app.buttons["Theme"].firstMatch) else { return }
  }

  private func assertPlan76HeaderPaint(_ app: XCUIApplication, isDark: Bool) {
    let title = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Fork of Mobile workspace")).firstMatch
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    guard title.exists, title.frame.width > 100, title.frame.height > 10,
      let image = XCUIScreen.main.screenshot().image.cgImage else {
      XCTFail("Expected a bounded native header and screenshot"); return
    }
    let scale = CGFloat(image.width) / app.frame.width
    let frame = title.frame
    let region = CGRect(x: frame.minX * scale, y: frame.minY * scale,
      width: frame.width * scale, height: min(frame.height * 0.52, 17) * scale)
    guard let crop = image.cropping(to: region) else { XCTFail("Header crop unavailable"); return }
    var pixels = [UInt8](repeating: 0, count: crop.width * crop.height * 4)
    pixels.withUnsafeMutableBytes { bytes in
      let context = CGContext(data: bytes.baseAddress, width: crop.width, height: crop.height,
        bitsPerComponent: 8, bytesPerRow: crop.width * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue)
      context?.draw(crop, in: CGRect(x: 0, y: 0, width: crop.width, height: crop.height))
    }
    var glyphs = 0, background = 0
    for offset in stride(from: 0, to: pixels.count, by: 4) {
      let red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2]
      let lightest = max(red, max(green, blue)), darkest = min(red, min(green, blue))
      if isDark {
        if darkest > 200 { glyphs += 1 }
        if lightest < 96 { background += 1 }
      } else {
        if lightest < 160 { glyphs += 1 }
        if darkest > 210 { background += 1 }
      }
    }
    print("PLAN76_HEADER_RENDER darkTheme=\(isDark) glyphPixels=\(glyphs) frame=\(frame)")
    XCTAssertGreaterThan(background, pixels.count / 8, "The header background must match the verified QA appearance.")
    XCTAssertGreaterThan(glyphs, 100, "The header must paint visible title glyphs, not only expose an accessibility label.")
  }

  func testPlan76HeaderLayoutAfterDefaultReply() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 29, before["turnCount"] as? Int == 30,
      before["pendingCount"] as? Int == 0 else { XCTFail("Read-only header baseline changed"); return }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    guard openChat(app) else { return }
    func tapVisiblePlanControl(_ title: String) -> Bool {
      func visible() -> XCUIElement? {
        app.buttons.matching(identifier: title).allElementsBoundByIndex.first(where: {
          let frame = $0.frame
          return frame.width >= 20 && frame.height >= 20 && app.frame.contains(CGPoint(x: frame.midX, y: frame.midY))
        })
      }
      let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in visible() != nil }, object: app)
      guard XCTWaiter.wait(for: [ready], timeout: 8) == .completed,
        let control = visible() else { XCTFail("Expected a visible plan control: \(title)"); return false }
      let frame = control.frame
      app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
      return true
    }
    guard tapVisiblePlanControl("Expand"), app.buttons["Collapse"].waitForExistence(timeout: 8),
      tapVisiblePlanControl("Collapse"), app.buttons["Expand"].firstMatch.waitForExistence(timeout: 8),
      tap(app.buttons["Composer options"].firstMatch) else { return }
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.88, dy: 0.35)).tap()
    attachSettledPlanSession("plan-sessions76-ios-header-render")
    assertPlan76HeaderPaint(app, isDark: false)
    let after = fixture()
    XCTAssertEqual(after["turnStartCount"] as? Int, 29)
    XCTAssertEqual(after["turnCount"] as? Int, 30)
  }

  private func changePlan76Theme(_ app: XCUIApplication, expected: String, next: String) -> Bool {
    guard tap(app.buttons["Open navigation"].firstMatch), tap(label(app, "Remote")),
      tap(app.buttons["Settings"].firstMatch) else { return false }
    let theme = label(app, "Theme")
    guard theme.waitForExistence(timeout: 8), theme.value as? String == expected else {
      XCTFail("Preserve unexpected QA appearance"); return false
    }
    guard tap(theme), tap(label(app, next)) else { return false }
    let applied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", next), object: theme)
    guard XCTWaiter.wait(for: [applied], timeout: 8) == .completed else {
      XCTFail("QA appearance did not apply"); return false
    }
    return tap(app.buttons["Done"].firstMatch)
  }

  func testPlan76ComposedGlassDarkAndRestoredSystem() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 29, before["turnCount"] as? Int == 30,
      before["pendingCount"] as? Int == 0 else { XCTFail("Read-only appearance baseline changed"); return }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    guard openChat(app), changePlan76Theme(app, expected: "System", next: "Dark"), openChat(app) else { return }
    attachSettledPlanSession("plan-sessions76-ios-composed-dark")
    assertPlan76HeaderPaint(app, isDark: true)
    XCTAssertTrue(app.buttons["Implement"].firstMatch.exists)
    guard changePlan76Theme(app, expected: "Dark", next: "System"), openChat(app) else { return }
    attachSettledPlanSession("plan-sessions76-ios-composed-system-restored")
    assertPlan76HeaderPaint(app, isDark: false)
    XCTAssertFalse(label(app, "Plan mode").exists)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    let after = fixture()
    XCTAssertEqual(after["turnStartCount"] as? Int, 29)
    XCTAssertEqual(after["turnCount"] as? Int, 30)
  }


  private func attachSettledPlanSession(_ name: String) {
    let settled = XCTestExpectation(description: "Finish plan-session UI animation")
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { settled.fulfill() }
    wait(for: [settled], timeout: 3)
    attach(name)
  }

  func testPlan76RequestedSessionBeforeColdRestart() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 27, before["turnCount"] as? Int == 28,
      before["threadCount"] as? Int == 4, before["pendingCount"] as? Int == 0 else {
      XCTFail("Plan76 initial baseline changed; never resend input"); return
    }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    guard openChat(app) else { return }
    guard !label(app, "Plan mode").exists else {
      XCTFail("Preserve unexpected existing Plan preference"); return
    }
    guard tap(app.buttons["Composer options"].firstMatch), tap(label(app, "Plan mode")) else { return }
    let prompt = "[echo] <proposed_plan>SESSION76</proposed_plan>"
    guard send(app, prompt), let done = waitState({ state in
      state["turnStartCount"] as? Int == 28 && state["turnCount"] as? Int == 29 && state["pendingCount"] as? Int == 0
    }) else { return }
    XCTAssertEqual((done["lastInput"] as? [[String: Any]])?.first?["text"] as? String, prompt)
    XCTAssertEqual((done["lastTurn"] as? [String: Any])?["threadId"] as? String, "native-thread-2")
    guard openChat(app) else { return }
    XCTAssertTrue(label(app, "Plan mode").waitForExistence(timeout: 8))
    attachSettledPlanSession("plan-sessions76-ios-requested-before-restart")
    XCTAssertFalse(app.buttons["Implement"].firstMatch.exists)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    XCTAssertFalse(app.buttons["Stop turn"].firstMatch.exists)
  }

  // Run after a verified ordinary-app cold launch, following the one-shot first stage.
  func testPlan76RestoredSessionAndOwnedDefaultReply() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 28, before["turnCount"] as? Int == 29,
      before["threadCount"] as? Int == 4, before["pendingCount"] as? Int == 0,
      (before["lastInput"] as? [[String: Any]])?.first?["text"] as? String == "[echo] <proposed_plan>SESSION76</proposed_plan>" else {
      XCTFail("Expected completed plan76 first stage; do not resend it"); return
    }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    // The first attempt may already have opened this checked menu; never resend stage one.
    if !label(app, "Photo library").exists {
      guard openChat(app) else { return }
      XCTAssertTrue(label(app, "Plan mode").waitForExistence(timeout: 8))
      attachSettledPlanSession("plan-sessions76-ios-restored-after-cold-launch")
      XCTAssertFalse(app.buttons["Implement"].firstMatch.exists)
      guard tap(app.buttons["Composer options"].firstMatch) else { return }
    }
    let choices = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Plan mode")).allElementsBoundByIndex
    guard let checkedMode = choices.first(where: { $0.isHittable }), tap(checkedMode) else {
      XCTFail("Expected visible checked Plan menu item"); return
    }
    let off = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: label(app, "Plan mode"))
    guard XCTWaiter.wait(for: [off], timeout: 5) == .completed else {
      XCTFail("Plan preference did not return to its original off value"); return
    }
    let prompt = "[echo] SESSION76-NORMAL"
    guard send(app, prompt), let done = waitState({ state in
      state["turnStartCount"] as? Int == 29 && state["turnCount"] as? Int == 30 && state["pendingCount"] as? Int == 0
    }) else { return }
    XCTAssertEqual((done["lastInput"] as? [[String: Any]])?.first?["text"] as? String, prompt)
    XCTAssertEqual((done["lastTurn"] as? [String: Any])?["threadId"] as? String, "native-thread-2")
    XCTAssertEqual(done["threadCount"] as? Int, 4)
    guard openChat(app) else { return }
    let body = app.descendants(matching: .any).matching(NSPredicate(format: "value == %@ OR label == %@", "SESSION76", "SESSION76")).firstMatch
    XCTAssertTrue(body.waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["Implement"].firstMatch.exists)
    XCTAssertFalse(label(app, "Plan mode").exists)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    XCTAssertFalse(app.buttons["Stop turn"].firstMatch.exists)
    XCTAssertFalse(app.buttons["Queued messages"].firstMatch.exists)
    attachSettledPlanSession("plan-sessions76-ios-final-default-idle")
  }

  func testPlan75ReadOnlyRestoreAfterColdLaunch() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 27, before["turnCount"] as? Int == 28,
      before["threadCount"] as? Int == 4, before["pendingCount"] as? Int == 0 else {
      XCTFail("Expected completed plan75; do not send any input"); return
    }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    guard openChat(app) else { return }
    let answer = app.descendants(matching: .any).matching(NSPredicate(format:
      "value CONTAINS %@ OR label CONTAINS %@", "Change declined.", "Change declined.")).firstMatch
    XCTAssertTrue(answer.waitForExistence(timeout: 10))
    let settled = XCTestExpectation(description: "Finish drawer navigation before recording idle state")
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { settled.fulfill() }
    wait(for: [settled], timeout: 2)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    XCTAssertFalse(app.buttons["Queued messages"].firstMatch.exists)
    XCTAssertFalse(app.buttons["Stop turn"].firstMatch.exists)
    let after = fixture()
    for key in ["turnStartCount", "turnCount", "threadCount", "pendingCount"] {
      XCTAssertEqual(after[key] as? Int, before[key] as? Int)
    }
    attach("plans75-ios-cold-restored-idle")
  }

  func testPlan75ContinueOwnedImplementationWithoutResendingEcho() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 26, before["turnCount"] as? Int == 27,
      before["threadCount"] as? Int == 4, before["pendingCount"] as? Int == 0,
      ((before["lastInput"] as? [[String: Any]])?.first?["text"] as? String)?.hasPrefix("[echo] <proposed_plan>## Native plan75") == true else {
      XCTFail("Expected completed plan75 echo; never resend it"); return
    }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    func visibleCenterTap(_ element: XCUIElement) -> Bool {
      guard element.waitForExistence(timeout: 8), element.frame.width > 20,
        element.frame.height > 20, app.frame.contains(element.frame) else {
        XCTFail("Expected visible plan control with bounded native frame"); return false
      }
      element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
      return true
    }
    guard visibleCenterTap(app.buttons["Expand"].firstMatch) else { return }
    XCTAssertTrue(app.buttons["Collapse"].firstMatch.waitForExistence(timeout: 5))
    attach("plans75-ios-proposed-expanded-system")
    guard visibleCenterTap(app.buttons["Collapse"].firstMatch),
      visibleCenterTap(app.buttons["Implement"].firstMatch),
      let pending = waitState({ state in
        state["turnStartCount"] as? Int == 27 && state["turnCount"] as? Int == 28 && state["pendingCount"] as? Int == 1
      }) else { return }
    XCTAssertEqual((pending["lastInput"] as? [[String: Any]])?.first?["text"] as? String, "Implement plan.")
    XCTAssertEqual((pending["lastTurn"] as? [String: Any])?["threadId"] as? String, "native-thread-2")
    attach("plans75-ios-implementation-approval")
    guard tap(app.buttons["Decline"].firstMatch), let done = waitState({ state in
      state["turnStartCount"] as? Int == 27 && state["turnCount"] as? Int == 28 && state["pendingCount"] as? Int == 0
    }) else { return }
    XCTAssertEqual(done["threadCount"] as? Int, 4)
    let requests = ((done["requests"] as? [[String: Any]]) ?? []).filter {
      ($0["sequence"] as? Int ?? 0) > 1656
    }
    XCTAssertEqual(requests.filter { $0["method"] as? String == "turn/start" }.count, 2)
    XCTAssertTrue(requests.filter { $0["method"] as? String == "turn/steer" }.isEmpty)
    guard openChat(app) else { return }
    XCTAssertFalse(app.buttons["Stop turn"].firstMatch.exists)
    XCTAssertFalse(app.buttons["Queued messages"].firstMatch.exists)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("plans75-ios-final-history-system")
  }

  func testPlan75EchoAndOwnedDefaultStartWithoutFileChanges() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 25, before["turnCount"] as? Int == 26,
      before["threadCount"] as? Int == 4, before["pendingCount"] as? Int == 0 else {
      XCTFail("Plan75 baseline changed; never resend its input"); return
    }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    let prompt = "[echo] <proposed_plan>## Native plan75\n- Inspect the focused flow.\n- Preserve the paired session.\n- Keep the draft intact.\n- Review the final proposal.\n- Verify both platforms.\n- Leave workspace files unchanged.\n</proposed_plan>"
    guard openChat(app), send(app, prompt), let echoed = waitState({ state in
      state["turnStartCount"] as? Int == 26 && state["turnCount"] as? Int == 27 && state["pendingCount"] as? Int == 0
    }) else { return }
    XCTAssertEqual((echoed["lastInput"] as? [[String: Any]])?.first?["text"] as? String, prompt)
    guard openChat(app) else { return }
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Proposed plan")).firstMatch.waitForExistence(timeout: 10))
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("plans75-ios-proposed-collapsed-system")
    let expand = app.buttons.matching(NSPredicate(format: "label == %@ OR label CONTAINS %@", "Expand", "Expand plan")).firstMatch
    guard tap(expand) else { return }
    let collapse = app.buttons.matching(NSPredicate(format: "label == %@ OR label CONTAINS %@", "Collapse", "Collapse plan")).firstMatch
    XCTAssertTrue(collapse.waitForExistence(timeout: 5))
    attach("plans75-ios-proposed-expanded-system")
    guard tap(collapse), tap(app.buttons["Implement"].firstMatch), let pending = waitState({ state in
      state["turnStartCount"] as? Int == 27 && state["turnCount"] as? Int == 28 && state["pendingCount"] as? Int == 1
    }) else { return }
    XCTAssertEqual((pending["lastInput"] as? [[String: Any]])?.first?["text"] as? String, "Implement plan.")
    XCTAssertEqual((pending["lastTurn"] as? [String: Any])?["threadId"] as? String, "native-thread-2")
    attach("plans75-ios-implementation-approval")
    guard tap(app.buttons["Decline"].firstMatch), let done = waitState({ state in
      state["turnStartCount"] as? Int == 27 && state["turnCount"] as? Int == 28 && state["pendingCount"] as? Int == 0
    }) else { return }
    XCTAssertEqual(done["threadCount"] as? Int, 4)
    let sequence = before["requestSequence"] as? Int ?? 0
    let requests = ((done["requests"] as? [[String: Any]]) ?? []).filter { ($0["sequence"] as? Int ?? 0) > sequence }
    XCTAssertEqual(requests.filter { $0["method"] as? String == "turn/start" }.count, 2)
    XCTAssertTrue(requests.filter { $0["method"] as? String == "turn/steer" }.isEmpty)
    guard openChat(app) else { return }
    XCTAssertFalse(app.buttons["Stop turn"].firstMatch.exists)
    XCTAssertFalse(app.buttons["Queued messages"].firstMatch.exists)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("plans75-ios-final-history-system")
  }

  func testCheckpoint71fix1EmptyDiffFeedbackReadOnly() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 25,
      before["turnCount"] as? Int == 26,
      before["pendingCount"] as? Int == 0,
      (before["lastInput"] as? [[String: Any]])?.first?["text"] as? String == "[echo] CHECKPOINT71-A" else {
      XCTFail("Expected completed71 journey; never resend its start"); return
    }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    let sequence = before["requestSequence"] as? Int ?? 0
    guard openChat(app), tap(app.buttons["Thread actions"].firstMatch),
      tap(label(app, "More actions")),
      tap(label(app, "Turn changes and restore")) else { return }
    let message = "No saved changes for this turn."
    let empty = app.descendants(matching: .any).matching(NSPredicate(format:
      "label == %@ OR value == %@", message, message)).firstMatch
    XCTAssertTrue(empty.waitForExistence(timeout: 10))
    guard let loaded = waitState({ state in
      ((state["requests"] as? [[String: Any]]) ?? []).contains { request in
        request["method"] as? String == "workspace/checkpointDiff" &&
          (request["sequence"] as? Int ?? 0) > sequence &&
          request["threadId"] as? String == "native-thread-2"
      }
    }) else { return }
    XCTAssertEqual(loaded["turnStartCount"] as? Int, 25)
    XCTAssertEqual(loaded["turnCount"] as? Int, 26)
    XCTAssertFalse(((loaded["requests"] as? [[String: Any]]) ?? []).contains {
      $0["method"] as? String == "workspace/checkpointRestoreApply" &&
        ($0["sequence"] as? Int ?? 0) > sequence
    })
    attach("checkpoints71fix1-ios-empty-diff")
    guard tap(app.buttons["Back"].firstMatch) else { return }
    let answer = app.descendants(matching: .any).matching(NSPredicate(format:
      "value CONTAINS %@", "Saved native conversation history. [echo] CHECKPOINT71-A")).firstMatch
    XCTAssertTrue(answer.waitForExistence(timeout: 10))
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    XCTAssertFalse(app.buttons["Queued messages"].firstMatch.exists)
    XCTAssertFalse(app.buttons["Stop turn"].firstMatch.exists)
    attach("checkpoints71fix1-ios-restored-empty-system")
  }

  private func exerciseQueue(_ app: XCUIApplication, held: [String: Any]) {
    guard send(app, "[echo] QUEUE68-RESTORE"), openChat(app) else { return }
    let capsule = app.buttons["Queued messages"].firstMatch
    guard tap(capsule), tap(app.buttons["Move draft into input"].firstMatch) else { return }
    let field = app.descendants(matching: .any).matching(NSPredicate(format: "value == %@", "[echo] QUEUE68-RESTORE")).firstMatch
    XCTAssertEqual(field.value as? String, "[echo] QUEUE68-RESTORE")
    XCTAssertFalse(app.buttons["Done"].firstMatch.exists)
    XCTAssertFalse(capsule.exists)
    attach("queue68-ios-raw-restored")
    guard tap(app.buttons["Send to desktop"].firstMatch), openChat(app), tap(capsule) else { return }
    attach("queue68-ios-sheet-before-delete")
    guard tap(app.buttons["Delete queued message"].firstMatch) else { return }
    XCTAssertFalse(app.buttons["Done"].firstMatch.exists)
    XCTAssertFalse(capsule.exists)
    guard send(app, "[echo] QUEUE68-A"), openChat(app), tap(capsule) else { return }
    attach("queue68-ios-sheet-before-rejection")
    let local = fixture()
    XCTAssertEqual(local["turnStartCount"] as? Int, 16)
    XCTAssertEqual(local["turnCount"] as? Int, 17)
    let oldSteers = ((held["requests"] as? [[String: Any]]) ?? []).filter { $0["method"] as? String == "turn/steer" }.count
    XCTAssertEqual(((local["requests"] as? [[String: Any]]) ?? []).filter { $0["method"] as? String == "turn/steer" }.count, oldSteers)
    guard tap(app.buttons["Steer"].firstMatch), let rejected = waitState({
      ((($0["requests"] as? [[String: Any]]) ?? []).filter { $0["method"] as? String == "turn/steer" }.count) == oldSteers + 1
    }) else { return }
    XCTAssertEqual(rejected["turnStartCount"] as? Int, 16)
    XCTAssertTrue(label(app, "[echo] QUEUE68-A").exists)
    attach("queue68-ios-rejected-steer-retained")
    guard tap(app.buttons["Done"].firstMatch), tap(app.buttons["Stop turn"].firstMatch),
      let complete = waitState({ $0["turnStartCount"] as? Int == 17 && $0["turnCount"] as? Int == 18 }) else { return }
    let answer = app.descendants(matching: .any).matching(NSPredicate(format: "value CONTAINS %@", "Saved native conversation history. [echo] QUEUE68-A")).firstMatch
    XCTAssertTrue(answer.waitForExistence(timeout: 10))
    let idle = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["Stop turn"].firstMatch)
    XCTAssertEqual(XCTWaiter.wait(for: [idle], timeout: 5), .completed)
    XCTAssertFalse(capsule.exists)
    XCTAssertEqual(complete["threadCount"] as? Int, 4)
    XCTAssertEqual(complete["pendingCount"] as? Int, 0)
    attach("queue68-ios-fifo-completed")
    guard openChat(app) else { return }
    XCTAssertTrue(answer.waitForExistence(timeout: 10))
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    XCTAssertFalse(capsule.exists)
    attach("queue68-ios-retained-history")
  }
}
