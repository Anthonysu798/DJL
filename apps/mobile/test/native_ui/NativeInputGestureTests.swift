import XCTest

final class NativeInputGestureTests: XCTestCase {
  private func existingApp() -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    XCTAssertEqual(app.state, .runningForeground)
    return app
  }

  private func attach(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  func testClearOnlyOwnedUnsentPublicQ() {
    let app = existingApp()
    let owned = app.descendants(matching: .any).matching(NSPredicate(format: "value == %@", "q")).firstMatch
    if owned.exists {
      let keyboard = app.keyboards.firstMatch
      let delete = keyboard.descendants(matching: .any).matching(
        NSPredicate(format: "identifier == %@ OR label == %@", "delete", "delete")
      ).firstMatch
      XCTAssertTrue(delete.isHittable)
      if delete.isHittable { delete.tap() }
    }
    XCTAssertFalse(owned.exists)
    let empty = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Follow up")).firstMatch
    XCTAssertTrue(empty.exists)
    attach("native-owned-q-cleared")
  }

  func testPreparedComposerKeyboardLayoutAndPublicKeyDeletion() {
    let app = existingApp()
    let field = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Follow up")).firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    guard field.exists else { return }
    let initial = field.value as? String ?? ""
    XCTAssertTrue(initial.isEmpty || initial == "Follow up", "Only the prepared empty QA composer is accepted")
    guard initial.isEmpty || initial == "Follow up" else { return }
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
    guard keyboard.exists else { return }
    let q = keyboard.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "q")).firstMatch
    let delete = keyboard.descendants(matching: .any).matching(
      NSPredicate(format: "identifier == %@ OR label == %@", "delete", "delete")
    ).firstMatch
    XCTAssertTrue(q.isHittable)
    XCTAssertTrue(delete.isHittable)
    XCTAssertGreaterThan(keyboard.frame.height, 100)
    XCTAssertLessThanOrEqual(field.frame.maxY, keyboard.frame.minY + 4)
    attach("native-composer-keyboard-before")
    guard q.isHittable && delete.isHittable else { return }
    q.tap()
    let typedField = app.descendants(matching: .any).matching(NSPredicate(format: "value == %@", "q")).firstMatch
    let typed = typedField.exists
    delete.tap()
    let cleared = field.value as? String ?? ""
    XCTAssertTrue(typed)
    XCTAssertTrue(cleared.isEmpty || cleared == "Follow up")
    attach("native-composer-keyboard-cleared")
  }

  func testPreparedCodeKeyboardKeepsCancelReachable() {
    let app = existingApp()
    if !app.buttons["Close"].firstMatch.isHittable {
      let more = app.buttons["More actions"].firstMatch
      if !more.isHittable {
        let navigation = app.buttons["Open navigation"].firstMatch
        guard navigation.isHittable else { return XCTFail("Navigation unavailable") }
        navigation.tap()
        let remote = app.buttons["Remote"].firstMatch
        guard remote.isHittable else { return XCTFail("Remote navigation unavailable") }
        remote.tap()
      }
      attach("native-code-root-before")
      guard more.isHittable else { return XCTFail("More actions unavailable") }
      more.tap()
      let connections = app.buttons["Connections"].firstMatch
      guard connections.waitForExistence(timeout: 5) && connections.isHittable else {
        return XCTFail("Connections action unavailable")
      }
      connections.tap()
    }
    XCTAssertTrue(app.buttons["Close"].firstMatch.waitForExistence(timeout: 5))
    attach("glass-connections")
    let code = app.buttons["Pair with Code"].firstMatch
    for _ in 0..<3 where !code.isHittable { app.swipeUp() }
    guard code.isHittable else { return XCTFail("Pair with Code unavailable in Connections") }
    code.tap()
    verifyPairingKeyboard(app)
    let settings = app.buttons["Settings"].firstMatch
    guard settings.isHittable else { return XCTFail("Settings unavailable after Cancel") }
    settings.tap()
    let appearance = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label == %@", "Appearance")).firstMatch
    XCTAssertTrue(appearance.waitForExistence(timeout: 5))
    attach("glass-settings-top")
    for _ in 0..<3 {
      XCTAssertFalse(app.staticTexts["Composer Defaults"].firstMatch.exists)
      XCTAssertFalse(app.staticTexts["Bridge"].firstMatch.exists)
      app.swipeUp()
    }
    XCTAssertFalse(app.staticTexts["Bridge"].firstMatch.exists)
    attach("glass-settings-lower")
    let done = app.buttons["Done"].firstMatch
    if done.isHittable { done.tap() }
  }

  private func verifyPairingKeyboard(_ app: XCUIApplication) {
    let title = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Enter one-time code")).firstMatch
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("glass-pairing-idle")
    let codeField = app.textFields.firstMatch
    XCTAssertTrue(codeField.isHittable)
    guard codeField.isHittable else { return }
    codeField.tap()
    let keyboard = app.keyboards.firstMatch
    let cancel = app.buttons["Cancel"].firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
    XCTAssertGreaterThan(keyboard.frame.height, 100)
    XCTAssertTrue(cancel.isHittable)
    XCTAssertLessThanOrEqual(cancel.frame.maxY, keyboard.frame.minY + 4)
    attach("native-code-keyboard-cancel")
    if cancel.isHittable { cancel.tap() }
    XCTAssertFalse(title.exists)
    attach("native-code-cancelled")
  }

  func testPreparedPublicRasterAcceptsNativePinch() {
    let app = existingApp()
    let reconnect = app.buttons["Reconnect"].firstMatch
    if reconnect.exists {
      XCTAssertTrue(reconnect.isHittable)
      guard reconnect.isHittable else { return }
      reconnect.tap()
    }
    let thread = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Fork of Mobile workspace QA")).firstMatch
    XCTAssertTrue(thread.waitForExistence(timeout: 10))
    XCTAssertTrue(thread.isHittable)
    guard thread.isHittable else { return }
    thread.tap()
    let links = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "p"))
    XCTAssertTrue(links.firstMatch.waitForExistence(timeout: 10))
    XCTAssertEqual(links.count, 2)
    guard links.count == 2 else { return }
    links.element(boundBy: 1).tap()
    let image = app.images["p.png"].firstMatch
    XCTAssertTrue(image.waitForExistence(timeout: 10))
    guard image.exists else { return }
    attach("native-raster-pinch-before")
    image.pinch(withScale: 2, velocity: 1)
    attach("native-raster-pinch-after")
    XCTAssertTrue(app.buttons["Close"].firstMatch.isHittable)
    app.buttons["Close"].firstMatch.tap()
    XCTAssertTrue(links.firstMatch.waitForExistence(timeout: 5))
    attach("native-raster-closed-chat")
  }

  func testPreparedPublicSVGAcceptsNativePinch() {
    let app = existingApp()
    let close = app.buttons["Close SVG preview"].firstMatch
    if app.images["s.svg"].exists {
      XCTAssertTrue(close.isHittable)
      guard close.isHittable else { return }
      close.tap()
    }
    let links = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "s"))
    XCTAssertTrue(links.firstMatch.waitForExistence(timeout: 5))
    XCTAssertEqual(links.count, 2)
    guard links.count == 2 else { return }
    // Flutter's Link hit-test can fail after a preview return. Accept only a
    // currently observed positive native frame inside this QA app's viewport.
    guard let frame = links.allElementsBoundByIndex.map({ $0.frame }).first(where: {
      $0.width > 0 && $0.height > 0 && app.frame.contains($0)
    }) else {
      XCTFail("Prepared public SVG link has no visible native frame")
      return
    }
    attach("native-svg-visible-link-before-touch")
    app.coordinate(withNormalizedOffset: .zero)
      .withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
    let image = app.images["s.svg"].firstMatch
    XCTAssertTrue(image.waitForExistence(timeout: 10))
    guard image.exists else { return }
    attach("native-svg-pinch-before")
    image.pinch(withScale: 2, velocity: 1)
    attach("native-svg-pinch-after")
    XCTAssertTrue(close.isHittable)
    if close.isHittable { close.tap() }
    XCTAssertTrue(links.firstMatch.waitForExistence(timeout: 5))
    attach("native-svg-closed-chat")
  }

  func testRestoredEmptySavedChatAndHiddenKeyboard() {
    let app = existingApp()
    let field = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Follow up")).firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    guard field.exists else { return }
    let value = field.value as? String ?? ""
    XCTAssertTrue(value.isEmpty || value == "Follow up")
    guard value.isEmpty || value == "Follow up" else { return }
    let navigation = app.buttons["Open navigation"].firstMatch
    XCTAssertTrue(navigation.isHittable)
    guard navigation.isHittable else { return }
    navigation.tap()
    let remote = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Remote")).firstMatch
    XCTAssertTrue(remote.isHittable)
    guard remote.isHittable else { return }
    remote.tap()
    let thread = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Fork of Mobile workspace QA")).firstMatch
    XCTAssertTrue(thread.waitForExistence(timeout: 5))
    guard thread.exists else { return }
    thread.tap()
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("native-restored-empty-saved-chat")
  }
}
