import XCTest

final class SourceReleaseSheetReferenceTests: XCTestCase {
  private func exact(_ app: XCUIApplication, _ label: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
  }
  func testUnmodifiedPublicSourceReleaseSheet() {
    let app = XCUIApplication(bundleIdentifier: "app.djl.ios")
    app.launchArguments = []
    app.launchEnvironment = [
      "DJL_CLOUD_API_URL": "http://127.0.0.1:8859",
      "DJL_CLOUD_DEBUG_SESSION_TOKEN": "",
      "DJL_CLOUD_DEBUG_SCREEN": "",
    ]
    app.launch()
    let pair = app.buttons["Pair with a Mac"].firstMatch
    XCTAssertTrue(pair.waitForExistence(timeout: 10))
    guard pair.exists else { return }
    pair.tap()
    let title = exact(app, "What's New")
    XCTAssertTrue(title.waitForExistence(timeout: 45))
    guard title.exists else { return }
    let version = exact(app, "DJL 1.5")
    let gotIt = app.buttons["Got It"].firstMatch
    XCTAssertTrue(version.exists)
    XCTAssertTrue(gotIt.isHittable)
    print("SOURCE_RELEASE64 title=\(title.frame) version=\(version.frame) gotIt=\(gotIt.frame)")
    let grabber = app.buttons["Sheet Grabber"].firstMatch
    if grabber.exists { print("SOURCE_RELEASE64 grabber=\(grabber.frame)") }
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = "source-release64-first-header"
    image.lifetime = .keepAlways
    add(image)
    gotIt.tap()
    XCTAssertTrue(app.buttons["Pair with Code"].firstMatch.waitForExistence(timeout: 5))
  }
}
