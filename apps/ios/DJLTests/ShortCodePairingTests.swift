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
