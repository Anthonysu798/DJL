// FILE: CloudSessionStore.swift
// Purpose: Keeps the long-lived DJL Cloud session token in the Keychain.
// Layer: Service
// Exports: CloudSessionStoring, CloudKeychainSessionStore
// Depends on: SecureStore

import Foundation
import Security

nonisolated protocol CloudSessionStoring: Sendable {
    func readSessionToken() -> String?
    func writeSessionToken(_ token: String?)
}

nonisolated struct CloudKeychainSessionStore: CloudSessionStoring {
    func readSessionToken() -> String? {
        SecureStore.readString(for: CodexSecureKeys.cloudSessionToken)
    }

    func writeSessionToken(_ token: String?) {
        guard let token, !token.isEmpty else {
            SecureStore.deleteValue(for: CodexSecureKeys.cloudSessionToken)
            return
        }
        // Available after first unlock so a background task-completion refresh can still call the API,
        // but never migrated to another device through a backup.
        SecureStore.writeString(token, for: CodexSecureKeys.cloudSessionToken, accessibility: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)
    }
}
