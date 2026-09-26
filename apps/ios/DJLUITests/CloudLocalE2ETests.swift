// FILE: CloudLocalE2ETests.swift
// Purpose: End-to-end DJL Cloud flow against a real local API: email sign-in, streamed chat, stored image
//          preview, account usage, and sign-out, all driven through UI taps.
// Layer: UI Test
// Exports: CloudLocalE2ETests
// Depends on: XCTest
//
// Skipped unless the runner gets credentials, so it never runs in CI. Run against a local API with e.g.
//   TEST_RUNNER_DJL_E2E_EMAIL=... TEST_RUNNER_DJL_E2E_PASSWORD=... \
//   TEST_RUNNER_DJL_E2E_API_URL=http://localhost:8787 TEST_RUNNER_DJL_E2E_SCREENSHOT_DIR=/tmp/ios-e2e \
//   xcodebuild ... -only-testing:DJLUITests/CloudLocalE2ETests test
// The account needs credits and a chat titled "Write a short haiku about the ocean" with an image.

import XCTest

final class CloudLocalE2ETests: XCTestCase {
    private var app: XCUIApplication!
    private var screenshotDir: String?

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testCloudChatEndToEndAgainstLocalAPI() throws {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["DJL_E2E_EMAIL"], let password = env["DJL_E2E_PASSWORD"] else {
            throw XCTSkip("Set DJL_E2E_EMAIL and DJL_E2E_PASSWORD (TEST_RUNNER_ prefix) to run against a local API.")
        }
        screenshotDir = env["DJL_E2E_SCREENSHOT_DIR"]
        if let screenshotDir {
            try FileManager.default.createDirectory(atPath: screenshotDir, withIntermediateDirectories: true)
        }

        app = XCUIApplication()
        app.launchEnvironment["DJL_CLOUD_API_URL"] = env["DJL_E2E_API_URL"] ?? "http://localhost:8787"
        app.launch()

        // A previous run may have left a session in the Keychain; start from signed out.
        let home = app.navigationBars["DJL"]
        let welcome = app.staticTexts["Welcome to DJL"]
        _ = welcome.waitForExistence(timeout: 10) || home.waitForExistence(timeout: 1)
        if home.exists { signOut() }

        // 1. Welcome -> email sign-in -> cloud home.
        XCTAssertTrue(welcome.waitForExistence(timeout: 10), "Signed-out launch should show the welcome screen")
        capture("01-welcome")
        app.buttons["Continue with email"].tap()
        let emailField = app.textFields["Email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 5))
        emailField.tap()
        emailField.typeText(email)
        let passwordField = app.secureTextFields["Password"]
        passwordField.tap()
        passwordField.typeText(password)
        capture("02-email-form")
        app.buttons["Sign in"].tap()
        XCTAssertTrue(home.waitForExistence(timeout: 20), "Sign-in should land on the cloud chat home")
        let haikuRow = app.cells.containing(.staticText, identifier: "Write a short haiku about the ocean").firstMatch
        XCTAssertTrue(haikuRow.waitForExistence(timeout: 15), "Home should list the account's chats")
        capture("03-home-signed-in")
        let rowsBefore = app.cells.count

        // 2. New chat -> send -> streamed echo reply -> chat listed after going back.
        dismissSavePasswordPrompt()
        home.buttons["New chat"].tap()
        let message = "hi from ios e2e \(Int(Date().timeIntervalSince1970))"
        var composer = composerInput()
        if !composer.exists {
            home.buttons["New chat"].tap()
            composer = composerInput()
        }
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        continueAfterFailure = true
        composer.tap()
        composer.typeText(message)
        app.buttons["Send"].tap()
        let expected = "echo: \(message)"
        let streamed = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "echo: hi from ios e2e")).firstMatch
        XCTAssertTrue(streamed.waitForExistence(timeout: 30), "The streamed echo reply should appear")
        dismissSavePasswordPrompt()
        XCTAssertTrue(app.buttons["Regenerate"].waitForExistence(timeout: 15), "The run should finish")
        capture("04-chat-reply")
        // Soft check so the remaining steps still run: the streamed text must be the whole reply.
        let full = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", expected)).firstMatch
        XCTAssertTrue(full.waitForExistence(timeout: 5), "Streamed reply should read '\(expected)', saw '\(streamed.label)'")
        continueAfterFailure = false
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(home.waitForExistence(timeout: 10))
        let grew = NSPredicate { _, _ in self.app.cells.count > rowsBefore }
        wait(for: [expectation(for: grew, evaluatedWith: nil)], timeout: 15)
        capture("05-home-with-new-chat")
        // Reopen the new chat and check the reply the server persisted. The server titles it from the first
        // exchange, so match on the message.
        let newRow = app.cells.containing(NSPredicate(format: "label CONTAINS %@", message)).firstMatch
        XCTAssertTrue(newRow.waitForExistence(timeout: 10), "The new chat should be listed under its title")
        newRow.tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", expected)).firstMatch
            .waitForExistence(timeout: 15), "Reopened chat should show the full persisted reply")
        capture("05b-new-chat-reopened")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(home.waitForExistence(timeout: 10))

        // 3. Existing chat with an uploaded image -> image loads -> full-screen preview.
        haikuRow.tap()
        let image = app.buttons["Image. Double-tap to open."].firstMatch
        XCTAssertTrue(image.waitForExistence(timeout: 20), "The stored image should load from file storage")
        capture("06-chat-with-image")
        image.tap()
        let editImage = app.buttons["Edit image"]
        XCTAssertTrue(editImage.waitForExistence(timeout: 10), "Tapping the image should open the full-screen preview")
        capture("07-image-preview")
        // The preview's xmark is an icon-only button without an accessibility label; it is the first button.
        let labels = app.buttons.allElementsBoundByIndex.map { "'\($0.label)'" }.joined(separator: ", ")
        add(XCTAttachment(string: "Preview buttons: \(labels)"))
        print("E2E preview buttons: \(labels)")
        app.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(editImage.waitForNonExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(home.waitForExistence(timeout: 10))

        // 4. Account: credits and both usage windows.
        home.buttons["Account"].tap()
        let account = app.navigationBars["Account"]
        XCTAssertTrue(account.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["5-hour limit"].waitForExistence(timeout: 10), "5-hour window should show")
        XCTAssertTrue(app.staticTexts["Weekly limit"].exists, "Weekly window should show")
        XCTAssertTrue(app.staticTexts["Credits"].exists)
        let credits = app.cells.containing(.staticText, identifier: "Credits").firstMatch
        XCTAssertFalse(credits.staticTexts["—"].exists, "Credits should have loaded")
        capture("08-account")

        // 5. Sign out -> welcome.
        signOut(fromAccountSheet: true)
        XCTAssertTrue(welcome.waitForExistence(timeout: 10), "Sign-out should return to the welcome screen")
        capture("09-signed-out")
    }

    /// iOS offers to save the password after sign-in; it covers the chat, so decline it.
    private func dismissSavePasswordPrompt() {
        let notNow = app.buttons["Not Now"]
        if notNow.waitForExistence(timeout: 3) { notNow.tap() }
    }

    private func composerInput() -> XCUIElement {
        let field = app.textFields["Message DJL"]
        return field.waitForExistence(timeout: 5) ? field : app.textViews["Message DJL"]
    }

    private func signOut(fromAccountSheet: Bool = false) {
        if !fromAccountSheet {
            app.navigationBars["DJL"].buttons["Account"].tap()
        }
        let signOut = app.buttons["Sign out"].firstMatch
        XCTAssertTrue(signOut.waitForExistence(timeout: 10))
        signOut.tap()
        // The confirmation dialog repeats "Sign out" as its destructive action.
        let confirm = app.sheets.buttons["Sign out"].exists
            ? app.sheets.buttons["Sign out"]
            : app.buttons.matching(identifier: "Sign out").element(boundBy: 1)
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
    }

    private func capture(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let screenshotDir {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: screenshotDir).appendingPathComponent("\(name).png"))
        }
    }
}
