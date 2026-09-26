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
    @ObservationIgnored private let sessionStore: CloudSessionStoring

    private(set) var isSignedIn: Bool
    var sectionPreference: CloudSectionPreference = .automatic

    private(set) var me: CloudMe?
    private(set) var credits: CloudCredits?
    private(set) var usage: CloudUsageWindows?
    private(set) var models: [CloudModel] = []
    private(set) var conversations: [CloudConversation] = []
    private(set) var isLoadingConversations = false
    var lastError: String?
    /// Set by a `djl://cloud/c/<id>` link or a task-completion push; the home view opens it.
    var pendingConversationID: String?

    var selectedModelID: String? {
        didSet { UserDefaults.standard.set(selectedModelID, forKey: Self.selectedModelKey) }
    }

    @ObservationIgnored private var images: [String: UIImage] = [:]
    @ObservationIgnored private var pushToken: String?
    @ObservationIgnored private var pushObserver: NSObjectProtocol?
    @ObservationIgnored private var openObserver: NSObjectProtocol?
    private static let selectedModelKey = "djl.cloud.selectedModelID"

    init(
        configuration: CloudAPIConfiguration = .resolved(),
        sessionStore: CloudSessionStoring = CloudKeychainSessionStore(),
        urlSession: URLSession = .shared,
        tokenProvider: CloudAccessTokenProviding? = nil
    ) {
        self.sessionStore = sessionStore
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

    // MARK: Session

    func completeSignIn(sessionToken: String) async {
        sessionStore.writeSessionToken(sessionToken)
        await client.tokenProvider.invalidate()
        isSignedIn = true
        sectionPreference = .cloud
        await refreshAll()
        registerPushTokenIfPossible()
    }

    func signOut() async {
        if let token = sessionStore.readSessionToken() {
            await authAPI.signOut(sessionToken: token)
        }
        clearLocalSession()
    }

    func deleteAccount() async throws {
        try await client.deleteAccount()
        clearLocalSession()
    }

    private func clearLocalSession() {
        sessionStore.writeSessionToken(nil)
        isSignedIn = false
        me = nil
        credits = nil
        usage = nil
        conversations = []
        images = [:]
        Task { await client.tokenProvider.invalidate() }
    }

    /// Every call site funnels errors here so an ended session always returns to the welcome screen.
    func handle(_ error: Error) {
        if let apiError = error as? CloudAPIError, apiError == .unauthorized {
            clearLocalSession()
            lastError = apiError.errorDescription
            return
        }
        if error is CancellationError { return }
        lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }

    // MARK: Loading

    func refreshAll() async {
        guard isSignedIn else { return }
        async let meResult = client.me()
        async let modelsResult = client.models()
        async let listResult = client.conversations()
        do {
            me = try await meResult
            models = try await modelsResult
            conversations = try await listResult.conversations
        } catch {
            handle(error)
        }
        await refreshUsage()
    }

    func refreshUsage() async {
        guard isSignedIn else { return }
        do {
            async let creditsResult = client.credits()
            async let usageResult = client.usageWindows()
            credits = try await creditsResult
            usage = try await usageResult
        } catch {
            handle(error)
        }
    }

    func refreshConversations() async {
        guard isSignedIn else { return }
        isLoadingConversations = true
        defer { isLoadingConversations = false }
        do {
            conversations = try await client.conversations().conversations
        } catch {
            handle(error)
        }
    }

    func search(_ text: String) async -> [CloudConversationSearchHit] {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        do {
            return try await client.searchConversations(String(query.prefix(200)))
        } catch {
            handle(error)
            return []
        }
    }

    // MARK: Conversation actions

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
        conversations.removeAll { $0.id == conversation.id }
        do {
            _ = try await client.updateConversation(conversation.id, archived: true)
        } catch {
            upsert(conversation)
            handle(error)
        }
    }

    func delete(_ conversation: CloudConversation) async {
        conversations.removeAll { $0.id == conversation.id }
        do {
            try await client.deleteConversation(conversation.id)
        } catch {
            upsert(conversation)
            handle(error)
        }
    }

    private func update(_ original: CloudConversation, _ call: () async throws -> CloudConversation) async {
        do {
            upsert(try await call())
        } catch {
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

    func cachedImage(fileId: String) -> UIImage? { images[fileId] }

    func image(fileId: String) async -> UIImage? {
        if let cached = images[fileId] { return cached }
        do {
            let data = try await client.fileData(fileId: fileId)
            guard let image = UIImage(data: data) else { return nil }
            images[fileId] = image
            return image
        } catch {
            handle(error)
            return nil
        }
    }

    func remember(_ image: UIImage, fileId: String) {
        images[fileId] = image
    }

    // MARK: Push (task completion)

    /// Asks once for notification permission when the user starts their first task.
    func enableTaskNotifications() {
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
