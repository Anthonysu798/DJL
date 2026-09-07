// FILE: CodexServiceDesktopTerminalTests.swift
// Purpose: Verifies phone terminals attach to desktop shells and mirror their events.
// Layer: Unit Test
// Exports: CodexServiceDesktopTerminalTests
// Depends on: XCTest, DJL

import XCTest
@testable import DJL

@MainActor
final class CodexServiceDesktopTerminalTests: XCTestCase {
    private static var retainedServices: [CodexService] = []

    func testOpenSeedsBufferFromDesktopSnapshot() async throws {
        let service = makeService()
        var captured: [(method: String, params: JSONValue?)] = []
        service.requestTransportOverride = { method, params in
            captured.append((method, params))
            return RPCMessage(
                id: .string("r1"),
                result: .object([
                    "snapshot": .object([
                        "threadId": .string("thread-1"),
                        "terminalId": .string("default"),
                        "cwd": .string("/work"),
                        "status": .string("running"),
                        "history": .string("$ ls\n"),
                        "replayPreamble": .string("\u{1B}[?2004h"),
                    ]),
                ]),
                includeJSONRPC: false
            )
        }

        try await service.openDesktopTerminal(
            terminalId: "term-1",
            threadId: "thread-1",
            cwd: nil,
            cols: 80,
            rows: 24
        )

        XCTAssertEqual(captured.first?.method, "djl/terminal/open")
        let params = captured.first?.params?.objectValue
        XCTAssertEqual(params?["threadId"], .string("thread-1"))
        XCTAssertEqual(params?["terminalId"], .string("default"))
        XCTAssertEqual(params?["cols"], .integer(80))
        XCTAssertNil(params?["cwd"])

        let snapshot = service.terminalSnapshot(for: "term-1")
        XCTAssertEqual(snapshot.status, .running)
        XCTAssertEqual(snapshot.cwd, "/work")
        XCTAssertEqual(snapshot.buffer, "\u{1B}[?2004h$ ls\n")
        XCTAssertTrue(snapshot.bracketedPasteEnabled)
        XCTAssertEqual(service.desktopTerminalBinding(for: "term-1")?.terminalId, "default")
    }

    func testOutputAppendsAndQueuesAck() async throws {
        let service = try await attachedService()

        service.handleNotification(
            method: "djl/terminal/event",
            params: .object([
                "threadId": .string("thread-1"),
                "terminalId": .string("default"),
                "type": .string("output"),
                "createdAt": .string("x"),
                "data": .string("hello"),
                "byteLength": .integer(5),
            ])
        )

        XCTAssertEqual(service.terminalSnapshot(for: "term-1").buffer, "$ hello")
        XCTAssertEqual(service.desktopTerminalPendingAckBytes["term-1"], 5)

        var acked: JSONValue?
        service.requestTransportOverride = { method, params in
            if method == "djl/terminal/ack" { acked = params }
            return RPCMessage(id: .string("r"), result: .object([:]), includeJSONRPC: false)
        }
        service.flushDesktopTerminalAcks()
        await Task.yield()
        await Task.yield()

        XCTAssertEqual(acked?.objectValue?["bytes"], .integer(5))
        XCTAssertEqual(acked?.objectValue?["terminalId"], .string("default"))
        XCTAssertNil(service.desktopTerminalPendingAckBytes["term-1"])
    }

    func testStartedReplacesBufferWithNewInstance() async throws {
        let service = try await attachedService()
        let previousInstanceId = service.terminalSnapshot(for: "term-1").instanceId

        service.handleNotification(
            method: "djl/terminal/event",
            params: .object([
                "threadId": .string("thread-1"),
                "terminalId": .string("default"),
                "type": .string("started"),
                "createdAt": .string("x"),
                "snapshot": .object([
                    "cwd": .string("/work"),
                    "status": .string("running"),
                    "history": .string("fresh\n"),
                ]),
            ])
        )

        let snapshot = service.terminalSnapshot(for: "term-1")
        XCTAssertEqual(snapshot.buffer, "fresh\n")
        XCTAssertNotEqual(snapshot.instanceId, previousInstanceId)
        XCTAssertEqual(snapshot.status, .running)
    }

    func testExitedAndErrorEventsMapToStatuses() async throws {
        let service = try await attachedService()

        service.handleNotification(
            method: "djl/terminal/event",
            params: .object([
                "threadId": .string("thread-1"),
                "terminalId": .string("default"),
                "type": .string("error"),
                "createdAt": .string("x"),
                "message": .string("boom"),
            ])
        )
        XCTAssertEqual(service.terminalSnapshot(for: "term-1").status, .error)
        XCTAssertEqual(service.terminalSnapshot(for: "term-1").errorMessage, "boom")

        service.handleNotification(
            method: "djl/terminal/event",
            params: .object([
                "threadId": .string("thread-1"),
                "terminalId": .string("default"),
                "type": .string("exited"),
                "createdAt": .string("x"),
                "exitCode": .integer(0),
                "exitSignal": .null,
            ])
        )
        XCTAssertEqual(service.terminalSnapshot(for: "term-1").status, .exited)
    }

    func testEventsForUnboundTerminalsAreIgnored() async throws {
        let service = try await attachedService()

        service.handleNotification(
            method: "djl/terminal/event",
            params: .object([
                "threadId": .string("thread-2"),
                "terminalId": .string("default"),
                "type": .string("output"),
                "createdAt": .string("x"),
                "data": .string("other"),
            ])
        )

        XCTAssertEqual(service.terminalSnapshot(for: "term-1").buffer, "$ ")
    }

    func testHostOfflineMarksTerminalsAndRemembersReattach() async throws {
        let service = try await attachedService()

        service.markDesktopTerminalsOffline()

        let snapshot = service.terminalSnapshot(for: "term-1")
        XCTAssertEqual(snapshot.status, .error)
        XCTAssertEqual(snapshot.errorMessage, "Device offline")
        XCTAssertTrue(service.desktopTerminalsAwaitingReattach.contains("term-1"))
    }

    func testCloseDetachesWithoutTouchingTheDesktopShell() async throws {
        let service = try await attachedService()
        var methods: [String] = []
        service.requestTransportOverride = { method, _ in
            methods.append(method)
            return RPCMessage(id: .string("r"), result: .object([:]), includeJSONRPC: false)
        }

        try await service.closeTerminal(terminalId: "term-1")

        XCTAssertEqual(methods, ["djl/terminal/close"])
        XCTAssertNil(service.desktopTerminalBinding(for: "term-1"))
        XCTAssertEqual(service.terminalSnapshot(for: "term-1").status, .closed)
    }

    // MARK: - Helpers

    private func attachedService() async throws -> CodexService {
        let service = makeService()
        service.requestTransportOverride = { _, _ in
            RPCMessage(
                id: .string("r1"),
                result: .object([
                    "snapshot": .object([
                        "cwd": .string("/work"),
                        "status": .string("running"),
                        "history": .string("$ "),
                    ]),
                ]),
                includeJSONRPC: false
            )
        }
        try await service.openDesktopTerminal(
            terminalId: "term-1",
            threadId: "thread-1",
            cwd: "/work",
            cols: 80,
            rows: 24
        )
        return service
    }

    private func makeService() -> CodexService {
        let suiteName = "CodexServiceDesktopTerminalTests.\(UUID().uuidString)"
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
