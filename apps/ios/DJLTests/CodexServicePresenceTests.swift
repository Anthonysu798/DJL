// FILE: CodexServicePresenceTests.swift
// Purpose: Verifies host presence from relay frames, heartbeats, and silence.
// Layer: Unit Test
// Exports: CodexServicePresenceTests
// Depends on: XCTest, DJL

import XCTest
@testable import DJL

@MainActor
final class CodexServicePresenceTests: XCTestCase {
    private static var retainedServices: [CodexService] = []

    func testPresenceFrameSetsOfflineThenOnline() {
        let service = makeConnectedService()

        service.processIncomingWireText("{\"kind\":\"hostPresence\",\"online\":false,\"at\":1700000000000}")
        guard case .offline = service.hostPresence else {
            return XCTFail("Expected offline, got \(service.hostPresence)")
        }
        XCTAssertEqual(service.connectionPhase, .hostOffline)

        service.processIncomingWireText("{\"kind\":\"hostPresence\",\"online\":true,\"at\":1700000005000}")
        XCTAssertEqual(service.hostPresence, .online)
        XCTAssertEqual(service.connectionPhase, .connected)
    }

    func testHeartbeatNotificationMarksOnlineAndIsNotRoutedAsAMessage() {
        let service = makeConnectedService()
        service.hostPresence = .offline(since: Date(timeIntervalSince1970: 0))

        service.processIncomingText("{\"method\":\"djl/presence/heartbeat\",\"params\":{\"at\":1700000000000}}")

        XCTAssertEqual(service.hostPresence, .online)
        XCTAssertNotNil(service.lastHostActivityAt)
        XCTAssertTrue(service.messagesByThread.isEmpty)
        XCTAssertNil(service.lastErrorMessage)
    }

    func testSilenceFlipsToOfflineAndActivityFlipsBack() async {
        let service = makeConnectedService()
        service.hostPresenceSilenceOverrideNanoseconds = 20_000_000
        service.noteHostActivity()
        XCTAssertEqual(service.hostPresence, .online)

        try? await Task.sleep(nanoseconds: 250_000_000)

        guard case .offline = service.hostPresence else {
            return XCTFail("Expected silence to mark the host offline")
        }
        service.noteHostActivity()
        XCTAssertEqual(service.hostPresence, .online)
    }

    func testDisconnectResetsPresence() async {
        let service = makeConnectedService()
        service.noteHostActivity()

        await service.disconnect()

        XCTAssertEqual(service.hostPresence, .unknown)
        XCTAssertEqual(service.connectionPhase, .offline)
    }

    func testMalformedPresenceFrameIsIgnored() {
        let service = makeConnectedService()
        service.noteHostActivity()

        service.processIncomingWireText("{\"kind\":\"hostPresence\",\"online\":\"yes\"}")

        XCTAssertEqual(service.hostPresence, .online)
    }

    func testMacOfflineResolveCodeMapsToOfflineError() {
        XCTAssertTrue(CodexService.trustedResolveErrorCodeIsMacOffline("mac_offline"))
        XCTAssertTrue(CodexService.trustedResolveErrorCodeIsMacOffline("session_unavailable"))
        XCTAssertFalse(CodexService.trustedResolveErrorCodeIsMacOffline("phone_not_trusted"))
    }

    private func makeConnectedService() -> CodexService {
        let suiteName = "CodexServicePresenceTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        let service = CodexService(defaults: defaults)
        service.messagesByThread = [:]
        service.isConnected = true
        service.isInitialized = true
        // CodexService currently crashes while deallocating in unit-test environment.
        // Keep instances alive for process lifetime so assertions remain deterministic.
        Self.retainedServices.append(service)
        return service
    }
}
