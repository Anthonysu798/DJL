import Foundation
import Observation

nonisolated struct MobileRemoteActivity: Codable, Equatable, Identifiable {
    nonisolated enum Kind: String, Codable { case completed, approval }
    let id: String
    let macID: String
    let threadID: String
    let title: String
    let kind: Kind
    let createdAt: Date
    var readAt: Date?
}

@MainActor
@Observable
final class MobileRemoteActivityStore {
    private(set) var all: [MobileRemoteActivity]
    @ObservationIgnored private let defaults: UserDefaults
    private let key = "djl.remote.activity"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        all = defaults.data(forKey: key).flatMap { try? JSONDecoder().decode([MobileRemoteActivity].self, from: $0) } ?? []
    }

    func entries(macID: String) -> [MobileRemoteActivity] { all.filter { $0.macID == macID } }

    func record(eventID: String, threadID: String, macID: String, title: String, kind: MobileRemoteActivity.Kind) {
        let id = "\(macID):\(eventID)"
        guard !all.contains(where: { $0.id == id }) else { return }
        all.insert(MobileRemoteActivity(id: id, macID: macID, threadID: threadID, title: title, kind: kind, createdAt: .now, readAt: nil), at: 0)
        all = Array(all.prefix(200)); save()
    }

    func markRead(_ id: String) {
        guard let index = all.firstIndex(where: { $0.id == id }) else { return }
        all[index].readAt = .now; save()
    }

    private func save() { if let data = try? JSONEncoder().encode(all) { defaults.set(data, forKey: key) } }
}
