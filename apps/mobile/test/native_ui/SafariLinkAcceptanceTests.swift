import XCTest

final class SafariLinkAcceptanceTests: XCTestCase {
  private func capture(_ app: XCUIApplication, _ name: String) {
    let image = XCTAttachment(screenshot: app.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }

  private func openLink(_ title: String) -> XCUIApplication {
    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    safari.activate()
    let link = safari.links[title].firstMatch
    guard link.waitForExistence(timeout: 8) else {
      XCTFail("Open the public loopback QA page before this journey")
      return app
    }
    link.tap()
    let open = safari.buttons["Open"].firstMatch
    let presented = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      open.exists || app.state == .runningForeground
    }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [presented], timeout: 8), .completed)
    if open.exists {
      capture(safari, "links88-open-djl-review")
      open.tap()
    }
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
    return app
  }

  func testMatchingCurrentIOS88() {
    let app = openLink("Return to current iOS QA conversation")
    let chat = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Fork of Mobile workspace QA")).firstMatch
    XCTAssertTrue(chat.waitForExistence(timeout: 10))
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    capture(app, "links88-matching-current")
  }

  func testChangedIdentityIOS88() {
    let app = openLink("Reject changed iOS desktop identity")
    let rejection = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "saved Mac identity for this link is unavailable")).firstMatch
    XCTAssertTrue(rejection.waitForExistence(timeout: 8))
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    capture(app, "links88-changed-key-rejected")
    let cancel = app.buttons["Cancel desktop link"].firstMatch
    XCTAssertTrue(cancel.exists)
    cancel.tap()
  }


  private func runtimeSummary(_ port: Int) async throws -> [String: Int] {
    let url = URL(string: "http://127.0.0.1:\(port)/qa/state")!
    let (data, _) = try await URLSession.shared.data(from: url)
    let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    var values: [String: Int] = [:]
    for key in ["requestSequence", "threadCount", "turnCount", "turnStartCount", "archiveCount", "forkCount", "renameCount", "pendingCount"] {
      values[key] = try XCTUnwrap(json[key] as? Int, "Missing QA counter \(key)")
    }
    return values
  }

  private func tapVisibleChoice(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND enabled == true"), object: element)
    guard XCTWaiter.wait(for: [ready], timeout: 8) == .completed else {
      XCTFail("The saved-Mac choice did not become enabled")
      return false
    }
    let frame = element.frame
    guard frame.width > 0, frame.height > 0,
      app.frame.contains(CGPoint(x: frame.midX, y: frame.midY))
    else { XCTFail("The saved-Mac choice is outside the visible app"); return false }
    if element.isHittable {
      element.tap()
    } else {
      // Flutter can expose a visible tap action without a UIKit hittable point.
      element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }
    return true
  }

  private func matchingChoice(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Matches this link’s verified identity")).firstMatch
  }

  @MainActor
  func testColdOriginalIOS88() async throws {
    let before = try await runtimeSummary(8886)
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.terminate()
    XCTAssertTrue(app.wait(for: .notRunning, timeout: 5))
    let opened = openLink("Open original iOS QA desktop conversation")
    let matching = matchingChoice(opened)
    XCTAssertTrue(matching.waitForExistence(timeout: 8))
    XCTAssertFalse(opened.keyboards.firstMatch.exists)
    let beforeChoice = try await runtimeSummary(8886)
    XCTAssertEqual(beforeChoice, before)
    capture(opened, "links88-cold-explicit-choice")
    let wrong = opened.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Different desktop identity")).firstMatch
    XCTAssertTrue(wrong.exists)
    guard tapVisibleChoice(wrong, in: opened) else { return }
    let rejected = opened.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Its verified identity must match")).firstMatch
    XCTAssertTrue(rejected.waitForExistence(timeout: 5))
    let afterWrongChoice = try await runtimeSummary(8886)
    XCTAssertEqual(afterWrongChoice, before)
    capture(opened, "links88-cold-wrong-choice-rejected")
    guard tapVisibleChoice(matching, in: opened) else { return }
    let chat = opened.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Mobile workspace QA")).firstMatch
    XCTAssertTrue(chat.waitForExistence(timeout: 10))
    XCTAssertFalse(opened.keyboards.firstMatch.exists)
    let after = try await runtimeSummary(8886)
    for (key, value) in before where key != "requestSequence" {
      XCTAssertEqual(after[key], value)
    }
    XCTAssertGreaterThan(after["requestSequence"]!, before["requestSequence"]!)
    capture(opened, "links88-cold-target-chat")
  }

  @MainActor
  func testReturnCurrentIOS88() async throws {
    let before = try await runtimeSummary(8896)
    let app = openLink("Return to current iOS QA conversation")
    let matching = matchingChoice(app)
    XCTAssertTrue(matching.waitForExistence(timeout: 8))
    let beforeChoice = try await runtimeSummary(8896)
    XCTAssertEqual(beforeChoice, before)
    capture(app, "links88-return-explicit-choice")
    guard tapVisibleChoice(matching, in: app) else { return }
    let chat = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Fork of Mobile workspace QA")).firstMatch
    XCTAssertTrue(chat.waitForExistence(timeout: 10))
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    let after = try await runtimeSummary(8896)
    for (key, value) in before where key != "requestSequence" {
      XCTAssertEqual(after[key], value)
    }
    XCTAssertGreaterThan(after["requestSequence"]!, before["requestSequence"]!)
    capture(app, "links88-return-current-chat")
  }

  func testOpenPublicIOS88LinkPage() throws {
    let value = try XCTUnwrap(
      Bundle(for: Self.self).object(forInfoDictionaryKey: "DJL_QA_LINK_URL") as? String,
      "Provide INFOPLIST_KEY_DJL_QA_LINK_URL for the loopback-only QA page."
    )
    let url = try XCTUnwrap(URL(string: value))
    XCTAssertEqual(url.scheme, "http")
    XCTAssertEqual(url.host, "127.0.0.1")
    XCTAssertNotNil(url.port)
    XCTAssertEqual(url.path, "/")
    guard url.scheme == "http", url.host == "127.0.0.1", url.port != nil,
      url.path == "/", url.query == nil, url.user == nil, url.fragment == nil
    else { return }

    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    safari.activate()
    safari.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.933)).tap()
    let address = safari.textFields.firstMatch
    XCTAssertTrue(address.waitForExistence(timeout: 8))
    address.tap()
    if let current = address.value as? String {
      address.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
    }
    address.typeText(value)
    XCTAssertEqual(address.value as? String, value)
    let ready = XCTAttachment(screenshot: safari.screenshot())
    ready.name = "links88-safari-public-url-ready"
    ready.lifetime = .keepAlways
    add(ready)
    address.typeText("\n")
    XCTAssertTrue(safari.links["Return to current iOS QA conversation"].waitForExistence(timeout: 10))
    XCTAssertTrue(safari.links["Open original iOS QA desktop conversation"].exists)
    XCTAssertTrue(safari.links["Reject changed iOS desktop identity"].exists)
    let page = XCTAttachment(screenshot: safari.screenshot())
    page.name = "links88-safari-public-page"
    page.lifetime = .keepAlways
    add(page)
  }
}
