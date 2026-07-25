// FILE: DJLAppLockController.swift
// Purpose: Protect paired DJL content in app-switcher snapshots and require device-owner auth after timeout.
// Layer: Service
// Exports: DJLAppLockPreference, DJLAppLockPolicy, DJLAppLockController, DJLPrivacyShieldView

import LocalAuthentication
import Observation
import SwiftUI

enum DJLAppLockPreference {
    nonisolated static let storageKey = "djl.security.biometricLockEnabled"
    nonisolated static let defaultEnabled = true
}

struct DJLAppLockPolicy {
    nonisolated static let backgroundTimeout: TimeInterval = 5 * 60

    nonisolated static func shouldLockOnLaunch(
        isEnabled: Bool,
        hasProtectedContent: Bool
    ) -> Bool {
        isEnabled && hasProtectedContent
    }

    nonisolated static func shouldRequireUnlock(
        backgroundedAt: Date?,
        now: Date,
        isEnabled: Bool,
        hasProtectedContent: Bool,
        timeout: TimeInterval = backgroundTimeout
    ) -> Bool {
        guard isEnabled,
              hasProtectedContent,
              let backgroundedAt else {
            return false
        }
        return now.timeIntervalSince(backgroundedAt) >= timeout
    }
}

@MainActor
@Observable
final class DJLAppLockController {
    private(set) var isPrivacyShieldVisible: Bool
    private(set) var requiresUnlock: Bool
    private(set) var isAuthenticating = false
    private(set) var errorMessage: String?

    private var backgroundedAt: Date?

    init(initiallyLocked: Bool) {
        isPrivacyShieldVisible = initiallyLocked
        requiresUnlock = initiallyLocked
    }

    func protectSnapshot() {
        isPrivacyShieldVisible = true
    }

    func didEnterBackground(at date: Date = Date()) {
        backgroundedAt = backgroundedAt ?? date
        protectSnapshot()
    }

    @discardableResult
    func didBecomeActive(
        isEnabled: Bool,
        hasProtectedContent: Bool,
        now: Date = Date()
    ) -> Bool {
        if !isEnabled || !hasProtectedContent {
            unlockWithoutAuthentication()
            return false
        }

        let timedOut = DJLAppLockPolicy.shouldRequireUnlock(
            backgroundedAt: backgroundedAt,
            now: now,
            isEnabled: isEnabled,
            hasProtectedContent: hasProtectedContent
        )
        backgroundedAt = nil
        if timedOut {
            requiresUnlock = true
            isPrivacyShieldVisible = true
        } else if !requiresUnlock {
            isPrivacyShieldVisible = false
        }
        return requiresUnlock && !isAuthenticating
    }

    func setEnabled(_ enabled: Bool) {
        if !enabled {
            unlockWithoutAuthentication()
        }
    }

    func authenticate() async {
        guard requiresUnlock, !isAuthenticating else { return }
        isAuthenticating = true
        errorMessage = nil

        let context = LAContext()
        context.localizedCancelTitle = "Keep Locked"
        context.localizedFallbackTitle = "Use Passcode"
        var authorizationError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authorizationError) else {
            isAuthenticating = false
            errorMessage = "Set up Face ID, Touch ID, or a device passcode to unlock DJL."
            return
        }

        do {
            let authenticated = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Unlock DJL and your remote coding sessions."
            )
            isAuthenticating = false
            if authenticated {
                unlockWithoutAuthentication()
            } else {
                errorMessage = "DJL is still locked."
            }
        } catch {
            isAuthenticating = false
            errorMessage = "Authentication was cancelled. Unlock DJL to continue."
        }
    }

    private func unlockWithoutAuthentication() {
        backgroundedAt = nil
        requiresUnlock = false
        isPrivacyShieldVisible = false
        isAuthenticating = false
        errorMessage = nil
    }
}

struct DJLPrivacyShieldView: View {
    let requiresUnlock: Bool
    let isAuthenticating: Bool
    let errorMessage: String?
    let unlock: () -> Void

    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground)
                .ignoresSafeArea()

            VStack(spacing: 18) {
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 38, weight: .semibold))
                    .foregroundStyle(.primary)
                    .accessibilityHidden(true)

                VStack(spacing: 7) {
                    Text("DJL is locked")
                        .font(AppFont.title2(weight: .semibold))
                    Text("Your remote sessions stay private when you step away.")
                        .font(AppFont.body())
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                if let errorMessage, requiresUnlock {
                    Text(errorMessage)
                        .font(AppFont.footnote())
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                if requiresUnlock {
                    Button(action: unlock) {
                        HStack(spacing: 8) {
                            if isAuthenticating {
                                ProgressView()
                                    .controlSize(.small)
                            }
                            Text(isAuthenticating ? "Unlocking…" : "Unlock DJL")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(isAuthenticating)
                    .accessibilityHint("Authenticates with Face ID, Touch ID, or your device passcode")
                }
            }
            .frame(maxWidth: 360)
            .padding(32)
        }
    }
}
