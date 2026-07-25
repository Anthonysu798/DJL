// FILE: DJLApp.swift
// Purpose: App entry point and root dependency wiring.
// Layer: App
// Exports: DJLApp

import SwiftUI

@MainActor
@main
struct DJLApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @UIApplicationDelegateAdaptor(DJLAppDelegate.self) private var appDelegate
    @State private var codexService: CodexService
    @State private var appLockController: DJLAppLockController
    @State private var petCompanionStore: PetCompanionStore
    @State private var petCompanionStatusStore: PetCompanionStatusStore
    @AppStorage(DJLAppLockPreference.storageKey) private var biometricLockEnabled = DJLAppLockPreference.defaultEnabled

    init() {
        let service = CodexService()
        #if DEBUG
        service.configureUITestFixtureIfNeeded()
        #endif
        service.configureNotifications()
        _codexService = State(initialValue: service)
        let storedLockPreference = UserDefaults.standard.object(
            forKey: DJLAppLockPreference.storageKey
        ) as? Bool ?? DJLAppLockPreference.defaultEnabled
        _appLockController = State(
            initialValue: DJLAppLockController(
                initiallyLocked: DJLAppLockPolicy.shouldLockOnLaunch(
                    isEnabled: storedLockPreference,
                    hasProtectedContent: service.hasReconnectCandidate
                )
            )
        )
        _petCompanionStore = State(initialValue: PetCompanionStore())
        _petCompanionStatusStore = State(initialValue: PetCompanionStatusStore())
    }

    var body: some Scene {
        WindowGroup {
            protectedRootContent
                .onOpenURL { url in
                    Task { @MainActor in
                        guard !routeDJLDeepLink(url) else {
                            return
                        }
                        guard CodexService.legacyGPTLoginCallbackEnabled else {
                            return
                        }
                        await codexService.handleGPTLoginCallbackURL(url)
                    }
                }
                .onReceive(
                    NotificationCenter.default.publisher(
                        for: UIApplication.didReceiveMemoryWarningNotification
                    )
                ) { _ in
                    TurnCacheManager.resetAll()
                }
                .onChange(of: scenePhase) { _, newPhase in
                    handleScenePhase(newPhase)
                    if newPhase == .background {
                        TurnCacheManager.resetAll()
                    }
                }
                .onChange(of: biometricLockEnabled) { _, enabled in
                    appLockController.setEnabled(enabled)
                }
        }
    }

    private var protectedRootContent: some View {
        ZStack {
            ContentView()
                .environment(codexService)
                .environment(petCompanionStore)
                .environment(petCompanionStatusStore)
                .allowsHitTesting(!appLockController.isPrivacyShieldVisible)
                .accessibilityHidden(appLockController.isPrivacyShieldVisible)

            if appLockController.isPrivacyShieldVisible {
                DJLPrivacyShieldView(
                    requiresUnlock: appLockController.requiresUnlock,
                    isAuthenticating: appLockController.isAuthenticating,
                    errorMessage: appLockController.errorMessage,
                    unlock: authenticateAppLock
                )
                .zIndex(100)
            }
        }
        .task {
            if appLockController.requiresUnlock {
                await appLockController.authenticate()
            }
        }
    }

    private func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .inactive:
            appLockController.protectSnapshot()
        case .background:
            appLockController.didEnterBackground()
        case .active:
            let shouldAuthenticate = appLockController.didBecomeActive(
                isEnabled: biometricLockEnabled,
                hasProtectedContent: codexService.hasReconnectCandidate
            )
            if shouldAuthenticate {
                authenticateAppLock()
            }
        @unknown default:
            appLockController.protectSnapshot()
        }
    }

    private func authenticateAppLock() {
        Task { @MainActor in
            await appLockController.authenticate()
        }
    }

    @discardableResult
    private func routeDJLDeepLink(_ url: URL) -> Bool {
        guard let destination = DJLDeepLinkParser.destination(from: url) else {
            return false
        }

        codexService.handleNotificationOpen(
            threadId: destination.target.threadID,
            turnId: destination.target.turnID,
            itemId: destination.target.itemID,
            messageId: destination.target.messageID
        )
        return true
    }
}
