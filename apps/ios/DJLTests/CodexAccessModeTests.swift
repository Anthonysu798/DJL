// FILE: CodexAccessModeTests.swift
// Purpose: Guards the runtime access-mode strings used by fork/send fallbacks.
// Layer: Unit Test
// Exports: CodexAccessModeTests
// Depends on: XCTest, DJL

import XCTest
@testable import DJL

@MainActor
final class CodexAccessModeTests: XCTestCase {
    func testSandboxLegacyValuesMatchRuntimeEnums() {
        XCTAssertEqual(CodexAccessMode.onRequest.sandboxLegacyValue, "workspace-write")
        XCTAssertEqual(CodexAccessMode.autoReview.sandboxLegacyValue, "workspace-write")
        XCTAssertEqual(CodexAccessMode.fullAccess.sandboxLegacyValue, "danger-full-access")
    }

    func testAutoReviewKeepsOnRequestApprovalPolicy() {
        XCTAssertEqual(CodexAccessMode.autoReview.approvalPolicyCandidates, ["on-request", "onRequest"])
    }

    func testApprovalReviewersMatchAccessModeIntent() {
        XCTAssertEqual(CodexAccessMode.onRequest.approvalsReviewerCandidates, ["user", nil])
        XCTAssertEqual(
            CodexAccessMode.autoReview.approvalsReviewerCandidates,
            ["auto_review", "guardian_subagent"]
        )
        XCTAssertEqual(CodexAccessMode.fullAccess.approvalsReviewerCandidates, ["user", nil])
    }

    func testElectronRuntimeModesRoundTrip() {
        XCTAssertEqual(CodexAccessMode.onRequest.electronRuntimeMode, "approval-required")
        XCTAssertEqual(CodexAccessMode.autoReview.electronRuntimeMode, "auto-approval")
        XCTAssertEqual(CodexAccessMode.fullAccess.electronRuntimeMode, "full-access")
        XCTAssertEqual(CodexAccessMode(electronRuntimeMode: "approval-required"), .onRequest)
        XCTAssertEqual(CodexAccessMode(electronRuntimeMode: "auto-approval"), .autoReview)
        XCTAssertEqual(CodexAccessMode(electronRuntimeMode: "full-access"), .fullAccess)
        XCTAssertNil(CodexAccessMode(electronRuntimeMode: "accept-edits"))
    }

    func testThreadDecodesElectronRuntimeMode() throws {
        let data = try XCTUnwrap(#"{"id":"thread-1","runtimeMode":"full-access"}"#.data(using: .utf8))
        let thread = try JSONDecoder().decode(CodexThread.self, from: data)

        XCTAssertEqual(thread.runtimeMode, "full-access")
    }

    func testInitializeLearnsElectronRuntimeModeSyncCapability() {
        let service = CodexService()
        let response = RPCMessage(
            id: .string("initialize-1"),
            result: .object([
                "capabilities": .object([
                    "djlThreadRuntimeModeSync": .bool(true),
                ]),
            ]),
            includeJSONRPC: false
        )

        service.learnThreadRuntimeModeSyncSupport(from: response)

        XCTAssertTrue(service.supportsThreadRuntimeModeSync)
    }
}
