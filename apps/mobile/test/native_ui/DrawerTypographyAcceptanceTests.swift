import XCTest

final class DrawerTypographyAcceptanceTests: XCTestCase {
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
      attach("drawer55-control-missing")
      return false
    }
    element.tap()
    return true
  }

  func testOrdinaryDrawerSearchMenuCancelAndSavedChat() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    func label(_ text: String) -> XCUIElement {
      app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", text)).firstMatch
    }
    app.activate()
    if label("Pin chat").exists || label("Unpin chat").exists {
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.8)).tap()
      let closed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
        !label("Pin chat").exists && !label("Unpin chat").exists
      }, object: nil)
      XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 5), .completed)
      if app.buttons["Close navigation"].firstMatch.exists {
        guard tap(app.buttons["Close navigation"].firstMatch) else { return }
      }
    }
    guard tap(app.buttons["Open navigation"].firstMatch), tap(label("Remote")), tap(app.buttons["Open navigation"].firstMatch) else { return }
    let search = app.buttons["Search chats"].firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    XCTAssertTrue(label("Pinned").exists)
    XCTAssertTrue(label("Recent chats").exists)
    attach("drawer55-native-drawer")
    guard tap(search) else { return }
    let field = app.textFields.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    guard field.exists else { return }
    field.typeText("Fork")
    XCTAssertEqual(field.value as? String, "Fork")
    let thread = label("Fork of Mobile workspace QA")
    XCTAssertTrue(thread.waitForExistence(timeout: 5))
    attach("drawer55-native-filter")
    guard tap(app.buttons["Close search"].firstMatch) else { return }
    let hidden = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
    XCTAssertEqual(XCTWaiter.wait(for: [hidden], timeout: 5), .completed)
    XCTAssertFalse(field.exists)
    for _ in 0..<10 {
      if thread.exists && thread.isHittable { break }
      app.swipeUp()
    }
    XCTAssertTrue(thread.isHittable)
    guard thread.isHittable else { return }
    thread.press(forDuration: 0.8)
    let pin = label("Pin chat"), unpin = label("Unpin chat")
    let menu = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in pin.exists || unpin.exists }, object: nil)
    guard XCTWaiter.wait(for: [menu], timeout: 5) == .completed else {
      XCTFail("Expected the existing chat pin menu")
      attach("drawer55-menu-missing")
      return
    }
    attach("drawer55-native-menu-review")
    // The observed right-hand content is outside this menu; its modal barrier
    // dismisses the review without invoking Pin/Unpin.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.8)).tap()
    let closed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      !pin.exists && !unpin.exists
    }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 5), .completed)
    XCTAssertFalse(pin.exists)
    XCTAssertFalse(unpin.exists)
    guard tap(thread) else { return }
    let composer = label("Follow up")
    XCTAssertTrue(composer.waitForExistence(timeout: 10))
    let value = composer.value as? String ?? ""
    XCTAssertTrue(value.isEmpty || value == "Follow up")
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("drawer55-original-chat-restored")
  }
}
