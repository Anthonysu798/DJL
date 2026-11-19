import XCTest

final class AboutSourcePreviewTests: XCTestCase {
  private func attach(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }

  func testPublicSwiftAboutReferenceLightAndDark() {
    let app = XCUIApplication(bundleIdentifier: "dev.swiftui-preview-browser.host")
    func label(_ text: String) -> XCUIElement {
      app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", text)).firstMatch
    }
    app.activate()
    XCTAssertTrue(label("About DJL").waitForExistence(timeout: 10))
    XCTAssertTrue(label("How It Works").exists)
    XCTAssertTrue(label("Architecture").exists)
    let controls = app.buttons["Show preview controls"].firstMatch
    XCTAssertTrue(controls.isHittable)
    guard controls.isHittable else { return }
    controls.tap()
    let previous = app.buttons["Previous preview"].firstMatch
    if previous.exists && previous.isEnabled && previous.isHittable { previous.tap() }
    XCTAssertTrue(label("Swift About Light").waitForExistence(timeout: 5))
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)).tap()
    attach("about54-swift-source-light")
    controls.tap()
    let next = app.buttons["Next preview"].firstMatch
    XCTAssertTrue(next.waitForExistence(timeout: 5))
    guard next.isHittable else { return }
    next.tap()
    XCTAssertTrue(label("Swift About Dark").waitForExistence(timeout: 5))
    // This observed point is in the read-only architecture diagram, away from links.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)).tap()
    XCTAssertFalse(next.exists)
    XCTAssertTrue(label("How It Works").exists)
    attach("about54-swift-source-dark")
  }
}
