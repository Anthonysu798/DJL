import XCTest

final class ConnectionsTypographyAcceptanceTests: XCTestCase {
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
      attach("connections58-control-missing")
      return false
    }
    element.tap()
    return true
  }

  func testOrdinaryConnectionsRowsMenuReviewAndSavedChat() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    func label(_ text: String) -> XCUIElement {
      app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", text)).firstMatch
    }
    func review(_ appearance: String) -> Bool {
      guard tap(app.buttons["More actions"].firstMatch), tap(label("Connections")) else { return false }
      let active = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Active device, ")).firstMatch
      XCTAssertTrue(active.waitForExistence(timeout: 5))
      XCTAssertTrue(label("Devices").exists)
      XCTAssertTrue(label("Scan QR Code").exists)
      XCTAssertTrue(label("Pair with Code").exists)
      XCTAssertFalse(app.keyboards.firstMatch.exists)
      attach("connections58-\(appearance)-rows")
      guard tap(active) else { return false }
      XCTAssertTrue(label("Switch to").waitForExistence(timeout: 5))
      attach("connections58-\(appearance)-menu-review")
      // This lower-right background lies outside the upper-left switch menu.
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.9)).tap()
      let menuClosed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: label("Switch to"))
      XCTAssertEqual(XCTWaiter.wait(for: [menuClosed], timeout: 5), .completed)
      guard tap(app.buttons["Close"].firstMatch) else { return false }
      let sheetClosed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: active)
      XCTAssertEqual(XCTWaiter.wait(for: [sheetClosed], timeout: 5), .completed)
      return !active.exists
    }
    func theme(_ next: String, expected: String) -> Bool {
      guard tap(app.buttons["Settings"].firstMatch) else { return false }
      let control = label("Theme")
      XCTAssertTrue(control.waitForExistence(timeout: 5))
      XCTAssertEqual(control.value as? String, expected)
      guard tap(control), tap(label(next)) else { return false }
      let applied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@ AND enabled == true", next), object: control)
      XCTAssertEqual(XCTWaiter.wait(for: [applied], timeout: 10), .completed)
      attach("connections58-theme-\(next)")
      return tap(app.buttons["Done"].firstMatch)
    }
    app.activate()
    guard tap(app.buttons["Open navigation"].firstMatch), tap(label("Remote")),
      review("system"), theme("Dark", expected: "System"), review("dark"),
      theme("System", expected: "Dark") else { return }
    guard tap(app.buttons["Projects"].firstMatch), tap(label("Fork of Mobile workspace QA")) else { return }
    let composer = label("Follow up")
    XCTAssertTrue(composer.waitForExistence(timeout: 10))
    let value = composer.value as? String ?? ""
    XCTAssertTrue(value.isEmpty || value == "Follow up")
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("connections58-original-chat-restored")
  }
}
