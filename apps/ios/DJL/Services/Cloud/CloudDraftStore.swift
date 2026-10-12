import Foundation

nonisolated final class CloudDraftStore {
    private let defaults: UserDefaults
    private let root = "djl.cloud.drafts."

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    private func prefix(_ accountID: String) -> String {
        root + Data(accountID.utf8).base64EncodedString() + "."
    }

    func draft(accountID: String, conversationID: String) -> String {
        defaults.string(forKey: prefix(accountID) + conversationID) ?? ""
    }

    func save(_ text: String, accountID: String, conversationID: String) {
        let key = prefix(accountID) + conversationID
        if text.isEmpty { defaults.removeObject(forKey: key) }
        else { defaults.set(text, forKey: key) }
    }

    func clear(accountID: String) { remove(prefix: prefix(accountID)) }
    func clearAll() { remove(prefix: root) }

    private func remove(prefix: String) {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
            defaults.removeObject(forKey: key)
        }
    }
}
