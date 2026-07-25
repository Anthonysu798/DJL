// FILE: CodexService+UITestFixtures.swift
// Purpose: Seeds deterministic in-memory supervision states for focused UI tests.
// Layer: Test Support

import Foundation

#if DEBUG
extension CodexService {
    func configureUITestFixtureIfNeeded(arguments: [String] = ProcessInfo.processInfo.arguments) {
        if arguments.contains("-CodexUITestsAttentionFixture") {
            // Fixture state must never replace the device's encrypted thread snapshot.
            // Keep persistence suspended for the lifetime of this test process so
            // subsequent fixture mutations cannot leak into a normal app launch.
            suspendAutomaticMacScopedPersistence = true
            configureAttentionUITestFixture()
            return
        }
        if arguments.contains("-CodexUITestsEmptyAttentionFixture") {
            suspendAutomaticMacScopedPersistence = true
            configureEmptyAttentionUITestFixture()
            return
        }

        removeLeakedAttentionUITestThreadsIfNeeded()
    }

    // Cleans snapshots written by development builds from before fixture
    // persistence was isolated. The reserved ids cannot overlap real threads.
    private func removeLeakedAttentionUITestThreadsIfNeeded() {
        let leakedThreadIDs: Set<String> = [
            "ui-question-thread",
            "ui-failed-thread",
            "ui-ready-thread",
            "ui-empty-thread",
        ]
        guard threads.contains(where: { leakedThreadIDs.contains($0.id) }) else {
            return
        }

        threads.removeAll { leakedThreadIDs.contains($0.id) }
        for threadID in leakedThreadIDs {
            messagesByThread.removeValue(forKey: threadID)
            messageRevisionByThread.removeValue(forKey: threadID)
            failedThreadIDs.remove(threadID)
            readyThreadIDs.remove(threadID)
            latestTurnTerminalStateByThread.removeValue(forKey: threadID)
            goalByThreadID.removeValue(forKey: threadID)
            hydratedThreadIDs.remove(threadID)
            initialTurnsLoadedByThreadID.remove(threadID)
            removeThreadTimelineState(for: threadID)
        }
    }

    private func configureAttentionUITestFixture() {
        let now = Date()
        let questionThread = CodexThread(
            id: "ui-question-thread",
            title: "Release planning",
            preview: "Choose a release track",
            createdAt: now.addingTimeInterval(-120),
            updatedAt: now,
            cwd: "/Users/test/DJL"
        )
        let failedThread = CodexThread(
            id: "ui-failed-thread",
            title: "Fix CI",
            preview: "Investigate the build",
            createdAt: now.addingTimeInterval(-240),
            updatedAt: now.addingTimeInterval(-30),
            cwd: "/Users/test/DJL"
        )
        let readyThread = CodexThread(
            id: "ui-ready-thread",
            title: "Polish settings",
            preview: "Review completed work",
            createdAt: now.addingTimeInterval(-360),
            updatedAt: now.addingTimeInterval(-60),
            cwd: "/Users/test/DJL"
        )

        let question = CodexMessage(
            id: "ui-question-message",
            threadId: questionThread.id,
            role: .system,
            kind: .userInputPrompt,
            text: "Release\nWhich release track should DJL use?",
            createdAt: now,
            turnId: "ui-question-turn",
            itemId: "ui-question-item",
            structuredUserInputRequest: CodexStructuredUserInputRequest(
                requestID: .string("ui-question-request"),
                questions: [
                    CodexStructuredUserInputQuestion(
                        id: "release-track",
                        header: "Release",
                        question: "Which release track should DJL use?",
                        isOther: false,
                        isSecret: false,
                        options: [
                            CodexStructuredUserInputOption(label: "Stable", description: "Ship broadly"),
                            CodexStructuredUserInputOption(label: "Beta", description: "Stage the rollout"),
                        ]
                    ),
                ]
            ),
            orderIndex: 1
        )
        let failed = CodexMessage(
            id: "ui-failed-message",
            threadId: failedThread.id,
            role: .system,
            kind: .commandExecution,
            text: "Error: build failed\n    at runner.js:42:7\n    at pipeline.js:10:2",
            createdAt: now.addingTimeInterval(-30),
            turnId: "ui-failed-turn",
            itemId: "ui-failed-item",
            orderIndex: 1
        )
        let completed = CodexMessage(
            id: "ui-ready-message",
            threadId: readyThread.id,
            role: .assistant,
            text: "Settings are polished and ready for review.",
            createdAt: now.addingTimeInterval(-60),
            turnId: "ui-ready-turn",
            itemId: "ui-ready-item",
            orderIndex: 1
        )

        threads = [questionThread, failedThread, readyThread]
        messagesByThread = [
            questionThread.id: [question],
            failedThread.id: [failed],
            readyThread.id: [completed],
        ]
        messageRevisionByThread = [questionThread.id: 1, failedThread.id: 1, readyThread.id: 1]
        failedThreadIDs = [failedThread.id]
        readyThreadIDs = [readyThread.id]
        latestTurnTerminalStateByThread = [failedThread.id: .failed, readyThread.id: .completed]
        terminalStateByTurnID = ["ui-failed-turn": .failed, "ui-ready-turn": .completed]
        hydratedThreadIDs = Set(threads.map(\.id))
        initialTurnsLoadedByThreadID = Set(threads.map(\.id))
        isConnected = false
        isInitialized = false
        activeThreadId = nil
        for thread in threads {
            refreshThreadTimelineState(for: thread.id)
        }
    }

    private func configureEmptyAttentionUITestFixture() {
        let thread = CodexThread(
            id: "ui-empty-thread",
            title: "Quiet project",
            preview: "No pending work",
            createdAt: Date(),
            updatedAt: Date(),
            cwd: "/Users/test/DJL"
        )
        threads = [thread]
        messagesByThread = [:]
        messageRevisionByThread = [:]
        pendingApprovals = []
        failedThreadIDs = []
        readyThreadIDs = []
        goalByThreadID = [:]
        hydratedThreadIDs = [thread.id]
        initialTurnsLoadedByThreadID = [thread.id]
        isConnected = false
        isInitialized = false
        activeThreadId = nil
        refreshThreadTimelineState(for: thread.id)
    }
}
#endif
