import XCTest

final class WhatsNewAcceptanceTests: XCTestCase {
  private func exact(_ app: XCUIApplication, _ label: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  private func tap(_ element: XCUIElement) -> Bool {
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"), object: element)
    guard XCTWaiter.wait(for: [ready], timeout: 10) == .completed else {
      XCTFail("Expected native control: \(element)")
      attach("whatsnew64-missing-control"); return false
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

  private func openMyMacs(_ app: XCUIApplication) -> Bool {
    app.launchArguments = []
    app.launchEnvironment = [:]
    app.launch()
    let pair = app.buttons["Pair with a Mac"].firstMatch
    if pair.waitForExistence(timeout: 2), !tap(pair) { return false }
    let navigation = app.buttons["Open navigation"].firstMatch
    guard navigation.waitForExistence(timeout: 10), tap(navigation) else { return false }
    guard tap(exact(app, "Remote")) else { return false }
    return app.buttons["Settings"].firstMatch.waitForExistence(timeout: 10)
  }

  private func theme(_ value: String, from original: String, app: XCUIApplication) -> Bool {
    guard tap(app.buttons["Settings"].firstMatch) else { return false }
    let choice = exact(app, "Theme")
    XCTAssertTrue(choice.waitForExistence(timeout: 5))
    XCTAssertEqual(choice.value as? String, original)
    guard tap(choice), tap(exact(app, value)) else { return false }
    let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@ AND enabled == true", value), object: choice)
    guard XCTWaiter.wait(for: [changed], timeout: 10) == .completed else {
      XCTFail("Appearance did not become \(value)"); return false
    }
    guard tap(app.buttons["Done"].firstMatch) else { return false }
    return app.buttons["Open navigation"].firstMatch.waitForExistence(timeout: 5)
  }

  private func restoreOriginalChat(_ app: XCUIApplication) {
    guard tap(app.buttons["Projects"].firstMatch) else { return }
    guard tap(exact(app, "Fork of Mobile workspace QA")) else { return }
    let field = exact(app, "Follow up")
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    let value = field.value as? String ?? ""
    XCTAssertTrue(value.isEmpty || value == "Follow up")
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("whatsnew64-original-chat-restored")
  }

  private func firstNotice(dark: Bool) {
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    guard openMyMacs(app) else { XCTFail("My Macs did not open"); return }
    var restoreSystem = false
    defer {
      if restoreSystem {
        let gotIt = app.buttons["Got It"].firstMatch
        if gotIt.exists && gotIt.isHittable { gotIt.tap() }
        if app.buttons["Settings"].firstMatch.exists {
          _ = theme("System", from: "Dark", app: app)
        }
      }
    }
    if dark {
      guard theme("Dark", from: "System", app: app) else { return }
      restoreSystem = true
    }
    let field = app.textFields.firstMatch
    guard tap(field) else { return }
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    field.typeText("\n")
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    let title = exact(app, "What's New")
    let tooEarly = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true"), object: title)
    tooEarly.isInverted = true
    let start = Date()
    XCTAssertEqual(XCTWaiter.wait(for: [tooEarly], timeout: 10), .completed)
    XCTAssertTrue(title.waitForExistence(timeout: 35))
    let elapsed = Date().timeIntervalSince(start)
    XCTAssertGreaterThanOrEqual(elapsed, 27)
    print("WHATSNEW64_FIRST dark=\(dark) elapsed=\(elapsed)")
    guard title.exists else { attach("whatsnew64-not-presented"); return }
    XCTAssertTrue(exact(app, "DJL 0.1.0").exists)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    let gotIt = app.buttons["Got It"].firstMatch
    XCTAssertTrue(gotIt.isHittable)
    let rendered = XCTestExpectation(description: "Release sheet animation settles")
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { rendered.fulfill() }
    XCTAssertEqual(XCTWaiter.wait(for: [rendered], timeout: 3), .completed)
    XCTAssertEqual(title.frame.minY, 86, accuracy: 2)
    print("WHATSNEW64_LAYOUT title=\(title.frame) gotIt=\(gotIt.frame)")
    attach(dark ? "whatsnew64-ordinary-dark" : "whatsnew64-public-light")
    guard tap(gotIt) else { return }
    let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: title)
    XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 5), .completed)
    if dark {
      guard theme("System", from: "Dark", app: app) else { return }
      restoreSystem = false
      restoreOriginalChat(app)
    } else {
      XCTAssertTrue(app.buttons["Pair with Code"].firstMatch.exists)
      attach("whatsnew64-public-dismissed")
    }
  }

  private func coldAbsence(paired: Bool) {
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    guard openMyMacs(app) else { XCTFail("My Macs did not reopen"); return }
    let title = exact(app, "What's New")
    let repeated = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true"), object: title)
    repeated.isInverted = true
    XCTAssertEqual(XCTWaiter.wait(for: [repeated], timeout: 32), .completed)
    XCTAssertFalse(title.exists)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("whatsnew64-cold-no-repeat")
    if paired { restoreOriginalChat(app) }
  }

  func testPublicFirstQuietNotice() { firstNotice(dark: false) }
  func testPublicColdVersionDoesNotRepeat() { coldAbsence(paired: false) }
  func testOrdinaryDarkFirstQuietNotice() { firstNotice(dark: true) }
  func testOrdinaryColdVersionDoesNotRepeat() { coldAbsence(paired: true) }
}
