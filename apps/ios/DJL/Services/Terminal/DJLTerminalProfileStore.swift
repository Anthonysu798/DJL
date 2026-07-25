// FILE: DJLTerminalProfileStore.swift
// Purpose: Persists the SSH terminal profile in Keychain-backed app storage.
// Layer: Service
// Exports: DJLTerminalProfileStore
// Depends on: SecureStore, DJLTerminalProfile

import Foundation

enum DJLTerminalProfileStore {
    // Keeps host/key-path configuration with the same Keychain protection as pairing metadata.
    static func load() -> DJLTerminalProfile {
        SecureStore.readCodable(DJLTerminalProfile.self, for: CodexSecureKeys.terminalSSHProfile)
            ?? .empty
    }

    static func save(_ profile: DJLTerminalProfile) {
        SecureStore.writeCodable(profile.normalizedForSave, for: CodexSecureKeys.terminalSSHProfile)
    }
}
