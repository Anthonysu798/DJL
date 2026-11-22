import XCTest

final class SettingsVisualParityTests: XCTestCase {
  func testCloudConfirm86FlutterFixture() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.questioncomposer80")
    app.launch()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    for appearance in ["light", "dark"] {
      guard tapWhenReady(app.buttons["Open Cloud Account fixture"].firstMatch) else { return }
      let signOut = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Sign out")).firstMatch
      for _ in 0..<6 { if signOut.isHittable { break }; app.swipeUp() }
      guard tapWhenReady(signOut) else { return }
      let review = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Sign out of DJL Cloud?")).firstMatch
      XCTAssertTrue(review.waitForExistence(timeout: 5))
      XCTAssertLessThan(review.frame.minY, 160)
      XCTAssertFalse(app.buttons["Cancel"].exists)
      print("CLOUDCONFIRM86_FLUTTER_TITLE \(review.frame)")
      attach("cloudconfirm86-flutter-\(appearance)")
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.65)).tap()
      let cancelled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: review)
      XCTAssertEqual(XCTWaiter.wait(for: [cancelled], timeout: 5), .completed)
      guard tapWhenReady(app.buttons["Done"].firstMatch) else { return }
      XCTAssertTrue(app.staticTexts["Memory sign-outs: 0"].waitForExistence(timeout: 5))
      guard tapWhenReady(app.buttons["Fixture theme"].firstMatch) else { return }
    }
    guard tapWhenReady(app.buttons["Open Cloud Account fixture"].firstMatch) else { return }
    let signOut = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Sign out")).firstMatch
    for _ in 0..<6 { if signOut.isHittable { break }; app.swipeUp() }
    guard tapWhenReady(signOut) else { return }
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Sign out of DJL Cloud?")).firstMatch.waitForExistence(timeout: 5))
    guard tapWhenReady(app.buttons["Sign out"].firstMatch) else { return }
    XCTAssertTrue(app.staticTexts["Memory sign-outs: 1"].waitForExistence(timeout: 5))
  }

  func testArchived85FlutterFixture() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.questioncomposer80")
    app.launch()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    guard tapWhenReady(app.buttons["Open archived fixture"].firstMatch) else { return }
    let theme = app.buttons["Theme"].firstMatch
    guard tapWhenReady(theme) else { return }
    guard tapWhenReady(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Dark")).firstMatch) else { return }
    let applied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Dark"), object: theme)
    XCTAssertEqual(XCTWaiter.wait(for: [applied], timeout: 8), .completed)
    let entry = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Archived Chats")).firstMatch
    for _ in 0..<6 { if entry.isHittable { break }; app.swipeUp() }
    guard tapWhenReady(entry) else { return }
    let newest = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Newest archived chat")).firstMatch
    let child = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Child archived chat")).firstMatch
    let earlier = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Earlier archived chat")).firstMatch
    XCTAssertTrue(newest.waitForExistence(timeout: 8))
    XCTAssertTrue(child.exists)
    XCTAssertTrue(earlier.exists)
    XCTAssertEqual(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", "ago")).count, 0)
    attach("archived85-flutter-populated-dark")
    newest.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.5)).press(forDuration: 0.1,
      thenDragTo: newest.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)))
    let unarchived = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: newest)
    XCTAssertEqual(XCTWaiter.wait(for: [unarchived], timeout: 8), .completed)
    XCTAssertFalse(child.exists)
    earlier.coordinate(withNormalizedOffset: CGVector(dx: 0.88, dy: 0.5)).press(forDuration: 0.1,
      thenDragTo: earlier.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.5)))
    let review = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Remove \"Earlier archived chat\" from this phone?")).firstMatch
    XCTAssertFalse(review.exists)
    guard tapWhenReady(app.buttons["Remove"].firstMatch) else { return }
    XCTAssertTrue(review.waitForExistence(timeout: 5))
    attach("archived85-flutter-remove-review")
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.6)).tap()
    XCTAssertTrue(earlier.exists)
    earlier.press(forDuration: 0.8)
    guard tapWhenReady(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Remove from Phone")).firstMatch) else { return }
    guard tapWhenReady(app.buttons["Remove from Phone"].firstMatch) else { return }
    XCTAssertTrue(app.staticTexts["No archived chats"].waitForExistence(timeout: 8))
    attach("archived85-flutter-empty-dark")
    guard tapWhenReady(app.buttons["Back"].firstMatch) else { return }
    for _ in 0..<6 { if theme.isHittable { break }; app.swipeDown() }
    guard tapWhenReady(theme) else { return }
    guard tapWhenReady(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "System")).firstMatch) else { return }
    let restored = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "System"), object: theme)
    XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 8), .completed)
    for _ in 0..<6 { if entry.isHittable { break }; app.swipeUp() }
    guard tapWhenReady(entry) else { return }
    XCTAssertTrue(app.staticTexts["No archived chats"].waitForExistence(timeout: 5))
    attach("archived85-flutter-empty-light")
    guard tapWhenReady(app.buttons["Back"].firstMatch) else { return }
  }
  func testOrdinaryBridge84Settings() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    for appearance in ["Dark", "System"] {
      app.terminate()
      app.launch()
      guard tapWhenReady(app.buttons["Open navigation"].firstMatch) else { return }
      let remote = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Remote")).firstMatch
      guard tapWhenReady(remote), tapWhenReady(app.buttons["Settings"].firstMatch) else { return }
      let theme = app.buttons["Theme"].firstMatch
      let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value IN %@", ["System", "Dark"]), object: theme)
      guard XCTWaiter.wait(for: [ready], timeout: 8) == .completed else { XCTFail("Expected the actual ready Theme control"); return }
      if theme.value as? String != appearance {
        guard tapWhenReady(theme) else { return }
        let choice = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", appearance)).firstMatch
        guard tapWhenReady(choice) else { return }
        let applied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", appearance), object: theme)
        guard XCTWaiter.wait(for: [applied], timeout: 8) == .completed else { XCTFail("Appearance did not settle"); return }
      }
      let bridge = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Bridge")).firstMatch
      for _ in 0..<6 { if bridge.isHittable { break }; app.swipeUp() }
      guard bridge.isHittable else { XCTFail("Expected visible Bridge card"); return }
      var previousFrame = CGRect.null
      var stationarySince = Date()
      let stationary = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
        let frame = bridge.frame
        if frame != previousFrame {
          previousFrame = frame
          stationarySince = Date()
          return false
        }
        return Date().timeIntervalSince(stationarySince) >= 0.6
      }, object: bridge)
      guard XCTWaiter.wait(for: [stationary], timeout: 10) == .completed else {
        XCTFail("The Settings scroll must settle before tapping the pinned action")
        return
      }
      attach("bridge84-ordinary-\(appearance.lowercased())")
      XCTAssertFalse(app.keyboards.firstMatch.exists)
    }
    let done = app.buttons["Done"].firstMatch
    guard done.waitForExistence(timeout: 5) else { XCTFail("Expected Settings Done"); return }
    done.tap()
    let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: done)
    XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 8), .completed)
    XCTAssertTrue(app.buttons["Open navigation"].firstMatch.waitForExistence(timeout: 8))
  }
  func testBridge84FlutterFixture() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.questioncomposer80")
    app.launch()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    guard tapWhenReady(app.buttons["Open bridge fixture"].firstMatch) else { return }
    func row(_ title: String, _ value: String) -> XCUIElement {
      app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", title, value)).firstMatch
    }
    XCTAssertTrue(row("Status", "Update available").waitForExistence(timeout: 5))
    XCTAssertTrue(row("Version", "1.9").exists)
    XCTAssertTrue(row("Latest", "1.10").exists)
    attach("bridge84-flutter-light")
    guard tapWhenReady(app.buttons["Update DJL on your Mac"].firstMatch) else { return }
    XCTAssertTrue(app.staticTexts["Update DJL on your Mac?"].waitForExistence(timeout: 5))
    attach("bridge84-flutter-confirmation")
    guard tapWhenReady(app.buttons["Cancel"].firstMatch) else { return }
    guard tapWhenReady(app.buttons["Fixture theme"].firstMatch) else { return }
    attach("bridge84-flutter-dark")
    guard tapWhenReady(app.buttons["Go offline"].firstMatch) else { return }
    XCTAssertTrue(row("Status", "Last known · Update available").waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["Update DJL on your Mac"].firstMatch.isEnabled)
    attach("bridge84-flutter-offline")
    guard tapWhenReady(app.buttons["Go online"].firstMatch) else { return }
    XCTAssertTrue(row("Status", "Update available").waitForExistence(timeout: 5))
    guard tapWhenReady(app.buttons["Fixture theme"].firstMatch) else { return }
  }
  func testFullSettings83FlutterPreview() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.qa.questioncomposer80")
    app.activate()
    defer { app.terminate(); XCUIApplication(bundleIdentifier: "app.djl.mobile").activate() }
    if app.buttons["Open settings fixture"].waitForExistence(timeout: 5) {
      guard tapWhenReady(app.buttons["Open settings fixture"]) else { return }
    }
    let theme = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Theme")).firstMatch
    XCTAssertTrue(theme.waitForExistence(timeout: 8))
    XCTAssertEqual(theme.value as? String, "System")
    XCTAssertFalse(app.staticTexts["App Lock"].exists)
    XCTAssertFalse(app.staticTexts["Security"].exists)
    for text in ["Settings", "DJL Cloud", "Appearance", "Font"] {
      let label = app.staticTexts[text].firstMatch
      if label.exists { print("SETTINGS83_FLUTTER_METRIC \(text) \(label.frame)") }
    }
    print("SETTINGS83_FLUTTER_METRIC Done \(app.buttons["Done"].firstMatch.frame)")
    attach("settings83-flutter-top-light")
    guard tapWhenReady(theme) else { return }
    let dark = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Dark")).firstMatch
    guard tapWhenReady(dark) else { return }
    let applied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Dark"), object: theme)
    XCTAssertEqual(XCTWaiter.wait(for: [applied], timeout: 8), .completed)
    attach("settings83-flutter-top-dark")
    guard tapWhenReady(theme) else { return }
    let system = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "System")).firstMatch
    guard tapWhenReady(system) else { return }
    app.swipeUp()
    app.swipeUp()
    attach("settings83-flutter-lower-light")
    let guide = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "How DJL Works")).firstMatch
    guard tapWhenReady(guide) else { return }
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "About DJL")).firstMatch.waitForExistence(timeout: 8))
    attach("settings83-flutter-guide")
    guard tapWhenReady(app.buttons["Back"].firstMatch) else { return }
  }

  private func tapWhenReady(_ element: XCUIElement) -> Bool {
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"), object: element)
    guard XCTWaiter.wait(for: [ready], timeout: 10) == .completed else {
      print("BRIDGE84_FAILED_CONTROL_TREE\n\(XCUIApplication(bundleIdentifier: "app.djl.mobile").debugDescription)")
      XCTFail("The expected control did not become hittable: \(element)")
      attach("settings52-control-not-ready")
      return false
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

  func testOrdinarySettingsSourceRowsAndRestoredAppearance() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    XCTAssertEqual(app.state, .runningForeground)
    let navigation = app.buttons["Open navigation"].firstMatch
    XCTAssertTrue(navigation.waitForExistence(timeout: 10))
    guard navigation.exists else { attach("settings52-navigation-missing"); return }
    guard tapWhenReady(navigation) else { return }
    let remote = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Remote")).firstMatch
    guard tapWhenReady(remote) else { return }
    let settings = app.buttons["Settings"].firstMatch
    XCTAssertTrue(settings.waitForExistence(timeout: 5))
    guard settings.exists else { attach("settings52-settings-missing"); return }
    guard tapWhenReady(settings) else { return }
    let theme = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Theme")).firstMatch
    XCTAssertTrue(theme.waitForExistence(timeout: 5))
    guard theme.exists else { attach("settings52-theme-missing"); return }
    XCTAssertEqual(theme.value as? String, "System")
    XCTAssertFalse(app.staticTexts["App Lock"].exists)
    XCTAssertFalse(app.staticTexts["Security"].exists)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("settings52-flutter-light")
    guard tapWhenReady(theme) else { return }
    let dark = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Dark")).firstMatch
    XCTAssertTrue(dark.waitForExistence(timeout: 5))
    guard dark.exists else { attach("settings52-dark-missing"); return }
    guard tapWhenReady(dark) else { return }
    let darkApplied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@ AND enabled == true", "Dark"), object: theme)
    XCTAssertEqual(XCTWaiter.wait(for: [darkApplied], timeout: 10), .completed)
    XCTAssertFalse(dark.exists)
    attach("settings52-flutter-dark")
    guard tapWhenReady(theme) else { return }
    let system = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "System")).firstMatch
    XCTAssertTrue(system.waitForExistence(timeout: 5))
    guard system.exists else { attach("settings52-system-missing"); return }
    guard tapWhenReady(system) else { return }
    let restored = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@ AND enabled == true", "System"), object: theme)
    XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 10), .completed)
    XCTAssertFalse(system.exists)
    attach("settings52-flutter-system-restored")
    let done = app.buttons["Done"].firstMatch
    XCTAssertTrue(done.isHittable)
    if done.isHittable { done.tap() }
    XCTAssertTrue(navigation.waitForExistence(timeout: 5))
    XCTAssertFalse(app.keyboards.firstMatch.exists)
  }

  func testRestoreOriginalSavedChatAfterSettings() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    guard tapWhenReady(app.buttons["Open navigation"].firstMatch) else { return }
    let remote = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Remote")).firstMatch
    guard tapWhenReady(remote) else { return }
    guard tapWhenReady(app.buttons["Projects"].firstMatch) else { return }
    let thread = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Fork of Mobile workspace QA")).firstMatch
    guard tapWhenReady(thread) else { return }
    let field = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Follow up")).firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    let value = field.value as? String ?? ""
    XCTAssertTrue(value.isEmpty || value == "Follow up")
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("settings52-final-original-chat")
  }
}
