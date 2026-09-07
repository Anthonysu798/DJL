// FILE: CodexPlanModeTests.swift
// Purpose: Verifies plan-mode turn/start payloads and inline timeline state for plan events.
// Layer: Unit Test
// Exports: CodexPlanModeTests
// Depends on: XCTest, DJL

import XCTest
@testable import DJL

@MainActor
final class CodexPlanModeTests: XCTestCase {
    private static var retainedServices: [CodexService] = []
    private static var retainedViewModels: [TurnViewModel] = []

    func testBuildCollaborationModePayloadUsesBuiltInPlanInstructionsByDefault() throws {
        let service = makeService()
        service.availableModels = [makeModel()]
        service.setSelectedModelId("gpt-5-codex")

        let payload = try service.buildCollaborationModePayload(
            for: .plan,
            threadId: "thread-plan"
        )

        let instructions = payload?
            .objectValue?["settings"]?
            .objectValue?["developer_instructions"]?
            .stringValue
        XCTAssertEqual(payload?.objectValue?["mode"]?.stringValue, "plan")
        XCTAssertNil(instructions)
    }

    func testBuildCollaborationModePayloadUsesCompatibilityInstructionsAfterFallback() throws {
        let service = makeService()
        service.availableModels = [makeModel()]
        service.setSelectedModelId("gpt-5-codex")
        service.markCompatibilityPlanFallback(for: "thread-plan")

        let payload = try service.buildCollaborationModePayload(
            for: .plan,
            threadId: "thread-plan"
        )

        let instructions = payload?
            .objectValue?["settings"]?
            .objectValue?["developer_instructions"]?
            .stringValue
        XCTAssertEqual(payload?.objectValue?["mode"]?.stringValue, "plan")
        XCTAssertTrue(instructions?.contains("request_user_input") == true)
        XCTAssertTrue(instructions?.contains("<proposed_plan>") == true)
    }

    func testCompatibilityFallbackCanOverrideNativePlanThread() {
        let service = makeService()

        service.markNativePlanSession(for: "thread-plan")
        XCTAssertTrue(service.currentPlanSessionSource(for: "thread-plan")?.isNative == true)

        service.markCompatibilityPlanFallback(for: "thread-plan")

        XCTAssertEqual(service.currentPlanSessionSource(for: "thread-plan"), .compatibilityFallback)
    }

    func testCompatibilityFallbackStaysStickyAcrossNewPlanTurnStarts() async throws {
        let service = makeService()
        service.isConnected = true
        service.supportsTurnCollaborationMode = true
        service.availableModels = [makeModel()]
        service.setSelectedModelId("gpt-5-codex")
        service.markCompatibilityPlanFallback(for: "thread-plan")

        var capturedTurnStartParams: JSONValue?
        service.requestTransportOverride = { method, params in
            if method == "turn/start" {
                capturedTurnStartParams = params
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "turn": .object([
                            "id": .string("turn-live"),
                            "status": .string("inProgress"),
                            "items": .array([]),
                            "error": .null,
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            }

            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([:]),
                includeJSONRPC: false
            )
        }

        try await service.startTurn(
            userInput: "Keep planning",
            threadId: "thread-plan",
            shouldAppendUserMessage: false,
            collaborationMode: .plan
        )

        let instructions = capturedTurnStartParams?
            .objectValue?["collaborationMode"]?
            .objectValue?["settings"]?
            .objectValue?["developer_instructions"]?
            .stringValue

        XCTAssertEqual(service.currentPlanSessionSource(for: "thread-plan"), .compatibilityFallback)
        XCTAssertTrue(instructions?.contains("request_user_input") == true)
    }

    func testSubmittingInferredQuestionnaireDoesNotDowngradeConfirmedNativePlanThread() async throws {
        let service = makeService()
        service.isConnected = true
        service.supportsTurnCollaborationMode = true
        service.availableModels = [makeModel()]
        service.setSelectedModelId("gpt-5-codex")
        service.markNativePlanSession(for: "thread-plan")

        var capturedTurnSteerParams: JSONValue?
        service.requestTransportOverride = { method, params in
            if method == "turn/steer" {
                capturedTurnSteerParams = params
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object(["turnId": .string("turn-live")]),
                    includeJSONRPC: false
                )
            }

            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([:]),
                includeJSONRPC: false
            )
        }

        service.setActiveTurnID("turn-live", for: "thread-plan")

        try await service.submitInferredPlanQuestionnaireResponse(
            threadId: "thread-plan",
            questions: [
                CodexStructuredUserInputQuestion(
                    id: "scope",
                    header: "Scope",
                    question: "What scope should we use?",
                    isOther: false,
                    isSecret: false,
                    selectionLimit: 1,
                    options: [
                        CodexStructuredUserInputOption(label: "Ship now", description: ""),
                        CodexStructuredUserInputOption(label: "Stage behind a flag", description: ""),
                    ]
                ),
            ],
            answersByQuestionID: [
                "scope": ["Ship now"],
            ]
        )

        XCTAssertTrue(capturedTurnSteerParams != nil)
        XCTAssertTrue(service.currentPlanSessionSource(for: "thread-plan")?.isNative == true)
    }

    func testRuntimeSupportsPlanCollaborationModeUsesOfficialCollaborationModeListShape() async {
        let service = makeService()

        service.requestTransportOverride = { method, _ in
            XCTAssertEqual(method, "collaborationMode/list")
            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([
                    "data": .array([
                        .object(["mode": .string("default")]),
                        .object(["mode": .string("plan")]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        }

        let isSupported = await service.runtimeSupportsPlanCollaborationMode()
        XCTAssertTrue(isSupported)
    }

    func testRuntimeSupportsPlanCollaborationModeStillAcceptsLegacyModesShape() async {
        let service = makeService()

        service.requestTransportOverride = { method, _ in
            XCTAssertEqual(method, "collaborationMode/list")
            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([
                    "modes": .array([
                        .object(["mode": .string("default")]),
                        .object(["mode": .string("plan")]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        }

        let isSupported = await service.runtimeSupportsPlanCollaborationMode()
        XCTAssertTrue(isSupported)
    }

    func testEmptyTurnPlanUpdateDoesNotCreateTimelineCard() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"

        service.handleNotification(
            method: "turn/plan/updated",
            params: .object([
                "threadId": .string(threadID),
                "turnId": .string(turnID),
                "plan": .array([]),
            ])
        )

        XCTAssertTrue(service.messages(for: threadID).filter { $0.kind == .plan }.isEmpty)
    }

    func testEmptyTurnPlanUpdatePreservesCompletedPlanResult() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"

        service.upsertPlanMessage(
            threadId: threadID,
            turnId: turnID,
            itemId: "plan-result",
            text: "1. Inspect the flow\n2. Implement the fix",
            isStreaming: false,
            planPresentation: .resultReady
        )

        service.handleNotification(
            method: "turn/plan/updated",
            params: .object([
                "threadId": .string(threadID),
                "turnId": .string(turnID),
                "plan": .array([]),
            ])
        )

        let planMessages = service.messages(for: threadID).filter { $0.kind == .plan }
        XCTAssertEqual(planMessages.count, 1)
        XCTAssertEqual(planMessages[0].resolvedPlanPresentation, .resultReady)
    }

    func testEmptyPlanItemLifecycleDoesNotCreateTimelineCard() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"

        service.handleNotification(
            method: "item/started",
            params: .object([
                "threadId": .string(threadID),
                "turnId": .string(turnID),
                "item": .object([
                    "id": .string("empty-plan"),
                    "type": .string("todoList"),
                    "content": .array([]),
                    "plan": .array([]),
                ]),
            ])
        )

        XCTAssertTrue(service.messages(for: threadID).filter { $0.kind == .plan }.isEmpty)
    }

    func testEmptyCompletedPlanItemFinalizesExistingStreamedPlan() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let itemID = "plan-\(UUID().uuidString)"
        let streamedText = "1. Inspect the mirror\n2. Preserve the timeline"

        service.handleNotification(
            method: "item/plan/delta",
            params: .object([
                "threadId": .string(threadID),
                "turnId": .string(turnID),
                "itemId": .string(itemID),
                "delta": .string(streamedText),
            ])
        )

        service.handleNotification(
            method: "item/completed",
            params: .object([
                "threadId": .string(threadID),
                "turnId": .string(turnID),
                "item": .object([
                    "id": .string(itemID),
                    "type": .string("plan"),
                    "content": .array([]),
                ]),
            ])
        )

        let planMessages = service.messages(for: threadID).filter { $0.kind == .plan }
        XCTAssertEqual(planMessages.count, 1)
        XCTAssertEqual(planMessages[0].text, streamedText)
        XCTAssertFalse(planMessages[0].isStreaming)
        XCTAssertEqual(planMessages[0].resolvedPlanPresentation, .resultCompletedItem)
    }

    func testUnmarkedTodoListItemUsesProgressPresentation() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"

        service.handleNotification(
            method: "item/started",
            params: .object([
                "threadId": .string(threadID),
                "turnId": .string(turnID),
                "item": .object([
                    "id": .string("structured-plan"),
                    "type": .string("todoList"),
                    "explanation": .string("Keep the mirror stable."),
                    "plan": .array([
                        .object([
                            "step": .string("Reconcile live state"),
                            "status": .string("inProgress"),
                        ]),
                    ]),
                ]),
            ])
        )

        let planMessages = service.messages(for: threadID).filter { $0.kind == .plan }
        XCTAssertEqual(planMessages.count, 1)
        XCTAssertEqual(planMessages[0].planState?.explanation, "Keep the mirror stable.")
        XCTAssertEqual(planMessages[0].planState?.steps.first?.step, "Reconcile live state")
        XCTAssertEqual(planMessages[0].planState?.steps.first?.status, .inProgress)
        XCTAssertEqual(planMessages[0].resolvedPlanPresentation, .progress)
        XCTAssertNil(planMessages[0].proposedPlan)
    }

    func testMarkedProgressPlanItemStaysInPinnedCapsulePresentation() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"

        service.handleNotification(
            method: "item/started",
            params: .object([
                "threadId": .string(threadID),
                "turnId": .string(turnID),
                "item": .object([
                    "id": .string("progress-plan"),
                    "type": .string("todoList"),
                    "djlProgressPlan": .bool(true),
                    "plan": .array([
                        .object([
                            "step": .string("Keep one live source"),
                            "status": .string("inProgress"),
                        ]),
                    ]),
                ]),
            ])
        )

        let planMessages = service.messages(for: threadID).filter { $0.kind == .plan }
        XCTAssertEqual(planMessages.count, 1)
        XCTAssertEqual(planMessages[0].resolvedPlanPresentation, .progress)
        XCTAssertTrue(planMessages[0].shouldDisplayPinnedPlanAccessory)
    }

    func testEmptyHistoryPlanItemDoesNotRestoreTimelineCard() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"

        let messages = service.decodeMessagesFromThreadRead(
            threadId: threadID,
            threadObject: [
                "turns": .array([
                    .object([
                        "id": .string("turn-empty-plan"),
                        "items": .array([
                            .object([
                                "id": .string("empty-plan"),
                                "type": .string("plan"),
                                "content": .array([]),
                                "plan": .array([]),
                            ]),
                        ]),
                    ]),
                ]),
            ]
        )

        XCTAssertTrue(messages.filter { $0.kind == .plan }.isEmpty)
    }

    func testMarkedProgressPlanHistoryWithOnlyStepsRestoresPinnedCapsule() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"

        let messages = service.decodeMessagesFromThreadRead(
            threadId: threadID,
            threadObject: [
                "turns": .array([
                    .object([
                        "id": .string("turn-progress-plan"),
                        "status": .string("inProgress"),
                        "items": .array([
                            .object([
                                "id": .string("progress-plan"),
                                "type": .string("todo-list"),
                                "djlProgressPlan": .bool(true),
                                "plan": .array([
                                    .object([
                                        "step": .string("Keep the capsule visible"),
                                        "status": .string("inProgress"),
                                    ]),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
            ]
        )

        let planMessages = messages.filter { $0.kind == .plan }
        XCTAssertEqual(planMessages.count, 1)
        XCTAssertEqual(planMessages[0].resolvedPlanPresentation, .progress)
        XCTAssertTrue(planMessages[0].shouldDisplayPinnedPlanAccessory)
    }

    func testUnmarkedCompletedLitterTodoListHistoryNeverBecomesProposedPlan() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"

        let messages = service.decodeMessagesFromThreadRead(
            threadId: threadID,
            threadObject: [
                "turns": .array([
                    .object([
                        "id": .string("turn-litter-plan"),
                        "status": .string("completed"),
                        "items": .array([
                            .object([
                                "id": .string("dae353b0-litter-plan"),
                                "type": .string("todo-list"),
                                "explanation": .string("All review fixes are complete."),
                                "plan": .array([
                                    .object([
                                        "step": .string("Fix history"),
                                        "status": .string("completed"),
                                    ]),
                                    .object([
                                        "step": .string("Verify mirroring"),
                                        "status": .string("completed"),
                                    ]),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
            ]
        )

        let planMessages = messages.filter { $0.kind == .plan }
        XCTAssertEqual(planMessages.count, 1)
        XCTAssertEqual(planMessages[0].resolvedPlanPresentation, .progress)
        XCTAssertNil(planMessages[0].proposedPlan)
        XCTAssertFalse(planMessages[0].shouldDisplayPinnedPlanAccessory)
    }

    func testStructuredUserInputRequestCreatesAndResolvedRemovesPromptCard() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let itemID = "item-\(UUID().uuidString)"
        let requestID: JSONValue = .string("request-\(UUID().uuidString)")

        service.handleIncomingRPCMessage(
            RPCMessage(
                id: requestID,
                method: "item/tool/requestUserInput",
                params: .object([
                    "threadId": .string(threadID),
                    "turnId": .string(turnID),
                    "itemId": .string(itemID),
                    "questions": .array([
                        .object([
                            "id": .string("mode"),
                            "header": .string("Direction"),
                            "question": .string("Which path should we take?"),
                            "isOther": .bool(false),
                            "isSecret": .bool(false),
                            "options": .array([
                                .object([
                                    "label": .string("Ship it"),
                                    "description": .string("Build the fastest version"),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        )

        let promptMessages = service.messages(for: threadID).filter { $0.kind == .userInputPrompt }
        XCTAssertEqual(promptMessages.count, 1)
        XCTAssertEqual(promptMessages[0].structuredUserInputRequest?.questions.first?.header, "Direction")

        service.handleNotification(
            method: "serverRequest/resolved",
            params: .object([
                "threadId": .string(threadID),
                "requestId": requestID,
            ])
        )

        XCTAssertTrue(service.messages(for: threadID).filter { $0.kind == .userInputPrompt }.isEmpty)
    }

    func testToolRequestUserInputMethodCreatesPromptCard() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let requestID: JSONValue = .string("request-\(UUID().uuidString)")

        service.handleIncomingRPCMessage(
            RPCMessage(
                id: requestID,
                method: "tool/requestUserInput",
                params: .object([
                    "threadId": .string(threadID),
                    "questions": .array([
                        .object([
                            "id": .string("path"),
                            "header": .string("Direction"),
                            "question": .string("Which path should we take?"),
                            "isOther": .bool(true),
                            "options": .array([
                                .object([
                                    "label": .string("Ship it"),
                                    "description": .string("Build the fastest version"),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        )

        let promptMessages = service.messages(for: threadID).filter { $0.kind == .userInputPrompt }
        XCTAssertEqual(promptMessages.count, 1)
        XCTAssertEqual(promptMessages[0].structuredUserInputRequest?.questions.first?.id, "path")
        XCTAssertEqual(promptMessages[0].structuredUserInputRequest?.questions.first?.isOther, true)
    }

    func testToolRequestUserInputWithoutThreadIDUsesTurnMapping() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let requestID: JSONValue = .string("request-\(UUID().uuidString)")

        service.handleNotification(
            method: "turn/started",
            params: .object([
                "threadId": .string(threadID),
                "turnId": .string(turnID),
            ])
        )

        service.handleIncomingRPCMessage(
            RPCMessage(
                id: requestID,
                method: "tool/requestUserInput",
                params: .object([
                    "turnId": .string(turnID),
                    "questions": .array([
                        .object([
                            "id": .string("path"),
                            "header": .string("Direction"),
                            "question": .string("Which path should we take?"),
                            "options": .array([
                                .object([
                                    "label": .string("Ship it"),
                                    "description": .string("Build the fastest version"),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        )

        let promptMessages = service.messages(for: threadID).filter { $0.kind == .userInputPrompt }
        XCTAssertEqual(promptMessages.count, 1)
        XCTAssertEqual(promptMessages[0].turnId, turnID)
    }

    func testStructuredUserInputPromptWithoutTurnIDStillCreatesPromptCard() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let requestID: JSONValue = .string("request-\(UUID().uuidString)")

        service.handleIncomingRPCMessage(
            RPCMessage(
                id: requestID,
                method: "item/tool/requestUserInput",
                params: .object([
                    "threadId": .string(threadID),
                    "questions": .array([
                        .object([
                            "id": .string("path"),
                            "header": .string("Direction"),
                            "question": .string("Which path should we take?"),
                            "isOther": .bool(false),
                            "isSecret": .bool(false),
                            "options": .array([
                                .object([
                                    "label": .string("Ship it"),
                                    "description": .string("Build the fastest version"),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        )

        let promptMessages = service.messages(for: threadID).filter { $0.kind == .userInputPrompt }
        XCTAssertEqual(promptMessages.count, 1)
        XCTAssertNil(promptMessages[0].turnId)
    }

    func testTurnStartedDoesNotClearPendingStructuredUserInputPromptBeforeResolution() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let requestID: JSONValue = .string("request-\(UUID().uuidString)")

        service.handleIncomingRPCMessage(
            RPCMessage(
                id: requestID,
                method: "item/tool/requestUserInput",
                params: .object([
                    "threadId": .string(threadID),
                    "turnId": .string(turnID),
                    "questions": .array([
                        .object([
                            "id": .string("path"),
                            "header": .string("Direction"),
                            "question": .string("Which path should we take?"),
                            "isOther": .bool(false),
                            "isSecret": .bool(false),
                            "options": .array([
                                .object([
                                    "label": .string("Ship it"),
                                    "description": .string("Build the fastest version"),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        )

        service.handleNotification(
            method: "turn/started",
            params: .object([
                "threadId": .string(threadID),
                "turnId": .string("turn-\(UUID().uuidString)"),
            ])
        )

        let promptMessages = service.messages(for: threadID).filter { $0.kind == .userInputPrompt }
        XCTAssertEqual(promptMessages.count, 1)
        XCTAssertEqual(promptMessages[0].structuredUserInputRequest?.requestID, requestID)
    }

    func testTurnCompletionDoesNotClearPendingStructuredUserInputPromptBeforeResolution() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let requestID: JSONValue = .string("request-\(UUID().uuidString)")

        service.handleIncomingRPCMessage(
            RPCMessage(
                id: requestID,
                method: "item/tool/requestUserInput",
                params: .object([
                    "threadId": .string(threadID),
                    "turnId": .string(turnID),
                    "questions": .array([
                        .object([
                            "id": .string("path"),
                            "header": .string("Direction"),
                            "question": .string("Which path should we take?"),
                            "isOther": .bool(false),
                            "isSecret": .bool(false),
                            "options": .array([
                                .object([
                                    "label": .string("Ship it"),
                                    "description": .string("Build the fastest version"),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        )

        service.handleNotification(
            method: "turn/completed",
            params: .object([
                "threadId": .string(threadID),
                "turnId": .string(turnID),
            ])
        )

        let promptMessages = service.messages(for: threadID).filter { $0.kind == .userInputPrompt }
        XCTAssertEqual(promptMessages.count, 1)
        XCTAssertEqual(promptMessages[0].structuredUserInputRequest?.requestID, requestID)

        service.handleNotification(
            method: "serverRequest/resolved",
            params: .object([
                "threadId": .string(threadID),
                "requestId": requestID,
            ])
        )

        XCTAssertTrue(service.messages(for: threadID).filter { $0.kind == .userInputPrompt }.isEmpty)
    }

    func testBuildStructuredUserInputResponseMatchesServerShape() {
        let service = makeService()

        let response = service.buildStructuredUserInputResponse(
            answersByQuestionID: [
                "path": ["Ship it"],
                "notes": ["Keep the old composer styling"],
            ]
        )

        let answers = response.objectValue?["answers"]?.objectValue
        XCTAssertEqual(
            answers?["path"]?.objectValue?["answers"]?.arrayValue?.compactMap(\.stringValue),
            ["Ship it"]
        )
        XCTAssertEqual(
            answers?["notes"]?.objectValue?["answers"]?.arrayValue?.compactMap(\.stringValue),
            ["Keep the old composer styling"]
        )
    }

    func testCancelStructuredPlanSessionInterruptsTurnAndClearsPromptState() async throws {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let requestID: JSONValue = .string("request-\(UUID().uuidString)")
        let secondRequestID: JSONValue = .string("request-\(UUID().uuidString)")

        service.handleIncomingRPCMessage(
            RPCMessage(
                id: requestID,
                method: "item/tool/requestUserInput",
                params: .object([
                    "threadId": .string(threadID),
                    "turnId": .string(turnID),
                    "questions": .array([
                        .object([
                            "id": .string("path"),
                            "header": .string("Direction"),
                            "question": .string("Which path should we take?"),
                            "options": .array([
                                .object([
                                    "label": .string("Ship it"),
                                    "description": .string("Build the fastest version"),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        )
        service.handleIncomingRPCMessage(
            RPCMessage(
                id: secondRequestID,
                method: "item/tool/requestUserInput",
                params: .object([
                    "threadId": .string(threadID),
                    "turnId": .string(turnID),
                    "questions": .array([
                        .object([
                            "id": .string("scope"),
                            "header": .string("Scope"),
                            "question": .string("Do we keep the old flow too?"),
                            "options": .array([
                                .object([
                                    "label": .string("Yes"),
                                    "description": .string("Keep both for now"),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        )
        service.markNativePlanSession(for: threadID)

        var interruptParams: JSONValue?
        service.requestTransportOverride = { method, params in
            XCTAssertEqual(method, "turn/interrupt")
            interruptParams = params
            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([:]),
                includeJSONRPC: false
            )
        }

        try await service.cancelStructuredPlanSession(
            requestID: requestID,
            turnId: turnID,
            threadId: threadID
        )

        XCTAssertEqual(interruptParams?.objectValue?["turnId"]?.stringValue, turnID)
        XCTAssertEqual(interruptParams?.objectValue?["threadId"]?.stringValue, threadID)
        XCTAssertTrue(service.messages(for: threadID).filter { $0.kind == .userInputPrompt }.isEmpty)
        XCTAssertNil(service.currentPlanSessionSource(for: threadID))
    }

    func testCancelStructuredPlanSessionFailurePreservesPromptState() async {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let requestID: JSONValue = .string("request-\(UUID().uuidString)")

        service.handleIncomingRPCMessage(
            RPCMessage(
                id: requestID,
                method: "item/tool/requestUserInput",
                params: .object([
                    "threadId": .string(threadID),
                    "turnId": .string(turnID),
                    "questions": .array([
                        .object([
                            "id": .string("scope"),
                            "header": .string("Scope"),
                            "question": .string("Do we keep the old flow too?"),
                            "options": .array([
                                .object([
                                    "label": .string("Yes"),
                                    "description": .string("Keep both for now"),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        )
        service.markNativePlanSession(for: threadID)

        service.requestTransportOverride = { method, _ in
            XCTAssertEqual(method, "turn/interrupt")
            throw CodexServiceError.disconnected
        }

        do {
            try await service.cancelStructuredPlanSession(
                requestID: requestID,
                turnId: turnID,
                threadId: threadID
            )
            XCTFail("Expected cancelStructuredPlanSession to throw")
        } catch let error as CodexServiceError {
            guard case .disconnected = error else {
                XCTFail("Unexpected CodexServiceError: \(error)")
                return
            }
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        XCTAssertEqual(service.messages(for: threadID).filter { $0.kind == .userInputPrompt }.count, 1)
        XCTAssertTrue(service.currentPlanSessionSource(for: threadID)?.isNative == true)
    }

    func testDismissStructuredPlanPromptFailureKeepsPromptVisible() async {
        let service = makeService()
        let viewModel = makeViewModel()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let requestID: JSONValue = .string("request-\(UUID().uuidString)")

        service.handleIncomingRPCMessage(
            RPCMessage(
                id: requestID,
                method: "item/tool/requestUserInput",
                params: .object([
                    "threadId": .string(threadID),
                    "turnId": .string(turnID),
                    "questions": .array([
                        .object([
                            "id": .string("scope"),
                            "header": .string("Scope"),
                            "question": .string("Do we keep the old flow too?"),
                            "options": .array([
                                .object([
                                    "label": .string("Yes"),
                                    "description": .string("Keep both for now"),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        )
        service.markNativePlanSession(for: threadID)

        guard let promptMessage = service.messages(for: threadID).last(where: { $0.kind == .userInputPrompt }) else {
            XCTFail("Expected a structured prompt message")
            return
        }

        service.requestTransportOverride = { method, _ in
            XCTAssertEqual(method, "turn/interrupt")
            throw CodexServiceError.disconnected
        }

        viewModel.dismissStructuredPlanPrompt(promptMessage, codex: service, threadID: threadID)
        await waitForStructuredPromptDismissCompletion(
            viewModel,
            requestID: requestID,
            codex: service
        )

        XCTAssertFalse(viewModel.isStructuredPlanPromptDismissed(requestID, codex: service))
        XCTAssertFalse(viewModel.isStructuredPlanPromptDismissing(requestID, codex: service))
        XCTAssertEqual(service.messages(for: threadID).filter { $0.kind == .userInputPrompt }.count, 1)
        XCTAssertTrue(service.currentPlanSessionSource(for: threadID)?.isNative == true)
        XCTAssertEqual(service.lastErrorMessage, service.userFacingTurnErrorMessage(from: CodexServiceError.disconnected))
    }

    func testResolvedInferredPlanQuestionnairePrefersMatchingNativePrompt() {
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let assistantMessage = CodexMessage(
            threadId: threadID,
            role: .assistant,
            text: """
            I have one question for you before I finalize the plan:

            1. Which path should we take?
            - Ship it
            - Stage it
            """,
            turnId: turnID
        )
        let nativePrompt = CodexMessage(
            threadId: threadID,
            role: .system,
            kind: .userInputPrompt,
            text: "Direction\nWhich path should we take?",
            turnId: turnID,
            structuredUserInputRequest: CodexStructuredUserInputRequest(
                requestID: .string("request-\(UUID().uuidString)"),
                questions: [
                    CodexStructuredUserInputQuestion(
                        id: "direction",
                        header: "Direction",
                        question: "Which path should we take?",
                        isOther: false,
                        isSecret: false,
                        options: [
                            CodexStructuredUserInputOption(label: "Ship it", description: "Build the fastest version"),
                            CodexStructuredUserInputOption(label: "Stage it", description: "Ship in smaller slices"),
                        ]
                    ),
                ]
            )
        )

        let questionnaire = resolvedInferredPlanQuestionnaire(
            bodyText: assistantMessage.text,
            message: assistantMessage,
            threadMessages: [assistantMessage, nativePrompt],
            parse: InferredPlanQuestionnaireParser.parseAssistantMessage
        )

        XCTAssertNil(questionnaire)
    }

    func testAssistantFallbackQuestionnaireWithoutCueStillParses() {
        let text = """
        1. Which rollout path should we take?
        - Ship it now
        - Stage it behind a flag

        2. Which validation level do you want?
        - Smoke test only
        - Add focused regression coverage
        """

        let questionnaire = InferredPlanQuestionnaireParser.parseAssistantMessage(text)

        XCTAssertEqual(questionnaire?.questions.count, 2)
        XCTAssertEqual(
            questionnaire?.questions.first?.options.map(\.label),
            ["Ship it now", "Stage it behind a flag"]
        )
    }

    func testAssistantFallbackQuestionnaireWithMarkdownNumberingParses() {
        let text = """
        A few quick questions before I finalize the plan:

        **1. Which rollout path should we take?**
        - Ship it now
        - Stage it behind a flag
        """

        let questionnaire = InferredPlanQuestionnaireParser.parseAssistantMessage(text)

        XCTAssertEqual(questionnaire?.questions.count, 1)
        XCTAssertEqual(questionnaire?.questions.first?.question, "Which rollout path should we take?")
        XCTAssertEqual(
            questionnaire?.questions.first?.options.map(\.label),
            ["Ship it now", "Stage it behind a flag"]
        )
    }

    func testAssistantFallbackChoiceListParsesIntoSingleQuestion() {
        let text = """
        My strongest recommendation is to focus on trust first.

        If you want, next I can turn this into one of these:

        1. a prioritized roadmap for the next 2-4 weeks
        2. a feature matrix with quick wins vs bigger bets
        3. a concrete implementation plan mapped to the current codebase
        """

        let questionnaire = InferredPlanQuestionnaireParser.parseAssistantMessage(text)

        XCTAssertEqual(questionnaire?.questions.count, 1)
        XCTAssertEqual(questionnaire?.questions.first?.header, "Next step")
        XCTAssertEqual(questionnaire?.questions.first?.question, "What should Codex produce next?")
        XCTAssertEqual(
            questionnaire?.questions.first?.options.map(\.label),
            [
                "a prioritized roadmap for the next 2-4 weeks",
                "a feature matrix with quick wins vs bigger bets",
                "a concrete implementation plan mapped to the current codebase",
            ]
        )
    }

    func testResolvedFallbackChoiceListStillAppearsAfterNativeThreadDegradesToPlainText() {
        let assistantMessage = CodexMessage(
            threadId: "thread-plan",
            role: .assistant,
            text: """
            Suggested Roadmap If we wanted a practical sequence, I'd do:

            1. Polish onboarding and first-run UX
            2. Improve status clarity and calibration experience
            3. Expand actions beyond open app

            If you want, next I can turn this into one of these:

            1. a concrete 2-week roadmap
            2. a feature-priority matrix
            3. a "v1 vs v2" product strategy doc
            """,
            turnId: "turn-plan",
            orderIndex: 3
        )

        let questionnaire = resolvedInferredPlanQuestionnaire(
            bodyText: assistantMessage.text,
            message: assistantMessage,
            threadMessages: [assistantMessage],
            parse: InferredPlanQuestionnaireParser.parseAssistantMessage
        )

        XCTAssertEqual(questionnaire?.questions.count, 1)
        XCTAssertEqual(questionnaire?.questions.first?.header, "Next step")
        XCTAssertEqual(
            questionnaire?.questions.first?.options.map { $0.label },
            [
                "a concrete 2-week roadmap",
                "a feature-priority matrix",
                "a \"v1 vs v2\" product strategy doc",
            ]
        )
    }

    func testResolvedFallbackChoiceListDoesNotAppearOutsidePlanModeSession() {
        let assistantMessage = CodexMessage(
            threadId: "thread-default",
            role: .assistant,
            text: """
            If you want, next I can turn this into one of these:

            1. a concrete 2-week roadmap
            2. a feature-priority matrix
            3. a "v1 vs v2" product strategy doc
            """,
            turnId: "turn-default",
            orderIndex: 3
        )

        let questionnaire = resolvedInferredPlanQuestionnaire(
            bodyText: assistantMessage.text,
            message: assistantMessage,
            threadMessages: [assistantMessage],
            shouldRecoverFallback: false,
            parse: InferredPlanQuestionnaireParser.parseAssistantMessage
        )

        XCTAssertNil(questionnaire)
    }

    func testResolvedFallbackChoiceListDoesNotAppearAfterNativePlanSessionIsConfirmed() {
        let service = makeService()
        service.markNativePlanSession(for: "thread-native")

        let assistantMessage = CodexMessage(
            threadId: "thread-native",
            role: .assistant,
            text: """
            If you want, next I can turn this into one of these:

            1. a concrete 2-week roadmap
            2. a feature-priority matrix
            3. a "v1 vs v2" product strategy doc
            """,
            turnId: "turn-native",
            orderIndex: 3
        )

        let questionnaire = resolvedInferredPlanQuestionnaire(
            bodyText: assistantMessage.text,
            message: assistantMessage,
            threadMessages: [assistantMessage],
            shouldRecoverFallback: service.allowsAssistantPlanFallbackRecovery(for: "thread-native"),
            parse: InferredPlanQuestionnaireParser.parseAssistantMessage
        )

        XCTAssertNil(questionnaire)
    }

    func testProposedPlanParserExtractsBodyAndRemovesEnvelope() {
        let rawText = """
        I explored the current flow and here is the final plan.

        <proposed_plan>
        ## Summary
        - Make native structured questions the primary path.
        - Render final plan blocks with an implementation action.
        </proposed_plan>
        """

        let proposedPlan = CodexProposedPlanParser.parse(from: rawText)

        XCTAssertEqual(
            proposedPlan?.body,
            """
            ## Summary
            - Make native structured questions the primary path.
            - Render final plan blocks with an implementation action.
            """
        )
        XCTAssertEqual(
            CodexProposedPlanParser.removingEnvelope(from: rawText),
            "I explored the current flow and here is the final plan."
        )
        XCTAssertEqual(
            proposedPlan?.summary,
            "Summary"
        )
    }

    func testHistoryPlanItemsRestoreStructuredState() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let itemID = "item-\(UUID().uuidString)"

        let messages = service.decodeMessagesFromThreadRead(
            threadId: threadID,
            threadObject: [
                "createdAt": .double(1_700_000_000),
                "turns": .array([
                    .object([
                        "id": .string(turnID),
                        "items": .array([
                            .object([
                                "id": .string(itemID),
                                "type": .string("plan"),
                                "content": .array([
                                    .object([
                                        "type": .string("text"),
                                        "text": .string("1. Audit\n2. Implement\n3. Verify"),
                                    ]),
                                ]),
                                "explanation": .string("Break the work into safe slices."),
                                "plan": .array([
                                    .object([
                                        "step": .string("Audit"),
                                        "status": .string("completed"),
                                    ]),
                                    .object([
                                        "step": .string("Implement"),
                                        "status": .string("inProgress"),
                                    ]),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
            ]
        )

        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages[0].kind, .plan)
        XCTAssertEqual(messages[0].text, "1. Audit\n2. Implement\n3. Verify")
        XCTAssertEqual(messages[0].planState?.explanation, "Break the work into safe slices.")
        XCTAssertEqual(messages[0].planState?.steps.count, 2)
        XCTAssertEqual(messages[0].planState?.steps.last?.status, .inProgress)
    }

    func testCompletedHistoryTurnFinalizesPlanSteps() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let itemID = "item-\(UUID().uuidString)"

        let messages = service.decodeMessagesFromThreadRead(
            threadId: threadID,
            threadObject: [
                "createdAt": .double(1_700_000_000),
                "turns": .array([
                    .object([
                        "id": .string(turnID),
                        "status": .string("completed"),
                        "items": .array([
                            .object([
                                "id": .string(itemID),
                                "type": .string("plan"),
                                "content": .array([
                                    .object([
                                        "type": .string("text"),
                                        "text": .string("1. Audit\n2. Implement\n3. Verify"),
                                    ]),
                                ]),
                                "explanation": .string("Break the work into safe slices."),
                                "plan": .array([
                                    .object([
                                        "step": .string("Audit"),
                                        "status": .string("completed"),
                                    ]),
                                    .object([
                                        "step": .string("Implement"),
                                        "status": .string("in_progress"),
                                    ]),
                                    .object([
                                        "step": .string("Verify"),
                                        "status": .string("pending"),
                                    ]),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
            ]
        )

        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages[0].planState?.steps.map(\.status), [.completed, .completed, .completed])
        XCTAssertFalse(messages[0].shouldDisplayPinnedPlanAccessory)
    }

    func testCompletedPlanDoesNotStayPinnedInConversationAccessory() {
        let completedPlan = CodexMessage(
            threadId: "thread-\(UUID().uuidString)",
            role: .system,
            kind: .plan,
            text: "All steps are done.",
            isStreaming: false,
            planState: CodexPlanState(
                explanation: "The plan finished successfully.",
                steps: [
                    CodexPlanStep(step: "Inspect the current behavior", status: .completed),
                    CodexPlanStep(step: "Implement the fix", status: .completed),
                    CodexPlanStep(step: "Verify the result", status: .completed),
                ]
            )
        )

        XCTAssertTrue(completedPlan.isPlanSystemMessage)
        XCTAssertFalse(completedPlan.shouldDisplayPinnedPlanAccessory)
        XCTAssertFalse(completedPlan.shouldDisplayInlinePlanResult)
    }

    func testIncompletePlanRemainsPinnedInConversationAccessory() {
        let activePlan = CodexMessage(
            threadId: "thread-\(UUID().uuidString)",
            role: .system,
            kind: .plan,
            text: "Working through the plan.",
            isStreaming: false,
            planState: CodexPlanState(
                explanation: "The plan is still active.",
                steps: [
                    CodexPlanStep(step: "Inspect the current behavior", status: .completed),
                    CodexPlanStep(step: "Implement the fix", status: .inProgress),
                    CodexPlanStep(step: "Verify the result", status: .pending),
                ]
            )
        )

        XCTAssertTrue(activePlan.shouldDisplayPinnedPlanAccessory)
    }

    func testMisclassifiedStructuredProgressPlanStillUsesPinnedAccessory() {
        let progressPlan = CodexMessage(
            threadId: "thread-\(UUID().uuidString)",
            role: .system,
            kind: .plan,
            text: "Investigate the mirroring path.",
            itemId: "todo-list-\(UUID().uuidString)",
            isStreaming: false,
            planState: CodexPlanState(
                explanation: "Trace the live and restored state.",
                steps: [
                    CodexPlanStep(step: "Inspect Litter", status: .inProgress),
                    CodexPlanStep(step: "Fix projection", status: .pending),
                ]
            ),
            planPresentation: .resultCompletedItem,
            proposedPlan: CodexProposedPlan(body: "Planning...")
        )

        XCTAssertTrue(progressPlan.isTaskProgressPlanMessage)
        XCTAssertTrue(progressPlan.shouldDisplayPinnedPlanAccessory)
        XCTAssertFalse(progressPlan.shouldDisplayInlinePlanResult)
    }

    func testLatestCompletedProgressSnapshotClearsOlderPinnedSnapshot() {
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let staleActive = CodexMessage(
            id: "stale-active-plan",
            threadId: threadID,
            role: .system,
            kind: .plan,
            text: "Starting investigation.",
            turnId: turnID,
            itemId: "todo-list-start",
            planState: CodexPlanState(
                explanation: "Starting investigation.",
                steps: [CodexPlanStep(step: "Inspect Litter", status: .inProgress)]
            ),
            planPresentation: .progress
        )
        let completed = CodexMessage(
            id: "completed-plan",
            threadId: threadID,
            role: .system,
            kind: .plan,
            text: "Investigation complete.",
            turnId: turnID,
            itemId: "todo-list-complete",
            planState: CodexPlanState(
                explanation: "Investigation complete.",
                steps: [CodexPlanStep(step: "Inspect Litter", status: .completed)]
            ),
            planPresentation: .progress
        )

        XCTAssertNil(TurnConversationContainerView.pinnedTaskPlanMessage(
            from: [staleActive, completed]
        ))
        XCTAssertEqual(
            TurnConversationContainerView.pinnedTaskPlanMessage(
                from: [completed, staleActive]
            )?.id,
            staleActive.id
        )
    }

    func testLateCompletedSnapshotFromOlderTurnDoesNotClearActiveTurnPlan() {
        let threadID = "thread-\(UUID().uuidString)"
        let activeTurnID = "turn-active-\(UUID().uuidString)"
        let activePlan = CodexMessage(
            id: "active-turn-plan",
            threadId: threadID,
            role: .system,
            kind: .plan,
            text: "Implementing the current plan.",
            turnId: activeTurnID,
            itemId: "todo-list-active",
            planState: CodexPlanState(
                explanation: "Implementing the current plan.",
                steps: [CodexPlanStep(step: "Verify the fix", status: .inProgress)]
            ),
            planPresentation: .progress
        )
        let lateOlderCompletedPlan = CodexMessage(
            id: "late-older-completed-plan",
            threadId: threadID,
            role: .system,
            kind: .plan,
            text: "The previous plan completed.",
            turnId: "turn-older-\(UUID().uuidString)",
            itemId: "todo-list-older-complete",
            planState: CodexPlanState(
                explanation: "The previous plan completed.",
                steps: [CodexPlanStep(step: "Inspect Litter", status: .completed)]
            ),
            planPresentation: .progress
        )

        XCTAssertEqual(
            TurnConversationContainerView.pinnedTaskPlanMessage(
                from: [activePlan, lateOlderCompletedPlan],
                activeTurnID: activeTurnID
            )?.id,
            activePlan.id
        )
    }

    func testCompletedNativePlanItemRendersInlineUntilTurnTerminalStateResolves() {
        let pendingResultPlan = CodexMessage(
            threadId: "thread-\(UUID().uuidString)",
            role: .system,
            kind: .plan,
            text: """
            # Small Plan

            - Keep the focused source edits.
            - Remove generated build output.
            - Run the focused verification.
            """,
            itemId: "plan-item-\(UUID().uuidString)",
            isStreaming: false,
            planPresentation: .resultCompletedItem
        )

        XCTAssertFalse(pendingResultPlan.shouldDisplayPinnedPlanAccessory)
        XCTAssertTrue(pendingResultPlan.shouldDisplayInlinePlanResult)
    }

    func testCompletedSystemPlanWithEmbeddedProposedPlanDoesNotMasqueradeAsFinalPlan() {
        let completedPlan = CodexMessage(
            threadId: "thread-\(UUID().uuidString)",
            role: .system,
            kind: .plan,
            text: """
            <proposed_plan>
            ## Ship
            - Tighten native Plan Mode first.
            </proposed_plan>
            """,
            isStreaming: false,
            planState: CodexPlanState(
                explanation: "The plan is finalized.",
                steps: [
                    CodexPlanStep(step: "Inspect the current behavior", status: .completed),
                    CodexPlanStep(step: "Implement the fix", status: .completed),
                ]
            )
        )

        XCTAssertFalse(completedPlan.shouldDisplayInlinePlanResult)
        XCTAssertNil(completedPlan.proposedPlan)
    }

    func testAssistantProposedPlanStaysSeparateFromSystemStepPlan() {
        let finalAssistantPlan = CodexMessage(
            threadId: "thread-\(UUID().uuidString)",
            role: .assistant,
            text: """
            <proposed_plan>
            ## Ship
            - Tighten native Plan Mode first.
            </proposed_plan>
            """,
            isStreaming: false
        )

        XCTAssertEqual(finalAssistantPlan.proposedPlan?.summary, "Ship")
    }

    private func makeService(
        suiteName: String = "CodexPlanModeTests.\(UUID().uuidString)",
        reset: Bool = true
    ) -> CodexService {
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        if reset {
            defaults.removePersistentDomain(forName: suiteName)
        }
        let service = CodexService(defaults: defaults)
        if reset {
            service.messagesByThread = [:]
        }
        Self.retainedServices.append(service)
        return service
    }

    private func makeViewModel() -> TurnViewModel {
        let viewModel = TurnViewModel()
        Self.retainedViewModels.append(viewModel)
        return viewModel
    }

    private func makeModel() -> CodexModelOption {
        CodexModelOption(
            id: "gpt-5-codex",
            model: "gpt-5-codex",
            displayName: "GPT-5 Codex",
            description: "Test model",
            isDefault: true,
            supportedReasoningEfforts: [
                CodexReasoningEffortOption(reasoningEffort: "medium", description: "Medium"),
            ],
            defaultReasoningEffort: "medium"
        )
    }

    private func waitForSendCompletion(_ viewModel: TurnViewModel) async {
        for _ in 0..<120 {
            if !viewModel.isSending {
                return
            }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("Expected send to complete")
    }

    private func waitForStructuredPromptDismissCompletion(
        _ viewModel: TurnViewModel,
        requestID: JSONValue,
        codex: CodexService
    ) async {
        for _ in 0..<120 {
            if !viewModel.isStructuredPlanPromptDismissing(requestID, codex: codex) {
                return
            }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("Expected structured prompt dismiss to complete")
    }

    private func textInput(from params: JSONValue?) -> String? {
        params?
            .objectValue?["input"]?
            .arrayValue?
            .compactMap(\.objectValue)
            .first(where: { $0["type"]?.stringValue == "text" })?["text"]?
            .stringValue
    }
}
