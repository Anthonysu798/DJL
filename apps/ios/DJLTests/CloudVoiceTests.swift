import XCTest
@testable import DJL

@MainActor
final class CloudVoiceTests: XCTestCase {
    func testDictationInsertsReviewedTextOnceAndCleansUp() async {
        let driver = VoiceDriverStub()
        let voice = CloudVoiceInput(driver: driver)
        await voice.start(locale: Locale(identifier: "en-CA"))
        XCTAssertEqual(voice.state, .recording)
        let transcript = await voice.stop()
        XCTAssertEqual(CloudVoicePolicy.appendingTranscript(transcript ?? "", to: "Draft"), "Draft hello")
        let second = await voice.stop()
        XCTAssertNil(second)
        XCTAssertEqual(driver.stopCount, 1)
        XCTAssertEqual(voice.state, .idle)
    }

    func testPermissionAndAssetFailuresNeverStartCapture() async {
        for failure in [CloudVoiceFailure.permissionDenied, .unavailable, .assetsUnavailable] {
            let driver = VoiceDriverStub()
            driver.failure = failure
            let voice = CloudVoiceInput(driver: driver)
            await voice.start(locale: .current)
            XCTAssertEqual(voice.state, .failed(failure.localizedDescription))
            XCTAssertEqual(driver.startCount, 0)
            voice.cancel()
            XCTAssertEqual(voice.state, .idle)
        }
    }

    func testCancelDuringPreparationCannotStartCaptureLater() async {
        let driver = VoiceDriverStub()
        driver.delayPreparation = true
        let voice = CloudVoiceInput(driver: driver)
        let pending = Task { await voice.start(locale: .current) }
        while driver.preparation == nil { await Task.yield() }
        voice.cancel()
        driver.preparation?.resume()
        await pending.value
        XCTAssertEqual(driver.startCount, 0)
        XCTAssertEqual(voice.state, .idle)
    }

    func testRepeatedLifecycleCancellationStopsCaptureOnce() async {
        let driver = VoiceDriverStub()
        let voice = CloudVoiceInput(driver: driver)
        await voice.start(locale: .current)
        voice.cancel(); voice.cancel()
        XCTAssertEqual(driver.cancelCount, 1)
        let second = await voice.stop()
        XCTAssertNil(second)
    }

    func testPlaybackReplacesPreviousReplyAndNeverReplaysHistory() {
        let driver = PlaybackDriverStub()
        let playback = CloudSpeechPlayback(driver: driver)
        playback.speak("First", messageID: "one")
        playback.speak("Second", messageID: "two")
        XCTAssertEqual(driver.spoken, ["First", "Second"])
        XCTAssertEqual(driver.stopCount, 2)
        XCTAssertEqual(playback.messageID, "two")
        playback.stop()
        XCTAssertNil(playback.messageID)
        XCTAssertFalse(playback.shouldAutomaticallySpeak(messageID: "old", runID: nil, succeeded: true))
        XCTAssertFalse(playback.shouldAutomaticallySpeak(messageID: "old", runID: "history", succeeded: true))
        playback.expectReply(runID: "fresh")
        XCTAssertTrue(playback.shouldAutomaticallySpeak(messageID: "new", runID: "fresh", succeeded: true))
        XCTAssertFalse(playback.shouldAutomaticallySpeak(messageID: "new", runID: "fresh", succeeded: true))
    }
}

@MainActor private final class VoiceDriverStub: CloudVoiceDriver {
    var failure: CloudVoiceFailure?
    var preparation: CheckedContinuation<Void, Never>?
    var delayPreparation = false
    var startCount = 0
    var stopCount = 0
    var cancelCount = 0
    func prepare(locale: Locale) async throws {
        if delayPreparation { await withCheckedContinuation { preparation = $0 } }
        if let failure { throw failure }
    }
    func start() throws { startCount += 1 }
    func stop() async throws -> String? { stopCount += 1; return "hello" }
    func cancel() { cancelCount += 1 }
}

@MainActor private final class PlaybackDriverStub: CloudSpeechDriver {
    var spoken: [String] = []
    var stopCount = 0
    func speak(_ text: String, completion: @escaping @MainActor () -> Void) { spoken.append(text) }
    func stop() { stopCount += 1 }
}
