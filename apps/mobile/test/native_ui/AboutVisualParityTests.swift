import XCTest

final class AboutVisualParityTests: XCTestCase {
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
      attach("about53-control-missing")
      return false
    }
    element.tap()
    return true
  }

  func testOrdinaryAboutGuideScrollBackAndSavedChatRestoration() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    func label(_ text: String) -> XCUIElement {
      app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", text)).firstMatch
    }
    app.activate()
    if !app.buttons["Done"].firstMatch.exists {
      guard tap(app.buttons["Open navigation"].firstMatch), tap(label("Remote")), tap(app.buttons["Settings"].firstMatch) else { return }
    }
    let guide = label("How DJL Works")
    for _ in 0..<12 {
      if guide.isHittable { break }
      app.swipeUp()
    }
    var previousFrame = CGRect.zero
    var stableSamples = 0
    let stopped = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      guard guide.exists, guide.isHittable else { return false }
      let frame = guide.frame
      stableSamples = frame == previousFrame ? stableSamples + 1 : 0
      previousFrame = frame
      return stableSamples >= 2 && frame.height >= 44 && app.frame.contains(frame)
    }, object: nil)
    guard XCTWaiter.wait(for: [stopped], timeout: 10) == .completed else {
      XCTFail("Guide row did not settle fully inside the viewport")
      attach("about53-row-not-settled")
      return
    }
    attach("about53-guide-before-tap")
    guard tap(guide) else { return }
    guard label("About DJL").waitForExistence(timeout: 5) else {
      XCTFail("The visible guide row did not open About DJL")
      attach("about53-guide-did-not-open")
      return
    }
    XCTAssertTrue(label("How It Works").waitForExistence(timeout: 5))
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("about53-guide-first-screen")
    let footer = label("MIT License")
    for _ in 0..<25 {
      if footer.isHittable { break }
      app.swipeUp()
    }
    XCTAssertTrue(footer.isHittable)
    XCTAssertTrue(app.buttons["Open source"].firstMatch.exists)
    attach("about53-guide-footer")
    guard tap(app.buttons["Back"].firstMatch), tap(app.buttons["Done"].firstMatch), tap(app.buttons["Projects"].firstMatch), tap(label("Fork of Mobile workspace QA")) else { return }
    let field = label("Follow up")
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    let value = field.value as? String ?? ""
    XCTAssertTrue(value.isEmpty || value == "Follow up")
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("about53-original-chat-restored")
  }
}
