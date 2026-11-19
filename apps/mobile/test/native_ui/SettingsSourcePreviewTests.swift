import XCTest

final class SettingsSourcePreviewTests: XCTestCase {
  func testCloudConfirm86SourceReference() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.swiftcloudconfirm86")
    app.launchEnvironment = ["DJL_CLOUD_API_URL": "http://127.0.0.1:8859", "DJL_CLOUD_DEBUG_SESSION_TOKEN": ""]
    app.launch()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 10))
    let signOut = app.buttons["Sign out"].firstMatch
    XCTAssertTrue(signOut.waitForExistence(timeout: 5))
    for appearance in ["light", "dark"] {
      signOut.tap()
      let review = app.staticTexts["Sign out of DJL Cloud?"].firstMatch
      XCTAssertTrue(review.waitForExistence(timeout: 5))
      print("CLOUDCONFIRM86_SOURCE_TITLE \(review.frame)")
      attach("cloudconfirm86-source-\(appearance)")
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.75)).tap()
      let cancelled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: review)
      XCTAssertEqual(XCTWaiter.wait(for: [cancelled], timeout: 5), .completed)
      XCTAssertTrue(app.buttons["My Macs"].exists)
      app.buttons["Reference theme"].firstMatch.tap()
    }
  }

  func testArchived85PopulatedSourceReference() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.swiftarchived85")
    app.launchEnvironment = ["DJL_CLOUD_API_URL": "http://127.0.0.1:8859", "DJL_CLOUD_DEBUG_SESSION_TOKEN": ""]
    app.launch()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
    let entry = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Archived Chats")).firstMatch
    for _ in 0..<7 { if entry.isHittable { break }; app.swipeUp() }
    XCTAssertTrue(entry.isHittable)
    attach("archived85-source-populated-entry")
    entry.tap()
    let newest = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Newest archived chat")).firstMatch
    XCTAssertTrue(newest.waitForExistence(timeout: 8))
    print("ARCHIVED85_SOURCE_NEWEST \(newest.frame)")
    attach("archived85-source-populated-light")
    let theme = app.buttons["Reference theme"].firstMatch
    theme.tap()
    let settled = XCTestExpectation(description: "Source populated archive dark appearance")
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { settled.fulfill() }
    wait(for: [settled], timeout: 2)
    attach("archived85-source-populated-dark")
    let earlier = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Earlier archived chat")).firstMatch
    earlier.press(forDuration: 0.8)
    let remove = app.buttons["Remove from Phone"].firstMatch
    XCTAssertTrue(remove.waitForExistence(timeout: 5))
    attach("archived85-source-context-menu")
    remove.tap()
    let review = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Remove \"Earlier archived chat\" from this phone?")).firstMatch
    XCTAssertTrue(review.waitForExistence(timeout: 8))
    attach("archived85-source-remove-review")
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.65)).tap()
    let cancelled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: review)
    XCTAssertEqual(XCTWaiter.wait(for: [cancelled], timeout: 8), .completed)
    XCTAssertTrue(earlier.exists)
    theme.tap()
  }
  func testArchived85SourceReference() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.swiftsettings83")
    app.launchEnvironment = ["DJL_CLOUD_API_URL": "http://127.0.0.1:8859", "DJL_CLOUD_DEBUG_SESSION_TOKEN": ""]
    app.launch()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
    let entry = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Archived Chats")).firstMatch
    for _ in 0..<7 { if entry.isHittable { break }; app.swipeUp() }
    XCTAssertTrue(entry.isHittable)
    attach("archived85-source-entry")
    entry.tap()
    XCTAssertTrue(app.staticTexts["No archived chats"].waitForExistence(timeout: 8))
    attach("archived85-source-empty-light")
    let theme = app.buttons["Reference theme"].firstMatch
    XCTAssertTrue(theme.exists)
    theme.tap()
    let settled = XCTestExpectation(description: "Source archived dark appearance")
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { settled.fulfill() }
    wait(for: [settled], timeout: 2)
    attach("archived85-source-empty-dark")
    theme.tap()
    let back = app.buttons["Settings"].firstMatch
    XCTAssertTrue(back.exists)
    back.tap()
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
  }
  func testBridge84SourceReference() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.swiftsettings83")
    app.launchEnvironment = ["DJL_CLOUD_API_URL": "http://127.0.0.1:8859", "DJL_CLOUD_DEBUG_SESSION_TOKEN": ""]
    app.launch()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
    let bridge = app.staticTexts["Bridge"].firstMatch
    for _ in 0..<6 { if bridge.isHittable { break }; app.swipeUp() }
    XCTAssertTrue(bridge.isHittable)
    attach("bridge84-source-light")
    let theme = app.buttons["Reference theme"].firstMatch
    XCTAssertTrue(theme.waitForExistence(timeout: 5))
    theme.tap()
    let settled = XCTestExpectation(description: "Source Bridge dark appearance")
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { settled.fulfill() }
    wait(for: [settled], timeout: 2)
    attach("bridge84-source-dark")
    theme.tap()
  }
  func testFullSettings83SourceReference() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.swiftsettings83")
    app.launchEnvironment = ["DJL_CLOUD_API_URL": "http://127.0.0.1:8859", "DJL_CLOUD_DEBUG_SESSION_TOKEN": ""]
    app.launch()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    let title = app.navigationBars["Settings"].firstMatch
    XCTAssertTrue(title.waitForExistence(timeout: 10))
    guard title.exists else { return }
    for text in ["Settings", "DJL Cloud", "Appearance", "Font"] {
      let label = app.staticTexts[text].firstMatch
      if label.exists { print("SETTINGS83_SOURCE_METRIC \(text) \(label.frame)") }
    }
    print("SETTINGS83_SOURCE_METRIC Done \(app.buttons["Done"].firstMatch.frame)")
    attach("settings83-source-top-light")
    let theme = app.buttons["Reference theme"].firstMatch
    XCTAssertTrue(theme.waitForExistence(timeout: 5))
    theme.tap()
    let settled = XCTestExpectation(description: "Source appearance transition")
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { settled.fulfill() }
    wait(for: [settled], timeout: 2)
    attach("settings83-source-top-dark")
    theme.tap()
    app.swipeUp()
    app.swipeUp()
    attach("settings83-source-lower-light")
    let guide = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "How DJL Works")).firstMatch
    XCTAssertTrue(guide.waitForExistence(timeout: 5))
    guide.tap()
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "About DJL")).firstMatch.waitForExistence(timeout: 8))
    attach("settings83-source-guide")
    let back = app.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "Settings", "Back")).firstMatch
    XCTAssertTrue(back.waitForExistence(timeout: 5))
    back.tap()
  }

  private func attach(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }

  func testOriginalSettingsPrimitivesLightAndDark() {
    let app = XCUIApplication(bundleIdentifier: "dev.swiftui-preview-browser.host")
    app.activate()
    XCTAssertEqual(app.state, .runningForeground)
    let header = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Composer Defaults")).firstMatch
    XCTAssertTrue(header.waitForExistence(timeout: 10))
    guard header.exists else { return }
    let sourceRow = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Bridge Version")).firstMatch
    XCTAssertTrue(sourceRow.exists)
    attach("settings52-original-source-light")
    let controls = app.buttons["Show preview controls"].firstMatch
    XCTAssertTrue(controls.isHittable)
    guard controls.isHittable else { return }
    controls.tap()
    let next = app.buttons["Next preview"].firstMatch
    XCTAssertTrue(next.waitForExistence(timeout: 5))
    XCTAssertTrue(next.isHittable)
    guard next.isHittable else { return }
    next.tap()
    let dark = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Swift Settings rows Dark")).firstMatch
    XCTAssertTrue(dark.waitForExistence(timeout: 5))
    guard dark.exists else { return }
    attach("settings52-original-source-dark-selected")
    // The observed source fixture leaves the bottom of its List empty.
    let bounds = app.frame
    XCTAssertGreaterThan(bounds.width, 300)
    XCTAssertGreaterThan(bounds.height, 700)
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)).tap()
    XCTAssertFalse(next.exists)
    XCTAssertTrue(header.exists)
    attach("settings52-original-source-dark")
  }
}
