// FILE: CloudService.swift
// Purpose: App-wide DJL Cloud state: session, account, usage, models, the conversation list, and images.
// Layer: Service
// Exports: CloudService
// Depends on: CloudAPIClient, CloudAuthAPI, CloudSessionStore, CloudModels, UIKit
//
// Deliberately separate from CodexService (desktop pairing). Per-conversation chat state lives in CloudChatSession.

import Foundation
import Observation
import UIKit
import UserNotifications

@MainActor
@Observable
final class CloudService {
    let client: CloudAPIClient
    let authAPI: CloudAuthAPI
    let navigation = CloudNavigationState()
    let drafts: CloudDraftStore
    let remoteActivity = MobileRemoteActivityStore()
    @ObservationIgnored private var notificationStorage: CloudNotificationStore?
    @ObservationIgnored private let sessionStore: CloudSessionStoring

    private(set) var isSignedIn: Bool
    private(set) var sessionRevision: UInt64 = 0
    private(set) var clientConfig: CloudClientConfig?
    var sectionPreference: CloudSectionPreference = .automatic

    private(set) var me: CloudMe?
    private(set) var credits: CloudCredits?
    private(set) var usage: CloudUsageWindows?
    private(set) var models: [CloudModel] = []
    private(set) var conversations: [CloudConversation] = []
    private(set) var isLoadingConversations = false
    private(set) var nextConversationCursor: String?
    var lastError: String?
    /// Set by a `djl://cloud/c/<id>` link or a task-completion push; the home view opens it.
    var pendingConversationID: String?

    var selectedModelID: String? {
        didSet { UserDefaults.standard.set(selectedModelID, forKey: Self.selectedModelKey) }
    }

    @ObservationIgnored private let imageCache = CloudImageCache()
    @ObservationIgnored private var imageDownloads = 0
    @ObservationIgnored private var galleryStore: CloudImageGallery?
    var gallery: CloudImageGallery {
        if let galleryStore { return galleryStore }
        let store = CloudImageGallery(cloud: self); galleryStore = store; return store
    }
    @ObservationIgnored private var pushToken: String?
    @ObservationIgnored private var pushObserver: NSObjectProtocol?
    @ObservationIgnored private var openObserver: NSObjectProtocol?
    private static let selectedModelKey = "djl.cloud.selectedModelID"

    init(
        configuration: CloudAPIConfiguration = .resolved(),
        sessionStore: CloudSessionStoring = CloudKeychainSessionStore(),
        urlSession: URLSession = .djlCloud,
        tokenProvider: CloudAccessTokenProviding? = nil,
        draftStore: CloudDraftStore = CloudDraftStore()
    ) {
        self.sessionStore = sessionStore
        drafts = draftStore
        let provider = tokenProvider ?? CloudJWTAccessTokenProvider(
            configuration: configuration,
            sessionStore: sessionStore,
            urlSession: urlSession
        )
        client = CloudAPIClient(configuration: configuration, tokenProvider: provider, urlSession: urlSession)
        authAPI = CloudAuthAPI(configuration: configuration, urlSession: urlSession)
        isSignedIn = sessionStore.readSessionToken() != nil
        selectedModelID = UserDefaults.standard.string(forKey: Self.selectedModelKey)
        #if DEBUG
        CloudDebugLaunch.seedSessionIfRequested(sessionStore: sessionStore)
        isSignedIn = sessionStore.readSessionToken() != nil
        pendingConversationID = CloudDebugLaunch.argument(for: "conversation") ?? CloudDebugLaunch.argument(for: "image")
        #endif
        observePushToken()
        observeConversationOpens()
    }

    func route(hasPairedMac: Bool) -> CloudRootRoute {
        CloudRootRoute.resolve(isSignedIn: isSignedIn, preference: sectionPreference, hasPairedMac: hasPairedMac)
    }

    var selectedModel: CloudModel? {
        models.first { $0.id == selectedModelID } ?? models.first(where: \.isSelectable)
    }

    var accountScopeKey: String? {
        guard let me else { return nil }
        return "\(me.user.id):\(me.activeOrgId)"
    }

    var notifications: CloudNotificationStore {
        if let notificationStorage { return notificationStorage }
        let store = CloudNotificationStore(cloud: self)
        notificationStorage = store
        return store
    }

    func refreshClientConfig() async {
        do { clientConfig = try await client.clientConfig() }
        catch { /* Email sign-in remains available while configuration is unreachable. */ }
    }

    // MARK: Session

    func completeSignIn(sessionToken: String) async {
        await client.tokenProvider.invalidate()
        guard !Task.isCancelled else { return }
        sessionRevision &+= 1
        clearAccountData()
        lastError = nil
        sessionStore.writeSessionToken(sessionToken)
        isSignedIn = true
        sectionPreference = .cloud
        await refreshAll()
        registerPushTokenIfPossible()
    }

    func signOut() async {
        let token = sessionStore.readSessionToken()
        clearLocalSession()
        if let token {
            await authAPI.signOut(sessionToken: token)
        }
    }

    func deleteAccount() async throws {
        try await client.deleteAccount()
        clearLocalSession()
    }

    private func clearLocalSession() {
        sessionRevision &+= 1
        sessionStore.writeSessionToken(nil)
        isSignedIn = false
        clearAccountData()
        let revision = sessionRevision
        Task {
            guard revision == self.sessionRevision, !self.isSignedIn else { return }
            await client.tokenProvider.invalidate()
        }
    }

    private func clearAccountData() {
        notificationStorage?.reset()
        drafts.clearAll()
        navigation.newChat()
        me = nil
        credits = nil
        usage = nil
        conversations = []
        nextConversationCursor = nil
        models = []
        selectedModelID = nil
        pendingConversationID = nil
        isLoadingConversations = false
        imageCache.clear()
        galleryStore?.reset()
    }

    /// Every call site funnels errors here so an ended session always returns to the welcome screen.
    func handle(_ error: Error) {
        if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled { return }
        if let apiError = error as? CloudAPIError, apiError == .unauthorized {
            clearLocalSession()
            lastError = apiError.errorDescription
            return
        }
        lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }

    // MARK: Loading

    func refreshAll() async {
        guard isSignedIn else { return }
        let revision = sessionRevision
        async let meResult = client.me()
        async let modelsResult = client.models()
        async let listResult = client.conversations()
        do {
            let account = try await meResult
            let catalog = try await modelsResult
            let history = try await listResult
            guard revision == sessionRevision, isSignedIn else { return }
            me = account
            models = catalog
            conversations = history.conversations
            nextConversationCursor = history.nextCursor
            if !catalog.contains(where: { $0.id == selectedModelID && $0.isSelectable }) {
                selectedModelID = catalog.first(where: \.isSelectable)?.id
            }
        } catch {
            guard revision == sessionRevision else { return }
            handle(error)
        }
        await refreshUsage()
        await refreshClientConfig()
    }

    func refreshUsage() async {
        guard isSignedIn else { return }
        let revision = sessionRevision
        do {
            async let creditsResult = client.credits()
            async let usageResult = client.usageWindows()
            let balances = try await creditsResult
            let windows = try await usageResult
            guard revision == sessionRevision, isSignedIn else { return }
            credits = balances
            usage = windows
        } catch {
            guard revision == sessionRevision else { return }
            handle(error)
        }
    }

    func refreshConversations() async {
        guard isSignedIn else { return }
        let revision = sessionRevision
        isLoadingConversations = true
        defer { if revision == sessionRevision { isLoadingConversations = false } }
        do {
            let list = try await client.conversations()
            guard revision == sessionRevision, isSignedIn else { return }
            conversations = list.conversations
            nextConversationCursor = list.nextCursor
        } catch {
            guard revision == sessionRevision else { return }
            handle(error)
        }
    }

    func search(_ text: String) async -> [CloudConversationSearchHit] {
        let revision = sessionRevision
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        do {
            let results = try await client.searchConversations(String(query.prefix(200)))
            return revision == sessionRevision ? results : []
        } catch {
            handle(error)
            return []
        }
    }

    // MARK: Conversation actions

    func loadMoreConversations() async {
        guard isSignedIn, !isLoadingConversations, let cursor = nextConversationCursor else { return }
        let revision = sessionRevision
        isLoadingConversations = true
        defer { if revision == sessionRevision { isLoadingConversations = false } }
        do {
            let page = try await client.conversations(cursor: cursor)
            guard revision == sessionRevision, isSignedIn else { return }
            for conversation in page.conversations { upsert(conversation) }
            nextConversationCursor = page.nextCursor == cursor ? nil : page.nextCursor
        } catch {
            guard revision == sessionRevision else { return }
            handle(error)
        }
    }

    func upsert(_ conversation: CloudConversation) {
        if let index = conversations.firstIndex(where: { $0.id == conversation.id }) {
            conversations[index] = conversation
        } else {
            conversations.insert(conversation, at: 0)
        }
    }

    func rename(_ conversation: CloudConversation, to title: String) async {
        let trimmed = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        guard !trimmed.isEmpty else { return }
        await update(conversation) { try await self.client.updateConversation(conversation.id, title: trimmed) }
    }

    func togglePin(_ conversation: CloudConversation) async {
        await update(conversation) { try await self.client.updateConversation(conversation.id, pinned: !conversation.pinned) }
    }

    func archive(_ conversation: CloudConversation) async {
        let revision = sessionRevision
        conversations.removeAll { $0.id == conversation.id }
        do {
            _ = try await client.updateConversation(conversation.id, archived: true)
        } catch {
            guard revision == sessionRevision else { return }
            upsert(conversation)
            handle(error)
        }
    }

    func delete(_ conversation: CloudConversation) async {
        let revision = sessionRevision
        conversations.removeAll { $0.id == conversation.id }
        do {
            try await client.deleteConversation(conversation.id)
        } catch {
            guard revision == sessionRevision else { return }
            upsert(conversation)
            handle(error)
        }
    }

    private func update(_ original: CloudConversation, _ call: () async throws -> CloudConversation) async {
        let revision = sessionRevision
        do {
            let updated = try await call()
            guard revision == sessionRevision, isSignedIn else { return }
            upsert(updated)
        } catch {
            guard revision == sessionRevision else { return }
            upsert(original)
            handle(error)
        }
    }

    // MARK: Usage

    /// Spends the oldest banked reset. The idempotency key makes a retried tap redeem at most one bank.
    func redeemBankedReset(idempotencyKey: String = UUID().uuidString) async -> Bool {
        do {
            usage = try await client.redeemBank(idempotencyKey: idempotencyKey).usage
            return true
        } catch {
            handle(error)
            return false
        }
    }

    // MARK: Images

    func cachedImage(fileId: String) -> UIImage? { imageCache.image(fileID: fileId) }

    func image(fileId: String) async -> UIImage? {
        let revision = sessionRevision
        if let cached = cachedImage(fileId: fileId) { return cached }
        while imageDownloads >= 2 {
            do { try await Task.sleep(for: .milliseconds(50)) } catch { return nil }
            guard revision == sessionRevision, isSignedIn else { return nil }
        }
        guard !Task.isCancelled, revision == sessionRevision, isSignedIn else { return nil }
        imageDownloads += 1
        defer { imageDownloads -= 1 }
        do {
            let data = try await client.fileData(fileId: fileId)
            guard !Task.isCancelled, revision == sessionRevision, isSignedIn,
                  let image = CloudImageCache.decode(data) else { return nil }
            imageCache.store(image, fileID: fileId)
            return image
        } catch {
            if revision == sessionRevision, !Task.isCancelled { handle(error) }
            return nil
        }
    }

    func remember(_ image: UIImage, fileId: String) { imageCache.store(image, fileID: fileId) }

    // MARK: Push (task completion)

    /// Asks once for notification permission when the user starts their first task.
    func enableTaskNotifications() {
        guard clientConfig?.pushConfigured == true else { return }
        Task {
            let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            if granted { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    private func observePushToken() {
        pushObserver = NotificationCenter.default.addObserver(
            forName: .codexDidRegisterForRemoteNotifications,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let data = note.userInfo?["deviceToken"] as? Data else { return }
            let token = data.map { String(format: "%02x", $0) }.joined()
            MainActor.assumeIsolated {
                self?.pushToken = token
                self?.registerPushTokenIfPossible()
            }
        }
    }

    /// A tapped task-finished push (see CodexNotificationCenterDelegateProxy) opens its conversation.
    private func observeConversationOpens() {
        openObserver = NotificationCenter.default.addObserver(
            forName: .djlCloudOpenConversation,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let id = note.userInfo?["conversationId"] as? String else { return }
            MainActor.assumeIsolated {
                self?.sectionPreference = .cloud
                self?.pendingConversationID = id
            }
        }
    }

    private func registerPushTokenIfPossible() {
        guard isSignedIn, let pushToken else { return }
        // Debug builds are signed with the development aps-environment, whose tokens are APNs sandbox tokens.
        #if DEBUG
        let environment = CloudAPIClient.PushEnvironment.sandbox
        #else
        let environment = CloudAPIClient.PushEnvironment.production
        #endif
        Task {
            try? await client.registerPushToken(pushToken, environment: environment)
        }
    }
}
