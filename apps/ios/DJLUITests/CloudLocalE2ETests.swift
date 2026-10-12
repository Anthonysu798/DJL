import XCTest

/// UI acceptance against a disposable local account. Echo/image fixtures prove integration only.
final class CloudLocalE2ETests: XCTestCase {
    private var app: XCUIApplication!

    func testLocalCloudFlow() throws {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["DJL_E2E_EMAIL"], let password = env["DJL_E2E_PASSWORD"] else {
            throw XCTSkip("Supply a disposable local account through testRunnerEnv.")
        }
        continueAfterFailure = false
        let monitor = addUIInterruptionMonitor(withDescription: "System password prompt") { alert in
            if alert.buttons["Not Now"].exists { alert.buttons["Not Now"].tap(); return true }
            return false
        }
        defer { removeUIInterruptionMonitor(monitor) }
        app = XCUIApplication()
        app.launchEnvironment["DJL_CLOUD_API_URL"] = env["DJL_E2E_API_URL"] ?? "http://localhost:8787"
        app.launchEnvironment["DJL_CLOUD_DEBUG_SCREEN"] = "sign-in"
        app.launch()
        dismissPasswordPrompt()

        XCTAssertTrue(app.buttons["Continue with email"].waitForExistence(timeout: 10) || app.textFields["Email"].exists)
        if app.buttons["Continue with email"].exists { app.buttons["Continue with email"].tap() }
        app.buttons["Password"].tap()
        app.textFields["Email"].tap(); app.textFields["Email"].typeText(email)
        app.secureTextFields["Password"].tap(); app.secureTextFields["Password"].typeText(password)
        app.buttons["Sign in"].tap()
        XCTAssertTrue(app.buttons["cloud.navigation.toggle"].waitForExistence(timeout: 20))
        dismissPasswordPrompt()
        let input = app.textFields["cloud.compose.input"]
        XCTAssertTrue(input.exists)
        input.tap()
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "composer-focus"; shot.lifetime = .keepAlways; add(shot)
        input.tap()
        input.typeText("Mobile product integration QA")
        XCTAssertGreaterThanOrEqual(app.buttons["cloud.navigation.toggle"].frame.minY, 0, "Keyboard must not push the navigation offscreen")
        app.buttons["Send"].tap()
        XCTAssertTrue(app.buttons["Read aloud"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "echo: Mobile product integration QA", "echo: Mobile product integration QA")).firstMatch.waitForExistence(timeout: 10))
        input.coordinate(withNormalizedOffset: CGVector(dx:0.2,dy:0.5)).tap(); input.typeText("Retained draft")
        openSettings()
        app.swipeUp()
        XCTAssertTrue(app.switches["Speak new replies"].waitForExistence(timeout: 10))
        openMenu(); app.buttons["Chat"].firstMatch.tap()
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        XCTAssertTrue((input.value as? String)?.contains("Retained draft") == true)
        openMenu(); app.buttons["Images"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Images"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Your images"].waitForExistence(timeout: 10))
        openMenu(); app.buttons["Notifications"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Notifications"].waitForExistence(timeout: 10))
        openSettings()
        signOut(fromSettings: true)
        XCTAssertTrue(app.buttons["Continue with email"].waitForExistence(timeout: 10) || app.textFields["Email"].exists)
    }

    private func dismissPasswordPrompt() {
        let inApp = app.buttons["Not Now"]
        if inApp.waitForExistence(timeout: 4) { inApp.tap(); return }
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if system.buttons["Not Now"].exists { system.buttons["Not Now"].tap(); return }
        // A system-owned AutoFill sheet is outside the app's accessibility tree.
        app.tap()
    }

    private func openMenu() {
        let menu = app.buttons["cloud.navigation.toggle"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10)); menu.tap()
        Thread.sleep(forTimeInterval: 0.6)
    }
    private func openSettings() {
        openMenu()
        // Tap the visible floating footer; iOS 26 glass can expose its glyph as a separate AX node.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.60, dy: 0.91)).tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
    }
    private func signOut(fromSettings: Bool = false) {
        if !fromSettings { openSettings() }
        let account = app.buttons["cloud.settings.account"]
        if !account.waitForExistence(timeout: 10), app.buttons["Continue with email"].exists { return }
        XCTAssertTrue(account.exists); account.tap()
        let button = app.buttons["Sign out"].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 10)); button.tap()
        let confirm = app.sheets.buttons["Sign out"].exists ? app.sheets.buttons["Sign out"] : app.buttons.matching(identifier: "Sign out").element(boundBy: 1)
        XCTAssertTrue(confirm.waitForExistence(timeout: 5)); confirm.tap()
    }
}
