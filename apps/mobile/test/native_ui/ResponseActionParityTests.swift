import XCTest

final class ResponseActionParityTests: XCTestCase {
  private func attach(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  func testOrdinarySavedPairedReplyHasCompactCopyOnlyFooter() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    XCTAssertEqual(app.state, .runningForeground)
    let navigation = app.buttons["Open navigation"].firstMatch
    XCTAssertTrue(navigation.waitForExistence(timeout: 5))
    guard navigation.exists else { attach("response48-missing-navigation"); return }
    navigation.tap()
    let remote = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Remote")).firstMatch
    XCTAssertTrue(remote.waitForExistence(timeout: 5))
    guard remote.exists else { return }
    remote.tap()
    let projects = app.buttons["Projects"].firstMatch
    XCTAssertTrue(projects.waitForExistence(timeout: 5))
    guard projects.exists else { return }
    projects.tap()
    let thread = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Fork of Mobile workspace QA")).firstMatch
    XCTAssertTrue(thread.waitForExistence(timeout: 10))
    guard thread.exists else { attach("response48-missing-saved-thread"); return }
    thread.tap()
    let body = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Saved native conversation history.")).firstMatch
    XCTAssertTrue(body.waitForExistence(timeout: 10))
    guard body.exists else { return }
    let bounds = body.frame
    XCTAssertGreaterThan(bounds.width, 0)
    XCTAssertTrue(app.frame.contains(bounds))
    XCTAssertFalse(app.buttons["Read aloud"].exists)
    XCTAssertFalse(app.buttons["Stop reading"].exists)
    let copies = app.buttons.matching(NSPredicate(format: "label == %@", "Copy response"))
    guard let copy = copies.allElementsBoundByIndex.first(where: {
      let frame = $0.frame
      return frame.width >= 44 && frame.height >= 44 && frame.minY >= bounds.maxY && app.frame.contains(frame)
    }) else {
      XCTFail("The saved public reply needs its own visible Copy target")
      attach("response48-missing-copy")
      return
    }
    XCTAssertLessThanOrEqual(copy.frame.minY - bounds.maxY, 12)
    XCTAssertTrue(copy.isHittable)
    attach("response48-native-copy-spacing")
    if copy.isHittable { copy.tap() }
    attach("response48-native-copy-feedback")
    let field = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Follow up")).firstMatch
    XCTAssertTrue(field.exists)
    let value = field.value as? String ?? ""
    XCTAssertTrue(value.isEmpty || value == "Follow up")
    XCTAssertFalse(app.keyboards.firstMatch.exists)
  }
}
