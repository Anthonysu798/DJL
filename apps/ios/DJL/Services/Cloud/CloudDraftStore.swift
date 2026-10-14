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

    func pendingSend(accountID: String, conversationID: String) -> CloudSendMessageInput? {
        guard let data = defaults.data(forKey: prefix(accountID) + "send." + conversationID) else { return nil }
        return try? JSONDecoder().decode(CloudSendMessageInput.self, from: data)
    }
    func savePendingSend(_ input: CloudSendMessageInput, accountID: String, conversationID: String) {
        defaults.set(try? JSONEncoder().encode(input), forKey: prefix(accountID) + "send." + conversationID)
    }
    func clearPendingSend(accountID: String, conversationID: String) { defaults.removeObject(forKey: prefix(accountID) + "send." + conversationID) }
    func pendingImage(accountID: String, conversationID: String) -> CloudCreateImageInput? {
        guard let data = defaults.data(forKey: prefix(accountID) + "image." + conversationID) else { return nil }
        return try? JSONDecoder().decode(CloudCreateImageInput.self, from: data)
    }
    func savePendingImage(_ input: CloudCreateImageInput, accountID: String, conversationID: String) {
        defaults.set(try? JSONEncoder().encode(input), forKey: prefix(accountID) + "image." + conversationID)
    }
    func clearPendingImage(accountID: String, conversationID: String) { defaults.removeObject(forKey: prefix(accountID) + "image." + conversationID) }

    func creationID(accountID: String) -> String {
        let key = prefix(accountID) + "creation"
        if let value = defaults.string(forKey: key) { return value }
        let value = UUID().uuidString; defaults.set(value, forKey: key); return value
    }
    func clearCreationID(accountID: String) { defaults.removeObject(forKey: prefix(accountID) + "creation") }

    func clear(accountID: String) { remove(prefix: prefix(accountID)) }
    func clearAll() { remove(prefix: root) }

    private func remove(prefix: String) {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
            defaults.removeObject(forKey: key)
        }
    }
}
