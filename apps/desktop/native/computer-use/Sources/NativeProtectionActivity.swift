import Foundation

// Keyboard retirement cannot announce safety while an update resource remains held.
enum NativeProtectionActivity {
    private static let lock = NSLock()
    private static var tokens = Set<UUID>()
    static func acquire(_ id: UUID) {
        lock.withLock {
            let wasEmpty = tokens.isEmpty
            guard tokens.insert(id).inserted else { return }
            if wasEmpty { emit(["event": ["type": "input-protection", "state": "active"]]) }
        }
    }
    static func release(_ id: UUID) {
        lock.withLock {
            guard tokens.remove(id) != nil else { return }
            if tokens.isEmpty { emit(["event": ["type": "input-protection", "state": "safe"]]) }
        }
    }
}
