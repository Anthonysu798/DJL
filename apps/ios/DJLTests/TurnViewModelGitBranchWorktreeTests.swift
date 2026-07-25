// FILE: TurnViewModelGitBranchWorktreeTests.swift
// Purpose: Verifies worktree-backed branches are exposed to the UI only when Git reports them as checked out elsewhere.
// Layer: Unit Test
// Exports: TurnViewModelGitBranchWorktreeTests
// Depends on: XCTest, DJL

import XCTest
@testable import DJL

@MainActor
final class TurnViewModelGitBranchWorktreeTests: XCTestCase {
    func testWorktreePathResolvesOnlyForBranchesCheckedOutElsewhere() {
        let viewModel = TurnViewModel()
        viewModel.gitBranchesCheckedOutElsewhere = ["djl/feature-a"]
        viewModel.gitWorktreePathsByBranch = [
            "djl/feature-a": "/tmp/djl-feature-a",
            "main": "/tmp/djl-main"
        ]

        XCTAssertEqual(
            viewModel.worktreePathForCheckedOutElsewhereBranch("djl/feature-a"),
            "/tmp/djl-feature-a"
        )
        XCTAssertNil(viewModel.worktreePathForCheckedOutElsewhereBranch("main"))
        XCTAssertNil(viewModel.worktreePathForCheckedOutElsewhereBranch("djl/missing"))
    }

    func testApplyGitBranchTargetsStoresTrueLocalCheckoutPath() {
        let viewModel = TurnViewModel()
        let result = GitBranchesWithStatusResult(
            from: [
                "branches": .array([.string("main")]),
                "branchesCheckedOutElsewhere": .array([]),
                "worktreePathByBranch": .object([:]),
                "localCheckoutPath": .string("/tmp/djl-local/phodex-bridge"),
                "current": .string("main"),
                "default": .string("main"),
            ]
        )

        viewModel.applyGitBranchTargets(result)

        XCTAssertEqual(viewModel.gitLocalCheckoutPath, "/tmp/djl-local/phodex-bridge")
    }

    func testApplyGitBranchTargetsKeepsSelectedBaseBranchEmptyWhenDefaultIsRemoteOnly() {
        let viewModel = TurnViewModel()
        let result = GitBranchesWithStatusResult(
            from: [
                "branches": .array([.string("djl/topic")]),
                "branchesCheckedOutElsewhere": .array([]),
                "worktreePathByBranch": .object([:]),
                "localCheckoutPath": .string("/tmp/djl-local/phodex-bridge"),
                "current": .string("djl/topic"),
                "default": .string("main"),
            ]
        )

        viewModel.applyGitBranchTargets(result)

        XCTAssertEqual(viewModel.gitDefaultBranch, "main")
        XCTAssertEqual(viewModel.selectedGitBaseBranch, "")
    }

    func testApplyGitBranchTargetsPreservesValidLocalBaseBranchSelection() {
        let viewModel = TurnViewModel()
        viewModel.selectedGitBaseBranch = "release/1.0"
        let result = GitBranchesWithStatusResult(
            from: [
                "branches": .array([.string("main"), .string("release/1.0"), .string("djl/topic")]),
                "branchesCheckedOutElsewhere": .array([]),
                "worktreePathByBranch": .object([:]),
                "localCheckoutPath": .string("/tmp/djl-local/phodex-bridge"),
                "current": .string("djl/topic"),
                "default": .string("main"),
            ]
        )

        viewModel.applyGitBranchTargets(result)

        XCTAssertEqual(viewModel.selectedGitBaseBranch, "release/1.0")
    }
}
