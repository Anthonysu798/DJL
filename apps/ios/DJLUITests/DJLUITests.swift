// FILE: DJLUITests.swift
// Purpose: Measures timeline scrolling and streaming append performance on deterministic fixtures.
// Layer: UI Test
// Exports: DJLUITests
// Depends on: XCTest

import XCTest

final class DJLUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testTurnTimelineScrollingPerformance() {
        let app = XCUIApplication()
        app.launchArguments += [
            "-CodexUITestsFixture",
            "-CodexUITestsMessageCount", "1200",
        ]
        app.launch()

        let timeline = app.scrollViews["turn.timeline.scrollview"]
        XCTAssertTrue(timeline.waitForExistence(timeout: 5))

        measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric]) {
            timeline.swipeUp(velocity: .fast)
            timeline.swipeUp(velocity: .fast)
            timeline.swipeDown(velocity: .fast)
            timeline.swipeDown(velocity: .fast)
        }
    }

    func testManualPairingEntryIsAvailableWithoutCamera() {
        let app = XCUIApplication()
        app.launch()

        let pairWithCode = app.buttons["connection-pair-with-code"]
        XCTAssertTrue(pairWithCode.waitForExistence(timeout: 5))

        pairWithCode.tap()
        XCTAssertTrue(app.textFields["AB23CD34EF"].waitForExistence(timeout: 2))
    }

    func testAttentionEmptyStateExplainsWhatWillAppear() {
        let app = XCUIApplication()
        app.launchArguments += ["-CodexUITestsEmptyAttentionFixture"]
        app.launch()

        openAttentionScope(in: app)

        XCTAssertTrue(app.descendants(matching: .any)["attention.empty.all-caught-up"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["You're all caught up"].exists)
    }

    func testAttentionQuestionNavigatesToExactPrompt() {
        let app = XCUIApplication()
        app.launchArguments += ["-CodexUITestsAttentionFixture"]
        app.launch()

        openAttentionScope(in: app)

        let question = app.buttons["attention.item.question:ui-question-message"]
        XCTAssertTrue(question.waitForExistence(timeout: 3))
        question.tap()

        XCTAssertTrue(app.descendants(matching: .any)["structured-user-input-card"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.staticTexts["Which release track should DJL use?"].exists)
    }

    private func openAttentionScope(in app: XCUIApplication) {
        let attentionScope = app.buttons["sidebar.scope.attention"]
        if !attentionScope.waitForExistence(timeout: 1) {
            let menu = app.buttons["Menu"]
            XCTAssertTrue(menu.waitForExistence(timeout: 3))
            menu.tap()
        }
        XCTAssertTrue(attentionScope.waitForExistence(timeout: 3))
        attentionScope.tap()
    }

    func testTurnStreamingAppendPerformance() {
        let app = XCUIApplication()
        app.launchArguments += [
            "-CodexUITestsFixture",
            "-CodexUITestsMessageCount", "500",
            "-CodexUITestsAutoStream",
        ]
        app.launch()

        XCTAssertTrue(app.scrollViews["turn.timeline.scrollview"].waitForExistence(timeout: 5))

        measure(metrics: [XCTClockMetric(), XCTCPUMetric(), XCTMemoryMetric()]) {
            // Wait window where fixture appends streaming chunks into the active timeline.
            RunLoop.current.run(until: Date().addingTimeInterval(1.6))
        }
    }
}
