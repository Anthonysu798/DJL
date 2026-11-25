// FILE: CodexSecurePairingStateTests.swift
// Purpose: Verifies fresh QR scans force bootstrap mode and secure pairing failures stay actionable in UI state.
// Layer: Unit Test
// Exports: CodexSecurePairingStateTests
// Depends on: CryptoKit, Foundation, XCTest, DJL

import CryptoKit
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

    // Vectors from apps/mobile/test/fixtures/remote-v2.json ("transcript" and "pairing").
    func testPairingProofsMatchSharedFixtureVectors() throws {
        let transcriptBytes = try XCTUnwrap(Data(base64Encoded: Self.fixtureTranscript))
        let pairingSecret = try XCTUnwrap(Data(base64Encoded: Self.fixturePairingSecret))

        let macProof = codexPairingProof(
            pairingSecret: pairingSecret,
            transcriptBytes: transcriptBytes,
            label: codexPairingProofMacLabel
        )
        let phoneProof = codexPairingProof(
            pairingSecret: pairingSecret,
            transcriptBytes: transcriptBytes,
            label: codexPairingProofPhoneLabel
        )

        XCTAssertEqual(Data(macProof).base64EncodedString(), "d8OmuHZ5gMb5eLjXS3j1eaPJazlXufk9MssY+v7FWJw=")
        XCTAssertEqual(Data(phoneProof).base64EncodedString(), "kqruPBxVODSgXrtRnLRj3OemPY8huvRe7d5pihBGMHE=")
        XCTAssertTrue(macProof == Data(base64EncodedOrEmpty: "d8OmuHZ5gMb5eLjXS3j1eaPJazlXufk9MssY+v7FWJw="))
        XCTAssertFalse(macProof == Data(base64EncodedOrEmpty: "kqruPBxVODSgXrtRnLRj3OemPY8huvRe7d5pihBGMHE="))
        XCTAssertFalse(macProof == Data())
    }

    // Same inputs as apps/mobile/test/fixtures/remote-v2.json ("relayAuth").
    func testRelayPhoneConnectHeadersSignTheSessionWithThePhoneIdentity() throws {
        let phonePrivateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 2, count: 32))
        let phoneIdentityPublicKey = phonePrivateKey.publicKey.rawRepresentation.base64EncodedString()
        let transcriptBytes = codexRelayPhoneConnectTranscriptBytes(
            sessionId: "fixture-session",
            phoneDeviceId: "fixture-phone",
            phoneIdentityPublicKey: phoneIdentityPublicKey
        )

        XCTAssertEqual(transcriptBytes.base64EncodedString(), Self.fixturePhoneConnectTranscript)
        // CryptoKit signatures are randomized, so the shared vector is verified instead of reproduced.
        XCTAssertTrue(phonePrivateKey.publicKey.isValidSignature(
            Data(base64EncodedOrEmpty: Self.fixturePhoneConnectSignature),
            for: transcriptBytes
        ))

        let headers = try codexRelayPhoneConnectHeaders(
            sessionId: "fixture-session",
            phoneIdentityState: CodexPhoneIdentityState(
                phoneDeviceId: "fixture-phone",
                phoneIdentityPrivateKey: phonePrivateKey.rawRepresentation.base64EncodedString(),
                phoneIdentityPublicKey: phoneIdentityPublicKey
            )
        )

        XCTAssertEqual(
            headers.map(\.name),
            ["x-phone-device-id", "x-phone-identity-public-key", "x-phone-signature"]
        )
        XCTAssertEqual(headers[0].value, "fixture-phone")
        XCTAssertEqual(headers[1].value, "gTl3Dqh9F19Wo1Rmw0x+zMuNipG07jeiXfYPW4/Js5Q=")
        XCTAssertTrue(phonePrivateKey.publicKey.isValidSignature(
            Data(base64EncodedOrEmpty: headers[2].value),
            for: transcriptBytes
        ))
        XCTAssertFalse(phonePrivateKey.publicKey.isValidSignature(
            Data(base64EncodedOrEmpty: headers[2].value),
            for: codexRelayPhoneConnectTranscriptBytes(
                sessionId: "other-session",
                phoneDeviceId: "fixture-phone",
                phoneIdentityPublicKey: phoneIdentityPublicKey
            )
        ))
    }

    func testPairingSecretStaysInMemoryAndIsDroppedWithThePairing() throws {
        let service = makeService()
        let payload = CodexPairingQRPayload(
            v: codexPairingQRVersion,
            relay: "ws://relay.local/relay",
            sessionId: "session-\(UUID().uuidString)",
            macDeviceId: "mac-\(UUID().uuidString)",
            macIdentityPublicKey: Data(repeating: 5, count: 32).base64EncodedString(),
            expiresAt: Int64(Date().addingTimeInterval(60).timeIntervalSince1970 * 1000),
            pairingSecret: Self.fixturePairingSecret
        )

        service.rememberRelayPairing(payload)

        XCTAssertEqual(service.pendingPairingSecret?.base64EncodedString(), Self.fixturePairingSecret)
        for key in [
            CodexSecureKeys.relaySessionId,
            CodexSecureKeys.relayUrl,
            CodexSecureKeys.relayMacDeviceId,
            CodexSecureKeys.relayMacIdentityPublicKey,
            CodexSecureKeys.relayProtocolVersion,
        ] {
            XCTAssertNotEqual(SecureStore.readString(for: key), Self.fixturePairingSecret)
        }
        let registryData = try JSONEncoder().encode(service.trustedMacRegistry)
        XCTAssertFalse(String(decoding: registryData, as: UTF8.self).contains(Self.fixturePairingSecret))

        service.clearSavedRelaySession()

        XCTAssertNil(service.pendingPairingSecret)
    }

    func testClientAuthOmitsPairingProofForTrustedReconnect() throws {
        let trustedReconnectAuth = SecureClientAuth(
            sessionId: "session",
            phoneDeviceId: "phone",
            keyEpoch: 1,
            phoneSignature: "signature"
        )
        let bootstrapAuth = SecureClientAuth(
            sessionId: "session",
            phoneDeviceId: "phone",
            keyEpoch: 1,
            phoneSignature: "signature",
            pairingProof: "proof"
        )

        let trustedReconnectJSON = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(trustedReconnectAuth)) as? [String: Any]
        )
        let bootstrapJSON = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(bootstrapAuth)) as? [String: Any]
        )

        XCTAssertNil(trustedReconnectJSON["pairingProof"])
        XCTAssertEqual(bootstrapJSON["pairingProof"] as? String, "proof")
    }

    func testInvalidPairingProofFromComputerRequiresFreshPairing() {
        let service = makeService()

        service.processIncomingWireText(
            #"{"kind":"secureError","code":"invalid_pairing_proof","message":"The pairing code or QR code did not match. Generate a new one and try again."}"#
        )

        XCTAssertEqual(service.secureConnectionState, .rePairRequired)
        XCTAssertEqual(
            service.lastErrorMessage,
            "The pairing code or QR code did not match. Generate a new one and try again."
        )
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

    private static let fixturePairingSecret = "TEaZ1ethYE23uB3tOIot0NEaq4mGN7y49uprY48IWoA="
    private static let fixturePhoneConnectTranscript = "AAAAGmRqbC1yZWxheS1waG9uZS1jb25uZWN0LXYxAAAAD2ZpeHR1cmUtc2Vzc2lvbgAAAA1maXh0dXJlLXBob25lAAAAIIE5dw6ofRdfVqNUZsNMfszLjYqRtO43ol32D1uPybOU"
    private static let fixturePhoneConnectSignature = "cHHtC0kjvcZXGXa2NQRCtzoMj7vmKCS+Jnq/rGuNdvdwGvIzqUsA7kGc9HmaUJzJpzA/RyzhwDpt7ks4/PZIAA=="
    private static let fixtureTranscript = "AAAAC2RqbC1lMmVlLXYxAAAAD2ZpeHR1cmUtc2Vzc2lvbgAAAAEyAAAADHFyX2Jvb3RzdHJhcAAAAAE3AAAAC2ZpeHR1cmUtbWFjAAAADWZpeHR1cmUtcGhvbmUAAAAgiojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1wAAAAggTl3Dqh9F19Wo1Rmw0x+zMuNipG07jeiXfYPW4/Js5QAAAAgXf7dO2vUf2+ijuFdlp1bsOpTd01Ii9r53xxuASSz7yIAAAAgrAGyIJ6GNU+4UyN7XeD0+rE8f8v0M6YcAZNpYX/s8QsAAAAgBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUAAAAgBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYAAAANMTc5MzE2MTIwMDAwMA=="

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
