// FILE: TurnGitBranchSelectorTests.swift
// Purpose: Verifies new branch creation names normalize toward the djl/ prefix without double-prefixing.
// Layer: Unit Test
// Exports: TurnGitBranchSelectorTests
// Depends on: XCTest, DJL

import XCTest
@testable import DJL

final class TurnGitBranchSelectorTests: XCTestCase {
    func testNormalizesCreatedBranchNamesTowardDJLPrefix() {
        XCTAssertEqual(djlNormalizedCreatedBranchName("foo"), "djl/foo")
        XCTAssertEqual(djlNormalizedCreatedBranchName("djl/foo"), "djl/foo")
        XCTAssertEqual(djlNormalizedCreatedBranchName("  foo  "), "djl/foo")
    }

    func testNormalizesEmptyBranchNamesToEmptyString() {
        XCTAssertEqual(djlNormalizedCreatedBranchName("   "), "")
    }

    func testCurrentBranchSelectionDisablesCheckedOutElsewhereRowsWhenWorktreePathIsMissing() {
        XCTAssertTrue(
            djlCurrentBranchSelectionIsDisabled(
                branch: "djl/feature-a",
                currentBranch: "main",
                gitBranchesCheckedOutElsewhere: ["djl/feature-a"],
                gitWorktreePathsByBranch: [:],
                allowsSelectingCurrentBranch: true
            )
        )
    }

    func testCurrentBranchSelectionKeepsCheckedOutElsewhereRowsEnabledWhenWorktreePathExists() {
        XCTAssertFalse(
            djlCurrentBranchSelectionIsDisabled(
                branch: "djl/feature-a",
                currentBranch: "main",
                gitBranchesCheckedOutElsewhere: ["djl/feature-a"],
                gitWorktreePathsByBranch: ["djl/feature-a": "/tmp/djl-feature-a"],
                allowsSelectingCurrentBranch: true
            )
        )
    }

    func testSelectableDefaultBranchReturnsNilWhenDefaultIsNotLocal() {
        XCTAssertNil(
            djlSelectableDefaultBranch(
                defaultBranch: "main",
                availableGitBranchTargets: ["djl/feature-a"]
            )
        )
    }

    func testSelectableDefaultBranchReturnsDefaultWhenItIsLocal() {
        XCTAssertEqual(
            djlSelectableDefaultBranch(
                defaultBranch: "main",
                availableGitBranchTargets: ["main", "djl/feature-a"]
            ),
            "main"
        )
    }
}
