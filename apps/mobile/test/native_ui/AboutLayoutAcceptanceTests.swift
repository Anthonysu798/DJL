import XCTest

final class AboutLayoutAcceptanceTests: XCTestCase {
  private func attach(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }

  private func tap(_ element: XCUIElement) -> Bool {
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"), object: element)
    guard XCTWaiter.wait(for: [ready], timeout: 10) == .completed else {
      XCTFail("Expected a visible control: \(element)")
      attach("about54-control-missing")
      return false
    }
    element.tap()
    return true
  }

  private func scroll(_ app: XCUIApplication, to element: XCUIElement, up: Bool) -> Bool {
    for _ in 0..<25 {
      if element.exists && element.isHittable && app.frame.contains(element.frame) { return true }
      let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.72 : 0.35))
      let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.42 : 0.65))
      start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
    }
    XCTFail("Expected content did not become fully visible: \(element)")
    attach("about54-scroll-target-missing")
    return false
  }

  func testOrdinaryGuideLightDarkFlowFooterAndRestoration() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    func label(_ text: String) -> XCUIElement {
      app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", text)).firstMatch
    }
    func selectTheme(_ value: String) -> Bool {
      let theme = app.buttons["Theme"].firstMatch
      guard scroll(app, to: theme, up: false), tap(theme), tap(label(value)) else { return false }
      let applied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@ AND enabled == true", value), object: theme)
      let ready = XCTWaiter.wait(for: [applied], timeout: 10) == .completed
      XCTAssertTrue(ready)
      return ready
    }

    app.activate()
    guard tap(app.buttons["Open navigation"].firstMatch), tap(label("Remote")), tap(app.buttons["Settings"].firstMatch) else { return }
    guard app.buttons["Theme"].firstMatch.value as? String == "System" else {
      XCTFail("The prepared QA app must begin with its original System appearance")
      return
    }
    defer {
      if label("About DJL").exists && app.buttons["Back"].firstMatch.exists {
        _ = tap(app.buttons["Back"].firstMatch)
      }
      let theme = app.buttons["Theme"].firstMatch
      if theme.exists && theme.value as? String == "Dark" {
        _ = selectTheme("System")
      }
      if app.buttons["Done"].firstMatch.isHittable {
        _ = tap(app.buttons["Done"].firstMatch)
      }
    }
    for mode in ["System", "Dark"] {
      if mode == "Dark" && !selectTheme(mode) { return }
      let guide = label("How DJL Works")
      guard scroll(app, to: guide, up: true) else { return }
      var frame = CGRect.zero
      var samples = 0
      let stopped = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
        guard guide.exists, guide.isHittable else { return false }
        let next = guide.frame
        samples = frame == next ? samples + 1 : 0
        frame = next
        return samples >= 2
      }, object: nil)
      guard XCTWaiter.wait(for: [stopped], timeout: 10) == .completed else {
        XCTFail("Guide row did not settle before navigation")
        attach("about54-guide-row-not-settled")
        return
      }
      guard tap(guide) else { return }
      XCTAssertTrue(label("About DJL").waitForExistence(timeout: 5))
      XCTAssertTrue(label("How It Works").waitForExistence(timeout: 5))
      XCTAssertFalse(app.keyboards.firstMatch.exists)
      attach("about54-" + mode + "-first-screen")
      let wire = label("Codex to ~/.codex/sessions via JSONL rollout")
      guard scroll(app, to: wire, up: true) else { return }
      let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
      let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55))
      start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
      XCTAssertTrue(label("DJL Mobile to Bridge on your paired device via WebSocket").exists)
      XCTAssertTrue(wire.exists)
      attach("about54-" + mode + "-flow")
      guard scroll(app, to: label("MIT License"), up: true) else { return }
      XCTAssertTrue(app.buttons["Open source"].firstMatch.exists)
      attach("about54-" + mode + "-footer")
      guard tap(app.buttons["Back"].firstMatch) else { return }
    }
    guard selectTheme("System"), tap(app.buttons["Done"].firstMatch), tap(app.buttons["Projects"].firstMatch), tap(label("Fork of Mobile workspace QA")) else { return }
    let field = label("Follow up")
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    let value = field.value as? String ?? ""
    XCTAssertTrue(value.isEmpty || value == "Follow up")
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("about54-original-chat-restored")
  }
}
