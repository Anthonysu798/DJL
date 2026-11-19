import XCTest

final class CloudActionsSourceReferenceTests: XCTestCase {
  func testSource89CloudActions() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.swiftclouddelete89")
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    for appearance in ["light", "dark"] {
      app.launchEnvironment = [
        "DJL_QA_SOURCE_DARK": appearance == "dark" ? "1" : "0",
        "DJL_CLOUD_API_URL": "https://source-preview.invalid",
        "DJL_CLOUD_DEBUG_SESSION_TOKEN": "",
        "DJL_CLOUD_DEBUG_SCREEN": ""
      ]
      app.launch()
      let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Owned Cloud Delete QA89")).firstMatch
      XCTAssertTrue(row.waitForExistence(timeout: 10))
      XCTAssertTrue(row.isEnabled)
      let frame = row.frame
      XCTAssertTrue(app.frame.contains(CGPoint(x: frame.midX, y: frame.midY)))
      capture(app, "cloud89-source-row-\(appearance)")
      app.coordinate(withNormalizedOffset: .zero)
        .withOffset(CGVector(dx: frame.midX, dy: frame.midY)).press(forDuration: 0.8)
      let delete = app.buttons["Delete"].firstMatch
      XCTAssertTrue(delete.waitForExistence(timeout: 5))
      capture(app, "cloud89-source-context-\(appearance)")
      delete.tap()
      let menuClosed = XCTNSPredicateExpectation(
        predicate: NSPredicate(format: "exists == false"), object: app.buttons["Pin"].firstMatch
      )
      XCTAssertEqual(XCTWaiter.wait(for: [menuClosed], timeout: 5), .completed)
      XCTAssertTrue(delete.waitForExistence(timeout: 5))
      print("CLOUD89_SOURCE_DELETE_\(appearance) \(delete.frame)")
      let titleVisible = app.staticTexts["Delete this chat?"].exists
      print("CLOUD89_SOURCE_TITLE_VISIBLE_\(appearance) \(titleVisible)")
      capture(app, "cloud89-source-confirm-\(appearance)")
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.75)).tap()
      let cancelled = XCTNSPredicateExpectation(
        predicate: NSPredicate(format: "exists == false"), object: delete
      )
      XCTAssertEqual(XCTWaiter.wait(for: [cancelled], timeout: 5), .completed)
      XCTAssertTrue(row.exists)
      app.terminate()
    }
  }

  func testFlutter89CloudActions() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.questioncomposer80")
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    for appearance in ["Light", "Dark"] {
      app.launch()
      let start = app.buttons["\(appearance) Cloud actions fixture"].firstMatch
      XCTAssertTrue(start.waitForExistence(timeout: 10))
      start.tap()
      let open = app.buttons["Open navigation"].firstMatch
      XCTAssertTrue(open.waitForExistence(timeout: 10))
      open.tap()
      let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Owned Cloud Delete QA89")).firstMatch
      XCTAssertTrue(row.waitForExistence(timeout: 5))
      row.press(forDuration: 0.8)
      let delete = app.buttons["Delete"].firstMatch
      XCTAssertTrue(delete.waitForExistence(timeout: 5))
      capture(app, "cloud89-flutter-context-\(appearance)")
      delete.tap()
      let menuClosed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["Pin"].firstMatch)
      XCTAssertEqual(XCTWaiter.wait(for: [menuClosed], timeout: 5), .completed)
      XCTAssertTrue(delete.waitForExistence(timeout: 5))
      print("CLOUD89_FLUTTER_DELETE_\(appearance) \(delete.frame)")
      capture(app, "cloud89-flutter-confirm-\(appearance)")
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.75)).tap()
      XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: delete)], timeout: 5), .completed)
      XCTAssertTrue(row.exists)
      row.press(forDuration: 0.8)
      XCTAssertTrue(delete.waitForExistence(timeout: 5))
      delete.tap()
      XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["Pin"].firstMatch)], timeout: 5), .completed)
      XCTAssertTrue(delete.waitForExistence(timeout: 5))
      delete.tap() // The preview intercepts this DELETE into volatile memory only.
      XCTAssertTrue(open.waitForExistence(timeout: 5))
      open.tap()
      XCTAssertTrue(app.staticTexts["Your conversations appear here."].firstMatch.waitForExistence(timeout: 5))
      XCTAssertFalse(row.exists)
      capture(app, "cloud89-flutter-memory-deleted-\(appearance)")
      app.terminate()
    }
  }

  func testSource90UsageReview() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.swiftusage90")
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    for appearance in ["light", "dark"] {
      app.launchEnvironment = ["DJL_QA_SOURCE_DARK": appearance == "dark" ? "1" : "0",
        "DJL_CLOUD_API_URL": "https://source-preview.invalid", "DJL_CLOUD_DEBUG_SESSION_TOKEN": ""]
      app.launch()
      let bank = app.buttons["Use a banked reset (2 left)"].firstMatch
      XCTAssertTrue(bank.waitForExistence(timeout: 10))
      capture(app, "usage90-source-banner-\(appearance)")
      bank.tap()
      let title = app.staticTexts["Use a banked reset?"].firstMatch
      let message = app.staticTexts["Both your 5-hour and weekly limits start over now, and your week restarts today."].firstMatch
      let use = app.buttons["Use reset"].firstMatch
      XCTAssertTrue(title.waitForExistence(timeout: 5))
      XCTAssertTrue(message.exists)
      XCTAssertTrue(use.exists)
      XCTAssertFalse(app.buttons["Cancel"].exists)
      print("USAGE90_SOURCE_TITLE_\(appearance) \(title.frame)")
      print("USAGE90_SOURCE_MESSAGE_\(appearance) \(message.frame)")
      print("USAGE90_SOURCE_ACTION_\(appearance) \(use.frame)")
      capture(app, "usage90-source-review-\(appearance)")
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.25)).tap()
      XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: title)], timeout: 5), .completed)
      XCTAssertTrue(bank.exists)
      app.terminate()
    }
  }

  func testFlutter90UsageReviewAndRecovery() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.questioncomposer80")
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    for (choice, attempts, reply) in [("Light pending send fixture", 2, "Recovered once"), ("Dark blocked run fixture", 0, "Resumed original run")] {
      app.launch()
      let start = app.buttons[choice].firstMatch
      XCTAssertTrue(start.waitForExistence(timeout: 10))
      start.tap()
      let bank = app.buttons["Use a banked reset (2 left)"].firstMatch
      XCTAssertTrue(bank.waitForExistence(timeout: 10))
      capture(app, "usage90-flutter-banner-\(choice)")
      bank.tap()
      let title = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Use a banked reset?")).firstMatch
      let message = app.staticTexts["Both your 5-hour and weekly limits start over now, and your week restarts today."].firstMatch
      let use = app.buttons["Use reset"].firstMatch
      XCTAssertTrue(title.waitForExistence(timeout: 5))
      XCTAssertTrue(message.exists)
      XCTAssertTrue(use.exists)
      print("USAGE90_FLUTTER_TITLE_\(choice) \(title.frame)")
      print("USAGE90_FLUTTER_MESSAGE_\(choice) \(message.frame)")
      print("USAGE90_FLUTTER_ACTION_\(choice) \(use.frame)")
      capture(app, "usage90-flutter-review-\(choice)")
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.25)).tap()
      XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: title)], timeout: 5), .completed)
      XCTAssertTrue(bank.exists)
      bank.tap()
      XCTAssertTrue(title.waitForExistence(timeout: 5))
      use.tap() // This fixture intercepts every request into volatile memory.
      let receipt = app.staticTexts["Memory resets: 1; message attempts: \(attempts)"].firstMatch
      XCTAssertTrue(receipt.waitForExistence(timeout: 10))
      XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", reply, reply)).firstMatch.waitForExistence(timeout: 5))
      XCTAssertFalse(bank.exists)
      capture(app, "usage90-flutter-recovered-\(choice)")
      app.terminate()
    }
  }

  private func capture(_ app: XCUIApplication, _ name: String) {
    let image = XCTAttachment(screenshot: app.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }
}
