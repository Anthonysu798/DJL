// FILE: SidebarAttentionProjectionTests.swift
// Purpose: Verifies supervision projection, ordering, actionable failures, and exact routing.
// Layer: Unit Test

import XCTest
@testable import DJL

final class SidebarAttentionProjectionTests: XCTestCase {
    @MainActor
    func testAttentionFixturesStayOutOfNormalThreadPersistence() {
        let fixtureService = CodexService()
        fixtureService.configureUITestFixtureIfNeeded(arguments: ["-CodexUITestsAttentionFixture"])

        XCTAssertTrue(fixtureService.suspendAutomaticMacScopedPersistence)
        XCTAssertEqual(
            Set(fixtureService.threads.map(\.id)),
            ["ui-question-thread", "ui-failed-thread", "ui-ready-thread"]
        )

        let cleanupService = CodexService()
        cleanupService.suspendAutomaticMacScopedPersistence = true
        cleanupService.threads = [
            thread("ui-question-thread", title: "Leaked fixture", date: Date()),
            thread("real-thread", title: "Real chat", date: Date()),
        ]
        cleanupService.configureUITestFixtureIfNeeded(arguments: [])

        XCTAssertEqual(cleanupService.threads.map(\.id), ["real-thread"])
    }

    func testProjectionIncludesApprovalsQuestionsFailuresAndCompletedRuns() {
        let now = Date()
        let approvalThread = thread("approval", title: "Approve deploy", date: now)
        let questionThread = thread("question", title: "Choose direction", date: now.addingTimeInterval(-10))
        let failedThread = thread("failed", title: "Fix build", date: now.addingTimeInterval(-20))
        let readyThread = thread("ready", title: "Review settings", date: now.addingTimeInterval(-30))
        let question = questionMessage(threadID: questionThread.id, date: now.addingTimeInterval(-10))
        let failure = CodexMessage(
            id: "failure-message",
            threadId: failedThread.id,
            role: .system,
            kind: .commandExecution,
            text: "Error: permission denied\n    at runner.js:42:7\n    at main.js:2:1",
            createdAt: now.addingTimeInterval(-20),
            turnId: "failure-turn",
            itemId: "failure-item",
            orderIndex: 2
        )
        let completed = CodexMessage(
            id: "ready-message",
            threadId: readyThread.id,
            role: .assistant,
            text: "All requested changes are complete.",
            createdAt: now.addingTimeInterval(-30),
            turnId: "ready-turn",
            itemId: "ready-item",
            orderIndex: 3
        )

        let items = SidebarAttentionProjection.project(
            threads: [approvalThread, questionThread, failedThread, readyThread],
            pendingApprovals: [approval(threadID: approvalThread.id)],
            messagesByThread: [
                questionThread.id: [question],
                failedThread.id: [failure],
                readyThread.id: [completed],
            ],
            readyThreadIDs: [readyThread.id],
            failedThreadIDs: [failedThread.id],
            goalsByThreadID: [:],
            activeThreadID: nil
        )

        XCTAssertEqual(items.map(\.kind), [.approval, .question, .failedRun, .completedRun])
        XCTAssertEqual(items.first(where: { $0.kind == .approval })?.target.approvalRequestID, "approval")
        XCTAssertEqual(items.first(where: { $0.kind == .question })?.target.messageID, question.id)
        XCTAssertEqual(items.first(where: { $0.kind == .failedRun })?.target.itemID, "failure-item")
        XCTAssertEqual(
            items.first(where: { $0.kind == .failedRun })?.summary,
            "Review the requested access or change this chat's access mode, then retry the run."
        )
    }

    func testUrgencyAndArrivalOrderBeatRecency() {
        let old = Date(timeIntervalSince1970: 100)
        let new = Date(timeIntervalSince1970: 200)
        let firstThread = thread("first", title: "First approval", date: old)
        let secondThread = thread("second", title: "Second approval", date: new)
        let questionThread = thread("question", title: "Question", date: new)

        let items = SidebarAttentionProjection.project(
            threads: [firstThread, secondThread, questionThread],
            pendingApprovals: [approval(id: "approval-1", threadID: firstThread.id), approval(id: "approval-2", threadID: secondThread.id)],
            messagesByThread: [questionThread.id: [questionMessage(threadID: questionThread.id, date: new)]],
            readyThreadIDs: [],
            failedThreadIDs: [],
            goalsByThreadID: [:],
            activeThreadID: nil
        )

        XCTAssertEqual(items.map(\.id), ["approval:approval-1", "approval:approval-2", "question:question-message"])
    }

    func testEmptyProjectionAndFilteringStayPredictable() {
        let thread = thread("quiet", title: "Quiet project", date: Date())
        let items = SidebarAttentionProjection.project(
            threads: [thread],
            pendingApprovals: [],
            messagesByThread: [:],
            readyThreadIDs: [],
            failedThreadIDs: [],
            goalsByThreadID: [:],
            activeThreadID: nil
        )

        XCTAssertTrue(items.isEmpty)
        XCTAssertTrue(SidebarAttentionProjection.filtered(items, query: "anything").isEmpty)
    }

    func testAttentionTargetResolvesMessageThenItemThenTurn() {
        let messages = [
            CodexMessage(id: "first", threadId: "thread", role: .assistant, text: "One", turnId: "turn", itemId: "item-1", orderIndex: 1),
            CodexMessage(id: "second", threadId: "thread", role: .assistant, text: "Two", turnId: "turn", itemId: "item-2", orderIndex: 2),
        ]

        XCTAssertEqual(
            AttentionNavigationTarget(threadID: "thread", turnID: "turn", itemID: "item-1", messageID: "second")
                .resolvedMessageID(in: messages),
            "second"
        )
        XCTAssertEqual(
            AttentionNavigationTarget(threadID: "thread", turnID: "turn", itemID: "item-1")
                .resolvedMessageID(in: messages),
            "first"
        )
        XCTAssertEqual(
            AttentionNavigationTarget(threadID: "thread", turnID: "turn")
                .resolvedMessageID(in: messages),
            "second"
        )
    }

    func testDeepLinkPreservesExactTurnItemAndMessage() throws {
        let url = try XCTUnwrap(URL(string: "djl://thread/thread%201?turnId=turn-7&itemId=item-8&messageId=message-9"))
        let destination = try XCTUnwrap(DJLDeepLinkParser.destination(from: url))

        XCTAssertEqual(destination.target.threadID, "thread 1")
        XCTAssertEqual(destination.target.turnID, "turn-7")
        XCTAssertEqual(destination.target.itemID, "item-8")
        XCTAssertEqual(destination.target.messageID, "message-9")
        XCTAssertNil(DJLDeepLinkParser.destination(from: URL(string: "https://example.com/thread/1")!))
    }

    func testFooterReplacesRawStackTraceWithActionableCopy() {
        let raw = "Error: build failed\n    at runner.js:42:7\n    at pipeline.js:10:2"
        XCTAssertEqual(
            TurnFooterErrorFilter.visibleFooterMessage(from: raw),
            "Open the chat to inspect the failing check, fix it, and retry."
        )
    }

    private func thread(_ id: String, title: String, date: Date) -> CodexThread {
        CodexThread(id: id, title: title, createdAt: date, updatedAt: date, cwd: "/workspace/\(id)")
    }

    private func approval(id: String = "approval", threadID: String) -> CodexApprovalRequest {
        CodexApprovalRequest(
            id: id,
            requestID: .string(id),
            method: "item/commandExecution/requestApproval",
            command: "deploy --production",
            reason: "Deploy the reviewed build",
            threadId: threadID,
            turnId: "approval-turn",
            params: .object(["itemId": .string("approval-item")])
        )
    }

    private func questionMessage(threadID: String, date: Date) -> CodexMessage {
        CodexMessage(
            id: "question-message",
            threadId: threadID,
            role: .system,
            kind: .userInputPrompt,
            text: "Which direction should we take?",
            createdAt: date,
            turnId: "question-turn",
            itemId: "question-item",
            structuredUserInputRequest: CodexStructuredUserInputRequest(
                requestID: .string("question-request"),
                questions: [
                    CodexStructuredUserInputQuestion(
                        id: "direction",
                        header: "Direction",
                        question: "Which direction should we take?",
                        isOther: false,
                        isSecret: false,
                        options: []
                    ),
                ]
            ),
            orderIndex: 4
        )
    }
}
