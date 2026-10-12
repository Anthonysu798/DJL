import Foundation
import Observation

@MainActor
@Observable
final class CloudNotificationStore {
    private(set) var notifications: [CloudNotification] = []
    private(set) var unreadCount = 0
    private(set) var banner: CloudNotification?
    private(set) var loading = false
    var errorMessage: String?
    private(set) var nextCursor: String?
    @ObservationIgnored private weak var cloud: CloudService?
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var scope: String?
    @ObservationIgnored private var seen: Set<String> = []
    @ObservationIgnored private var initialLoad = true
    @ObservationIgnored private var activeConversation: String?
    @ObservationIgnored private var poll: Task<Void, Never>?
    @ObservationIgnored private var dismiss: Task<Void, Never>?

    init(cloud: CloudService, defaults: UserDefaults = .standard) { self.cloud = cloud; self.defaults = defaults }
    var isPolling: Bool { poll != nil }

    func setActiveConversation(_ id: String?) { activeConversation = id }
    func clearActiveConversation(_ id: String?) { if activeConversation == id { activeConversation = nil } }

    func dismissBanner() { dismiss?.cancel(); dismiss = nil; banner = nil }

    func reset() {
        setForeground(false)
        notifications = []; unreadCount = 0; nextCursor = nil; scope = nil
        loading = false
        seen = []; initialLoad = true; errorMessage = nil; activeConversation = nil
    }

    func setForeground(_ active: Bool) {
        poll?.cancel(); poll = nil
        if !active { dismissBanner(); return }
        guard cloud?.isSignedIn == true else { return }
        poll = Task { [weak self] in
            await self?.refresh()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
                await self?.refresh()
            }
        }
    }

    func refresh() async {
        guard let cloud, cloud.isSignedIn, let account = cloud.accountScopeKey else { reset(); return }
        if scope != account {
            scope = account; seen = []; initialLoad = true; notifications = []; unreadCount = 0
            dismissBanner()
        }
        guard !loading else { return }
        let revision = cloud.sessionRevision
        loading = true
        defer { if revision == cloud.sessionRevision { loading = false } }
        do {
            let page = try await cloud.client.notifications()
            guard !Task.isCancelled, cloud.isSignedIn, revision == cloud.sessionRevision, scope == account else { return }
            let fresh = page.notifications.filter { !seen.contains($0.id) && $0.readAt == nil }
            if page.notifications != notifications { notifications = page.notifications }
            unreadCount = page.unreadCount; nextCursor = page.nextCursor; errorMessage = nil
            if !initialLoad, defaults.object(forKey: "djl.notifications.inApp") as? Bool != false,
               let item = fresh.first(where: { $0.conversationId != activeConversation }) {
                banner = item
                dismiss?.cancel()
                dismiss = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(6)) } catch { return }
                    self?.banner = nil
                }
            }
            seen.formUnion(page.notifications.map(\.id))
            initialLoad = false
            let displayed = fresh.filter { $0.conversationId == activeConversation }.map(\.id)
            if !displayed.isEmpty { await markRead(displayed) }
        } catch {
            guard revision == cloud.sessionRevision else { return }
            errorMessage = error.localizedDescription
            cloud.handle(error)
        }
    }

    func loadMore() async {
        guard let cloud, let cursor = nextCursor, !loading else { return }
        let revision = cloud.sessionRevision
        loading = true; defer { if revision == cloud.sessionRevision { loading = false } }
        do {
            let page = try await cloud.client.notifications(cursor: cursor)
            guard !Task.isCancelled, cloud.isSignedIn, revision == cloud.sessionRevision else { return }
            for item in page.notifications where !notifications.contains(where: { $0.id == item.id }) { notifications.append(item) }
            seen.formUnion(page.notifications.map(\.id))
            unreadCount = page.unreadCount; nextCursor = page.nextCursor
        } catch { if revision == cloud.sessionRevision { errorMessage = error.localizedDescription } }
    }

    func markRead(_ ids: [String]) async {
        guard let cloud, cloud.isSignedIn, !ids.isEmpty else { return }
        let revision = cloud.sessionRevision
        do {
            let result = try await cloud.client.markNotificationsRead(ids: Array(ids.prefix(30)))
            guard revision == cloud.sessionRevision, cloud.isSignedIn else { return }
            let read = Set(ids.prefix(30))
            for index in notifications.indices where read.contains(notifications[index].id) {
                notifications[index].readAt = ISO8601DateFormatter().string(from: .now)
            }
            unreadCount = result.unreadCount
        } catch { if revision == cloud.sessionRevision { errorMessage = error.localizedDescription } }
    }

    func open(_ item: CloudNotification) async {
        guard let cloud, cloud.isSignedIn else { return }
        let revision = cloud.sessionRevision
        await markRead([item.id])
        guard revision == cloud.sessionRevision, cloud.isSignedIn else { return }
        dismissBanner()
        cloud.sectionPreference = .cloud
        cloud.pendingConversationID = item.conversationId
    }

    deinit { poll?.cancel(); dismiss?.cancel() }
}
