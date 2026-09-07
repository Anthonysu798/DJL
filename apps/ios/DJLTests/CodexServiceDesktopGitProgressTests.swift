// FILE: CodexServiceDesktopGitProgressTests.swift
// Purpose: Verifies desktop git action progress notifications drive the phone's progress model.
// Layer: Unit Test
// Exports: CodexServiceDesktopGitProgressTests
// Depends on: XCTest, DJL

import XCTest
@testable import DJL

@MainActor
final class CodexServiceDesktopGitProgressTests: XCTestCase {
    private static var retainedServices: [CodexService] = []

    func testDesktopActionLifecycleDrivesProgress() {
        let service = makeService()

        service.handleNotification(
            method: "djl/git/desktopActionProgress",
            params: .object([
                "actionId": .string("g1"),
                "cwd": .string("/w"),
                "action": .string("commit_push"),
                "kind": .string("action_started"),
                "phases": .array([.string("commit"), .string("push")]),
            ])
        )
        let started = service.desktopGitActionProgress(for: "/w")
        XCTAssertEqual(started?.action, .commitAndPush)
        XCTAssertEqual(started?.plannedPhases, [.commit, .push])

        service.handleNotification(
            method: "djl/git/desktopActionProgress",
            params: .object([
                "actionId": .string("g1"),
                "cwd": .string("/w"),
                "action": .string("commit_push"),
                "kind": .string("phase_started"),
                "phase": .string("commit"),
                "label": .string("Committing"),
            ])
        )
        service.handleNotification(
            method: "djl/git/desktopActionProgress",
            params: .object([
                "actionId": .string("g1"),
                "cwd": .string("/w"),
                "action": .string("commit_push"),
                "kind": .string("phase_started"),
                "phase": .string("push"),
                "label": .string("Pushing"),
            ])
        )
        let pushing = service.desktopGitActionProgress(for: "/w")
        XCTAssertEqual(pushing?.currentPhase, .push)
        XCTAssertEqual(pushing?.status(for: .commit), .completed)

        service.handleNotification(
            method: "djl/git/desktopActionProgress",
            params: .object([
                "actionId": .string("g1"),
                "cwd": .string("/w"),
                "action": .string("commit_push"),
                "kind": .string("action_finished"),
            ])
        )
        XCTAssertNil(service.desktopGitActionProgress(for: "/w"))
        XCTAssertNil(service.desktopGitActionProgress(for: nil))
    }

    func testUnknownActionMidwayStillShowsASpinner() {
        let service = makeService()

        service.handleNotification(
            method: "djl/git/desktopActionProgress",
            params: .object([
                "actionId": .string("g2"),
                "cwd": .string("/w"),
                "action": .string("push"),
                "kind": .string("hook_output"),
                "text": .string("running hooks"),
            ])
        )

        let progress = service.desktopGitActionProgress(for: "/w")
        XCTAssertEqual(progress?.action, .push)
        XCTAssertEqual(progress?.plannedPhases, [])
    }

    private func makeService() -> CodexService {
        let suiteName = "CodexServiceDesktopGitProgressTests.\(UUID().uuidString)"
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
