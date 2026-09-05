// FILE: CodexServiceRelayRateLimitTests.swift
// Purpose: Verifies a relay rate-limit close keeps the pairing and retries.
// Layer: Unit Test
// Exports: CodexServiceRelayRateLimitTests
// Depends on: XCTest, Network, DJL

import XCTest
import Network
@testable import DJL

@MainActor
final class CodexServiceRelayRateLimitTests: XCTestCase {
    private static var retainedServices: [CodexService] = []

    func testRateLimitedCloseKeepsSessionAndRetries() {
        let service = makeService()
        service.relaySessionId = "session-\(UUID().uuidString)"
        service.relayUrl = "wss://relay.test/relay"
        service.isConnected = true
        service.isInitialized = true
        service.setForegroundState(true)

        service.handleReceiveError(
            CodexServiceError.disconnected,
            relayCloseCode: .privateCode(4008)
        )

        XCTAssertFalse(service.isConnected)
        XCTAssertNotNil(service.relaySessionId)
        XCTAssertTrue(service.shouldAutoReconnectOnForeground)
        XCTAssertEqual(
            service.connectionRecoveryState,
            .retrying(attempt: 0, message: "Catching up…")
        )
        XCTAssertNil(service.lastErrorMessage)
    }

    private func makeService() -> CodexService {
        let suiteName = "CodexServiceRelayRateLimitTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        let service = CodexService(defaults: defaults)
        service.messagesByThread = [:]
        // CodexService currently crashes while deallocating in unit-test environment.
        // Keep instances alive for process lifetime so assertions remain deterministic.
        Self.retainedServices.append(service)
        return service
    }
}
