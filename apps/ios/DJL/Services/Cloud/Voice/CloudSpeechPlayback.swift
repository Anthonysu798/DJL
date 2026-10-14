import AVFoundation
import Observation

@MainActor protocol CloudSpeechDriver: AnyObject {
    func speak(_ text: String, completion: @escaping @MainActor () -> Void)
    func stop()
}

@MainActor @Observable final class CloudSpeechPlayback {
    private(set) var messageID: String?
    @ObservationIgnored private let driver: any CloudSpeechDriver
    @ObservationIgnored private var expectedRun: String?
    init(driver: (any CloudSpeechDriver)? = nil) { self.driver = driver ?? AppleCloudSpeechDriver() }
    func speak(_ text: String, messageID: String) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        stop()
        self.messageID = messageID
        driver.speak(text) { [weak self] in
            if self?.messageID == messageID { self?.messageID = nil }
        }
    }
    func stop() { driver.stop(); messageID = nil }
    func expectReply(runID: String) { expectedRun = runID }
    func shouldAutomaticallySpeak(messageID: String, runID: String?, succeeded: Bool) -> Bool {
        guard succeeded, let runID, expectedRun == runID else { return false }
        expectedRun = nil
        return true
    }
}

@MainActor private final class AppleCloudSpeechDriver: NSObject, CloudSpeechDriver, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private var completion: (@MainActor () -> Void)?
    override init() { super.init(); synthesizer.delegate = self }
    func speak(_ text: String, completion: @escaping @MainActor () -> Void) {
        self.completion = completion
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: Locale.current.identifier)
        synthesizer.speak(utterance)
    }
    func stop() {
        completion = nil
        synthesizer.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            guard let self, !self.synthesizer.isSpeaking else { return }
            let callback = self.completion
            self.stop(); callback?()
        }
    }
}
