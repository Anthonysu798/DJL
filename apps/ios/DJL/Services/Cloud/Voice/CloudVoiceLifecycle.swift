import AVFoundation

@MainActor final class CloudVoiceLifecycle {
    private let center: NotificationCenter
    private var observer: NSObjectProtocol?
    init(voice: CloudVoiceInput, playback: CloudSpeechPlayback, center: NotificationCenter = .default) {
        self.center = center
        observer = center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { notification in
            let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            guard reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue || reason == AVAudioSession.RouteChangeReason.noSuitableRouteForCategory.rawValue else { return }
            Task { @MainActor [weak voice, weak playback] in voice?.cancel(); playback?.stop() }
        }
    }
    deinit { if let observer { center.removeObserver(observer) } }
}
