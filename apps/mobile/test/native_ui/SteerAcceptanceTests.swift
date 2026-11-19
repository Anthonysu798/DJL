import XCTest

final class SteerAcceptanceTests: XCTestCase {
  private func exact(_ app: XCUIApplication, _ text: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", text)).firstMatch
  }
  private func tap(_ element: XCUIElement) -> Bool {
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"), object: element)
    guard XCTWaiter.wait(for: [ready], timeout: 10) == .completed else {
      XCTFail("Expected native steering control: \(element)"); return false
    }
    element.tap(); return true
  }
  private func fixture() -> [String: Any] {
    let done = DispatchSemaphore(value: 0)
    var value: [String: Any] = [:]
    URLSession.shared.dataTask(with: URL(string: "http://127.0.0.1:8906/qa/state")!) { data, _, _ in
      if let data, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { value = object }
      done.signal()
    }.resume()
    XCTAssertEqual(done.wait(timeout: .now() + 5), .success)
    return value
  }
  private func stage(_ expected: String) -> [String: Any]? {
    let deadline = Date().addingTimeInterval(10)
    repeat {
      let state = fixture()
      if let steering = state["steering"] as? [String: Any], steering["stage"] as? String == expected { return state }
      let delay = XCTestExpectation(description: "Owned runtime stage")
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { delay.fulfill() }
      _ = XCTWaiter.wait(for: [delay], timeout: 1)
    } while Date() < deadline
    XCTFail("Owned steering runtime did not reach \(expected)"); return nil
  }
  private func attach(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }
  private func openChat(_ app: XCUIApplication) -> Bool {
    tap(app.buttons["Open navigation"].firstMatch) && tap(exact(app, "Remote")) &&
      tap(app.buttons["Projects"].firstMatch) && tap(exact(app, "Mobile workspace QA"))
  }

  func testNewApprovedPublicFixtureSteersExactlyOneHeldTurn() {
    let before = fixture()
    guard before["turnStartCount"] as? Int == 0, before["turnCount"] as? Int == 0,
      before["threadCount"] as? Int == 1, before["pendingCount"] as? Int == 0 else {
      XCTFail("This isolated steering journey has already submitted; do not resend"); return
    }
    let app = XCUIApplication(bundleIdentifier: "app.djl.mobile")
    app.activate()
    guard openChat(app) else { return }
    let field = app.textFields.matching(NSPredicate(format: "label == %@", "Follow up")).firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    let value = field.value as? String ?? ""
    guard value.isEmpty || value == "Follow up" else { XCTFail("Unexpected existing draft; preserve it"); return }
    guard tap(field) else { return }
    field.typeText("[steer] START65")
    guard tap(app.buttons["Send to desktop"].firstMatch), let held = stage("READY") else { return }
    XCTAssertEqual(held["turnStartCount"] as? Int, 1)
    XCTAssertEqual(held["turnCount"] as? Int, 1)
    XCTAssertEqual(held["pendingCount"] as? Int, 0)
    XCTAssertTrue(app.buttons["Stop turn"].firstMatch.waitForExistence(timeout: 5))
    attach("steer65-held-active-turn")
    guard tap(field) else { return }
    field.typeText("STEER65")
    guard tap(app.buttons["Send to desktop"].firstMatch), let complete = stage("COMPLETE") else { return }
    XCTAssertEqual(complete["turnStartCount"] as? Int, 1)
    XCTAssertEqual(complete["turnCount"] as? Int, 1)
    XCTAssertEqual(complete["threadCount"] as? Int, 1)
    XCTAssertEqual(complete["pendingCount"] as? Int, 0)
    XCTAssertEqual((complete["steering"] as? [String: Any])?["acceptedCount"] as? Int, 1)
    let reply = app.descendants(matching: .any).matching(NSPredicate(format: "value CONTAINS %@", "Steering native fixture complete. STEER65")).firstMatch
    XCTAssertTrue(reply.waitForExistence(timeout: 10))
    let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["Stop turn"].firstMatch)
    XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 5), .completed)
    attach("steer65-canonical-completion")
    guard openChat(app) else { return }
    XCTAssertTrue(reply.waitForExistence(timeout: 10))
    let restored = exact(app, "Follow up")
    let draft = restored.value as? String ?? ""
    XCTAssertTrue(draft.isEmpty || draft == "Follow up")
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    attach("steer65-retained-history")
    let after = fixture()
    XCTAssertEqual(after["turnStartCount"] as? Int, 1)
    XCTAssertEqual(after["turnCount"] as? Int, 1)
  }
}
