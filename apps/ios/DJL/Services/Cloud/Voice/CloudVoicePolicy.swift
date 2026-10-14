import Foundation

nonisolated enum CloudVoicePolicy {
    static func appendingTranscript(_ transcript: String, to draft: String) -> String {
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return draft }
        return draft + (draft.isEmpty || draft.last?.isWhitespace == true ? "" : " ") + text
    }
}

enum CloudVoiceFailure: LocalizedError {
    case permissionDenied, unavailable, assetsUnavailable
    var errorDescription: String? {
        switch self {
        case .permissionDenied: "Allow microphone and speech access in iPhone Settings to dictate."
        case .unavailable: "On-device dictation isn't available for this language or device. You can still type your message."
        case .assetsUnavailable: "The on-device speech model couldn't be prepared. Check your connection and try again."
        }
    }
}
