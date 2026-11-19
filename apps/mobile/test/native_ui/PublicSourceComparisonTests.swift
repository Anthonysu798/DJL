import XCTest

final class PublicSourceComparisonTests: XCTestCase {
  private func publicApp(_ bundle: String) -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: bundle)
    app.launchArguments = []
    if bundle == "app.djl.ios" {
      app.launchEnvironment = [
        "DJL_CLOUD_API_URL": "http://127.0.0.1:8859",
        "DJL_CLOUD_DEBUG_SESSION_TOKEN": "",
        "DJL_CLOUD_DEBUG_SCREEN": "",
      ]
    }
    return app
  }

  private func attach(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }

  private func tap(_ element: XCUIElement) -> Bool {
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"), object: element)
    guard XCTWaiter.wait(for: [ready], timeout: 10) == .completed else {
      XCTFail("Expected public native control: \(element)")
      attach("public61-control-missing"); return false
    }
    element.tap()
    return true
  }

  func testWelcomeEmailKeyboardAndBackWithoutAuthentication() {
    for (bundle, prefix) in [("app.djl.ios", "swift"), ("app.djl.mobile", "flutter")] {
      let app = publicApp(bundle)
      app.activate()
      let title = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Welcome to DJL")).firstMatch
      XCTAssertTrue(title.waitForExistence(timeout: 10))
      XCTAssertFalse(app.staticTexts["DJL is locked"].exists)
      let email = app.buttons["Continue with email"].firstMatch
      let pair = app.buttons["Pair with a Mac"].firstMatch
      XCTAssertTrue(email.exists)
      XCTAssertTrue(pair.exists)
      print("PUBLIC61_\(prefix)_WELCOME title=\(title.frame) email=\(email.frame) pair=\(pair.frame)")
      attach("public61-\(prefix)-welcome")
      guard tap(email) else { return }
      let field = app.textFields.firstMatch
      XCTAssertTrue(field.waitForExistence(timeout: 10))
      guard field.exists else { attach("public61-email-missing"); return }
      let keyboard = app.keyboards.firstMatch
      XCTAssertTrue(keyboard.waitForExistence(timeout: 10))
      let submit = app.buttons["Email me a code"].firstMatch
      XCTAssertTrue(submit.exists)
      XCTAssertFalse(submit.isEnabled)
      print("PUBLIC61_\(prefix)_EMAIL field=\(field.frame) keyboard=\(keyboard.frame) submit=\(submit.frame)")
      attach("public61-\(prefix)-email-keyboard")
      guard tap(app.buttons["Back"].firstMatch) else { return }
      XCTAssertTrue(title.waitForExistence(timeout: 5))
      XCTAssertFalse(keyboard.exists)
      attach("public61-\(prefix)-welcome-return")
    }
  }

  func testEmptyEmailReturnBehaviorWithoutSubmitting() {
    for (bundle, prefix) in [("app.djl.ios", "swift"), ("app.djl.mobile", "flutter")] {
      let app = publicApp(bundle)
      app.activate()
      guard tap(app.buttons["Continue with email"].firstMatch) else { return }
      let field = app.textFields.firstMatch
      XCTAssertTrue(field.waitForExistence(timeout: 10))
      XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
      field.typeText("\n")
      print("PUBLIC61_\(prefix)_RETURN keyboard=\(app.keyboards.firstMatch.exists) value=\(field.value ?? "")")
      XCTAssertFalse(app.buttons["Email me a code"].firstMatch.isEnabled)
      attach("public61-\(prefix)-empty-return")
      guard tap(app.buttons["Back"].firstMatch) else { return }
    }
  }
}
