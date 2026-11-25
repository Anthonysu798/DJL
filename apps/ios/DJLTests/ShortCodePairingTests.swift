import XCTest
@testable import DJL

@MainActor
final class ShortCodePairingTests: XCTestCase {
    func testShortCodeEntryAcceptsDesktopCodeWithFormatting() {
        XCTAssertEqual(normalizedOneTimePairingCode(" abcd-ef2345\n"), "ABCDEF2345")
        XCTAssertEqual(normalizedOneTimePairingCode("ABCD\tEF2345"), "ABCDEF2345")
        XCTAssertNil(normalizedOneTimePairingCode("RMX1:eyJ2IjoyfQ"))
        XCTAssertNil(normalizedOneTimePairingCode("0000000000"))
    }
    // Vector from apps/mobile/test/fixtures/remote-v2.json ("pairing").
    func testTypedCodeDerivesRelayLookupCodeAndPairingSecret() throws {
        let code = try XCTUnwrap(normalizedOneTimePairingCode("abcde-fghjk"))
        let keys = try XCTUnwrap(codexDerivePairingCodeKeys(from: code))

        XCTAssertEqual(keys.lookupCode, "7FMLNGRYRD")
        XCTAssertEqual(keys.pairingSecret.base64EncodedString(), "TEaZ1ethYE23uB3tOIot0NEaq4mGN7y49uprY48IWoA=")
        XCTAssertNotEqual(keys.lookupCode, code)
    }
    func testFreshInstallUsesThePackagedPairingRelay() {
        XCTAssertEqual(AppEnvironment.configuredPairingRelay(bundleValue: "wss://relay.example/relay", developmentOverride: nil), "wss://relay.example/relay")
        XCTAssertEqual(AppEnvironment.configuredPairingRelay(bundleValue: nil, developmentOverride: "ws://127.0.0.1:8799/relay"), "ws://127.0.0.1:8799/relay")
    }
    func testInvalidRelayConfigurationDoesNotBecomeALookupDestination() {
        for invalid in ["", "$(DJL_DEFAULT_RELAY_URL)", "https://example.com", "wss://user:secret@example.com/relay", "wss://example.com/relay?token=secret"] {
            XCTAssertEqual(AppEnvironment.configuredPairingRelay(bundleValue: invalid, developmentOverride: nil), "")
        }
    }
}
