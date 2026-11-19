import XCTest

final class PublicOverviewParityTests: XCTestCase {
  private func tap(_ element: XCUIElement) -> Bool {
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"), object: element)
    guard XCTWaiter.wait(for: [ready], timeout: 10) == .completed else {
      XCTFail("Expected native control: \(element)")
      attach("overview62-missing-control"); return false
    }
    element.tap()
    return true
  }

  private func attach(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }

  private func checkFooter(_ app: XCUIApplication, prefix: String) {
    let terminal = app.buttons["Terminal"].firstMatch
    let chat = app.buttons["New chat"].firstMatch
    XCTAssertTrue(terminal.waitForExistence(timeout: 10))
    XCTAssertTrue(chat.exists)
    guard terminal.exists && chat.exists else { return }
    XCTAssertEqual(terminal.frame.minX, 16, accuracy: 1)
    XCTAssertEqual(chat.frame.maxX, app.frame.width - 16, accuracy: 1)
    XCTAssertEqual(terminal.frame.midY, chat.frame.midY, accuracy: 2)
    print("OVERVIEW62_\(prefix) terminal=\(terminal.frame) chat=\(chat.frame)")
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("overview62-\(prefix)-footer")
  }

  func testFreshPublicSourceAndFlutterColdOverview() {
    for (bundle, prefix) in [("app.djl.ios", "swift"), ("app.djl.mobile", "flutter")] {
      let app = XCUIApplication(bundleIdentifier: bundle)
      app.launchArguments = []
      app.launchEnvironment = bundle == "app.djl.ios" ? [
        "DJL_CLOUD_API_URL": "http://127.0.0.1:8859",
        "DJL_CLOUD_DEBUG_SESSION_TOKEN": "",
        "DJL_CLOUD_DEBUG_SCREEN": "",
      ] : [:]
      app.launch()
      guard tap(app.buttons["Pair with a Mac"].firstMatch) else { return }
      let status = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Connection status: Offline")).firstMatch
      XCTAssertTrue(status.waitForExistence(timeout: 10))
      XCTAssertTrue(app.buttons["Scan QR Code"].firstMatch.exists)
      XCTAssertTrue(app.buttons["Pair with Code"].firstMatch.exists)
      XCTAssertFalse(app.buttons["New chat"].firstMatch.isEnabled)
      let identity = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "No device paired yet. Not paired")).firstMatch
      XCTAssertTrue(identity.waitForExistence(timeout: 5))
      XCTAssertLessThanOrEqual(identity.frame.height, 140)
      let primary = app.buttons["Scan QR Code"].firstMatch
      let secondary = app.buttons["Pair with Code"].firstMatch
      XCTAssertEqual(primary.frame.width, 300, accuracy: 1)
      XCTAssertEqual(secondary.frame.width, 300, accuracy: 1)
      XCTAssertLessThan(identity.frame.maxY, primary.frame.minY)
      XCTAssertGreaterThanOrEqual(primary.frame.height, 44)
      XCTAssertGreaterThanOrEqual(secondary.frame.height, 44)
      print("PANEL63_\(prefix) identity=\(identity.frame) primary=\(primary.frame) secondary=\(secondary.frame)")
      checkFooter(app, prefix: prefix)
      app.terminate()
    }
  }

  func testExistingDesktopFooterAndOriginalSavedChat() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    guard tap(app.buttons["Open navigation"].firstMatch) else { return }
    let remote = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Remote")).firstMatch
    guard tap(remote) else { return }
    checkFooter(app, prefix: "cd2-paired")
    guard tap(app.buttons["Projects"].firstMatch) else { return }
    let original = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Fork of Mobile workspace QA")).firstMatch
    guard tap(original) else { return }
    let saved = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ AND value == %@", "User message", "CANCEL60")).firstMatch
    XCTAssertTrue(saved.waitForExistence(timeout: 10))
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    let composer = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Follow up")).firstMatch
    XCTAssertTrue(composer.waitForExistence(timeout: 10))
    let value = composer.value as? String ?? ""
    XCTAssertTrue(value.isEmpty || value == "Follow up")
    attach("overview62-cd2-original-chat-restored")
  }
}
