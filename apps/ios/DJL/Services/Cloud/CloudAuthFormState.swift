import Foundation

nonisolated enum CloudAuthFormState {
    static func isValidCode(_ value: String) -> Bool {
        value.utf8.count == 6 && value.utf8.allSatisfy { (48...57).contains($0) }
    }

    static func isValidPassword(_ value: String) -> Bool {
        (10...256).contains(value.utf16.count)
    }

    static func canResend(sentAt: Date, now: Date) -> Bool {
        now.timeIntervalSince(sentAt) >= 60
    }

    static func resendSeconds(sentAt: Date, now: Date) -> Int {
        max(0, Int(ceil(60 - now.timeIntervalSince(sentAt))))
    }
}
