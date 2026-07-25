// FILE: QRScannerPairingValidatorTests.swift
// Purpose: Verifies scanned and pasted pairing payloads validate before the user retries pairing.
// Layer: Unit Test
// Exports: QRScannerPairingValidatorTests
// Depends on: XCTest, DJL

import XCTest
@testable import DJL

final class QRScannerPairingValidatorTests: XCTestCase {
    func testVersionMismatchRequiresBridgeUpdateBeforeScanning() {
        let result = validatePairingQRCode(
            pairingQRCode(
                v: codexPairingQRVersion + 1,
                expiresAt: 1_900_000_000_000
            )
        )

        guard case .bridgeUpdateRequired(let prompt) = result else {
            return XCTFail("Expected a bridge update prompt for mismatched QR versions.")
        }

        XCTAssertEqual(prompt.title, "Update DJL on your Mac before scanning")
        XCTAssertEqual(prompt.command, "npm install -g djl@latest")
        XCTAssertTrue(prompt.message.contains("different DJL npm version"))
    }

    func testLegacyBridgePayloadRequiresBridgeUpdateBeforeScanning() {
        let result = validatePairingQRCode("""
        {"relay":"wss://relay.example","sessionId":"session-123"}
        """)

        guard case .bridgeUpdateRequired(let prompt) = result else {
            return XCTFail("Expected a bridge update prompt for legacy pairing payloads.")
        }

        XCTAssertEqual(prompt.command, "npm install -g djl@latest")
        XCTAssertTrue(prompt.message.contains("older DJL bridge"))
    }

    func testValidPayloadReturnsSuccess() {
        let result = validatePairingQRCode(
            pairingQRCode(
                v: codexPairingQRVersion,
                expiresAt: 1_900_000_000_000
            ),
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        guard case .success(let payload) = result else {
            return XCTFail("Expected a valid payload.")
        }

        XCTAssertEqual(payload.sessionId, "session-123")
        XCTAssertEqual(payload.relay, "wss://relay.example")
    }

    func testPasteablePairingCodeReturnsSuccess() {
        let json = pairingQRCode(
            v: codexPairingQRVersion,
            expiresAt: 1_900_000_000_000
        )
        let encoded = Data(json.utf8)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")

        let result = validatePairingQRCode(
            "RMX1:\(encoded)",
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        guard case .success(let payload) = result else {
            return XCTFail("Expected a valid pasted pairing code.")
        }

        XCTAssertEqual(payload.macDeviceId, "mac-123")
        XCTAssertEqual(payload.macIdentityPublicKey, "pub-key")
    }

    func testManualQRCodePayloadPreservesCaseSensitiveRelayText() {
        let result = validatePairingQRCode(
            """
            {"v":\(codexPairingQRVersion),"relay":"wss://Relay.Example/CaseSensitivePath","sessionId":"session-123","macDeviceId":"mac-123","macIdentityPublicKey":"pub-key","expiresAt":1900000000000}
            """,
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        guard case .success(let payload) = result else {
            return XCTFail("Expected the manually pasted QR payload to remain valid.")
        }

        XCTAssertEqual(payload.relay, "wss://Relay.Example/CaseSensitivePath")
    }

    func testShortPairingCodeReturnsLookupRequest() {
        let result = validatePairingQRCode("ab23-cd34ef")

        guard case .shortCode(let code) = result else {
            return XCTFail("Expected a short pairing code lookup.")
        }

        XCTAssertEqual(code, "AB23CD34EF")
    }

    func testExpiredPayloadReturnsScanError() {
        let result = validatePairingQRCode(
            pairingQRCode(
                v: codexPairingQRVersion,
                expiresAt: 1_700_000_000_000
            ),
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        guard case .scanError(let message) = result else {
            return XCTFail("Expected an expiry error.")
        }

        XCTAssertEqual(message, "This pairing code has expired. Generate a new one from the Mac bridge.")
    }

    private func pairingQRCode(
        v: Int,
        expiresAt: Int64
    ) -> String {
        """
        {"v":\(v),"relay":"wss://relay.example","sessionId":"session-123","macDeviceId":"mac-123","macIdentityPublicKey":"pub-key","expiresAt":\(expiresAt)}
        """
    }
}

final class MyDevicesPresentationTests: XCTestCase {
    func testConnectionActionsExposeScannerAndManualCodePairing() {
        XCTAssertEqual(
            MyDeviceConnectionAction.allCases,
            [.scanQRCode, .pairWithCode]
        )
        XCTAssertEqual(MyDeviceConnectionAction.scanQRCode.title, "Scan QR Code")
        XCTAssertEqual(MyDeviceConnectionAction.scanQRCode.systemImage, "qrcode.viewfinder")
        XCTAssertEqual(MyDeviceConnectionAction.pairWithCode.title, "Pair with Code")
        XCTAssertEqual(MyDeviceConnectionAction.pairWithCode.systemImage, "keyboard")
    }
}
