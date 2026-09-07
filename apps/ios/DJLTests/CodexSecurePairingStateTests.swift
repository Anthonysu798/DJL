// FILE: CodexSecurePairingStateTests.swift
// Purpose: Verifies fresh QR scans force bootstrap mode and secure pairing failures stay actionable in UI state.
// Layer: Unit Test
// Exports: CodexSecurePairingStateTests
// Depends on: Foundation, XCTest, DJL

import Foundation
import Security
import XCTest
@testable import DJL

@MainActor
final class CodexSecurePairingStateTests: XCTestCase {
    private static var retainedServices: [CodexService] = []

    override func setUp() {
        super.setUp()
        clearStoredSecureRelayState()
    }

    override func tearDown() {
        clearStoredSecureRelayState()
        super.tearDown()
    }

    func testRememberRelayPairingForcesFreshQRBootstrapEvenForTrustedMac() {
        let service = makeService()
        let macDeviceID = "mac-\(UUID().uuidString)"
        let originalPublicKey = Data(repeating: 1, count: 32).base64EncodedString()
        let freshQRPublicKey = Data(repeating: 2, count: 32).base64EncodedString()

        service.trustedMacRegistry.records[macDeviceID] = CodexTrustedMacRecord(
            macDeviceId: macDeviceID,
            macIdentityPublicKey: originalPublicKey,
            lastPairedAt: Date()
        )

        service.rememberRelayPairing(
            CodexPairingQRPayload(
                v: codexPairingQRVersion,
                relay: "ws://relay.local/relay",
                sessionId: "session-\(UUID().uuidString)",
                macDeviceId: macDeviceID,
                macIdentityPublicKey: freshQRPublicKey,
                expiresAt: Int64(Date().addingTimeInterval(60).timeIntervalSince1970 * 1000)
            )
        )

        XCTAssertTrue(service.shouldForceQRBootstrapOnNextHandshake)
        XCTAssertFalse(service.hasTrustedReconnectContext)
        XCTAssertEqual(service.secureConnectionState, .trustedMac)
        XCTAssertEqual(service.normalizedRelayMacIdentityPublicKey, freshQRPublicKey)
    }

    func testRememberRelayPairingShowsHandshakeStateForBrandNewMac() {
        let service = makeService()
        let freshQRPublicKey = Data(repeating: 4, count: 32).base64EncodedString()

        service.rememberRelayPairing(
            CodexPairingQRPayload(
                v: codexPairingQRVersion,
                relay: "ws://relay.local/relay",
                sessionId: "session-\(UUID().uuidString)",
                macDeviceId: "mac-\(UUID().uuidString)",
                macIdentityPublicKey: freshQRPublicKey,
                expiresAt: Int64(Date().addingTimeInterval(60).timeIntervalSince1970 * 1000)
            )
        )

        XCTAssertTrue(service.shouldForceQRBootstrapOnNextHandshake)
        XCTAssertEqual(service.secureConnectionState, .handshaking)
        XCTAssertEqual(service.secureMacFingerprint, codexSecureFingerprint(for: freshQRPublicKey))
    }

    func testResetSecureTransportStatePreservesRePairRequiredState() {
        let service = makeService()
        service.relaySessionId = "session-\(UUID().uuidString)"
        service.relayUrl = "ws://relay.local/relay"
        service.secureConnectionState = .rePairRequired
        service.secureMacFingerprint = "ABC123"

        service.resetSecureTransportState()

        XCTAssertEqual(service.secureConnectionState, .rePairRequired)
        XCTAssertEqual(service.secureMacFingerprint, "ABC123")
    }

    func testInitializationDoesNotInventCurrentTrustedMacWhenLegacyPointersAreUnknown() {
        let knownMacDeviceID = "mac-\(UUID().uuidString)"

        SecureStore.writeCodable(
            CodexTrustedMacRegistry(
                records: [
                    knownMacDeviceID: CodexTrustedMacRecord(
                        macDeviceId: knownMacDeviceID,
                        macIdentityPublicKey: Data(repeating: 13, count: 32).base64EncodedString(),
                        lastPairedAt: Date()
                    )
                ]
            ),
            for: CodexSecureKeys.trustedMacRegistry
        )
        SecureStore.writeString("mac-missing", for: CodexSecureKeys.lastTrustedMacDeviceId)

        let service = makeService()

        XCTAssertNil(service.normalizedCurrentTrustedMacDeviceId)
        XCTAssertNil(SecureStore.readString(for: CodexSecureKeys.currentTrustedMacDeviceId))
    }

    func testClearSavedRelaySessionFallsBackToCurrentTrustedMacState() {
        let service = makeService()
        let macDeviceID = "mac-\(UUID().uuidString)"
        let publicKey = Data(repeating: 15, count: 32).base64EncodedString()

        service.trustedMacRegistry.records[macDeviceID] = CodexTrustedMacRecord(
            macDeviceId: macDeviceID,
            macIdentityPublicKey: publicKey,
            lastPairedAt: Date(),
            relayURL: "wss://relay.local/relay"
        )
        service.setCurrentTrustedMacDeviceId(macDeviceID)
        service.relaySessionId = "saved-session"
        service.relayUrl = "wss://relay.local/relay"
        service.relayMacDeviceId = macDeviceID
        service.relayMacIdentityPublicKey = publicKey

        service.clearSavedRelaySession()

        XCTAssertEqual(service.secureConnectionState, .liveSessionUnresolved)
        XCTAssertEqual(service.secureMacFingerprint, codexSecureFingerprint(for: publicKey))
        XCTAssertNil(service.normalizedRelaySessionId)
    }

    private func keychainAccessibility(for key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Bundle.main.bundleIdentifier ?? "com.codexmobile.app",
            kSecAttrAccount as String: key,
            kSecReturnAttributes as String: kCFBooleanTrue as Any,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let attributes = result as? [String: Any] else {
            return nil
        }
        return attributes[kSecAttrAccessible as String] as? String
    }

    // Clears the persisted relay session keys touched by secure reconnect tests.
    private func clearStoredSecureRelayState() {
        SecureStore.deleteValue(for: CodexSecureKeys.relaySessionId)
        SecureStore.deleteValue(for: CodexSecureKeys.relayUrl)
        SecureStore.deleteValue(for: CodexSecureKeys.relayMacDeviceId)
        SecureStore.deleteValue(for: CodexSecureKeys.relayMacIdentityPublicKey)
        SecureStore.deleteValue(for: CodexSecureKeys.relayProtocolVersion)
        SecureStore.deleteValue(for: CodexSecureKeys.relayLastAppliedBridgeOutboundSeq)
        SecureStore.deleteValue(for: CodexSecureKeys.trustedMacRegistry)
        SecureStore.deleteValue(for: CodexSecureKeys.currentTrustedMacDeviceId)
        SecureStore.deleteValue(for: CodexSecureKeys.lastTrustedMacDeviceId)
        SecureStore.deleteValue(for: CodexSecureKeys.phoneIdentityState)
    }

    private func makeService(defaults: UserDefaults? = nil) -> CodexService {
        let resolvedDefaults: UserDefaults
        if let defaults {
            resolvedDefaults = defaults
        } else {
            let suiteName = "CodexSecurePairingStateTests.\(UUID().uuidString)"
            let isolatedDefaults = UserDefaults(suiteName: suiteName) ?? .standard
            isolatedDefaults.removePersistentDomain(forName: suiteName)
            resolvedDefaults = isolatedDefaults
        }

        let service = CodexService(defaults: resolvedDefaults)
        Self.retainedServices.append(service)
        return service
    }
}

final class DJLAppLockPolicyTests: XCTestCase {
    func testReturningPairedUserStartsLockedWhenProtectionIsEnabled() {
        XCTAssertTrue(
            DJLAppLockPolicy.shouldLockOnLaunch(
                isEnabled: true,
                hasProtectedContent: true
            )
        )
        XCTAssertFalse(
            DJLAppLockPolicy.shouldLockOnLaunch(
                isEnabled: true,
                hasProtectedContent: false
            )
        )
    }

    func testBackgroundTimeoutLocksAtFiveMinutes() {
        let backgroundedAt = Date(timeIntervalSince1970: 1_000)
        XCTAssertFalse(
            DJLAppLockPolicy.shouldRequireUnlock(
                backgroundedAt: backgroundedAt,
                now: backgroundedAt.addingTimeInterval(299),
                isEnabled: true,
                hasProtectedContent: true
            )
        )
        XCTAssertTrue(
            DJLAppLockPolicy.shouldRequireUnlock(
                backgroundedAt: backgroundedAt,
                now: backgroundedAt.addingTimeInterval(300),
                isEnabled: true,
                hasProtectedContent: true
            )
        )
    }

    func testDisabledOrUnpairedAppNeverRequiresUnlock() {
        let backgroundedAt = Date(timeIntervalSince1970: 1_000)
        let now = backgroundedAt.addingTimeInterval(3_600)
        XCTAssertFalse(
            DJLAppLockPolicy.shouldRequireUnlock(
                backgroundedAt: backgroundedAt,
                now: now,
                isEnabled: false,
                hasProtectedContent: true
            )
        )
        XCTAssertFalse(
            DJLAppLockPolicy.shouldRequireUnlock(
                backgroundedAt: backgroundedAt,
                now: now,
                isEnabled: true,
                hasProtectedContent: false
            )
        )
    }
}
