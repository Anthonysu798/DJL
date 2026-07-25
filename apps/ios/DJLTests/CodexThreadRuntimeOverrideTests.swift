// FILE: CodexThreadRuntimeOverrideTests.swift
// Purpose: Verifies per-thread runtime overrides for reasoning and speed beat app defaults.
// Layer: Unit Test
// Exports: CodexThreadRuntimeOverrideTests
// Depends on: XCTest, DJL

import XCTest
@testable import DJL

@MainActor
final class CodexThreadRuntimeOverrideTests: XCTestCase {
    private static var retainedServices: [CodexService] = []

    func testTurnStartUsesThreadRuntimeOverridesInsteadOfAppDefaults() async throws {
        let service = makeService()
        service.isConnected = true
        service.availableModels = [makeModel()]
        service.setSelectedModelId("gpt-5.4")
        service.setSelectedReasoningEffort("medium")
        service.setSelectedServiceTier(.fast)
        service.setThreadReasoningEffortOverride("high", for: "thread-override")
        service.setThreadServiceTierOverride(nil, for: "thread-override")

        var capturedTurnStartParams: [JSONValue] = []
        service.requestTransportOverride = { method, params in
            if method == "turn/start" {
                capturedTurnStartParams.append(params ?? .null)
            }
            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object(["turnId": .string("turn-override")]),
                includeJSONRPC: false
            )
        }

        try await service.sendTurnStart("Ship it", to: "thread-override")

        XCTAssertEqual(capturedTurnStartParams.count, 1)
        XCTAssertEqual(capturedTurnStartParams[0].objectValue?["effort"]?.stringValue, "high")
        XCTAssertNil(capturedTurnStartParams[0].objectValue?["serviceTier"]?.stringValue)
    }

    func testThreadServiceTierOverridePersistsExplicitNormalSelection() {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)

        let firstService = CodexService(defaults: defaults)
        Self.retainedServices.append(firstService)
        firstService.setSelectedServiceTier(.fast)
        firstService.setThreadServiceTierOverride(nil, for: "thread-normal")

        XCTAssertTrue(firstService.isThreadServiceTierOverridden("thread-normal"))
        XCTAssertNil(firstService.effectiveServiceTier(for: "thread-normal"))

        let secondService = CodexService(defaults: defaults)
        Self.retainedServices.append(secondService)

        XCTAssertTrue(secondService.isThreadServiceTierOverridden("thread-normal"))
        XCTAssertNil(secondService.effectiveServiceTier(for: "thread-normal"))
    }

    func testThreadAccessModeOverridesDefaultAndPersists() {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)

        let firstService = CodexService(defaults: defaults)
        Self.retainedServices.append(firstService)
        firstService.setSelectedAccessMode(.onRequest)
        firstService.setThreadAccessModeOverride(.fullAccess, for: "thread-full")

        XCTAssertEqual(firstService.effectiveAccessMode(for: "thread-full"), .fullAccess)
        XCTAssertEqual(firstService.effectiveAccessMode(for: "thread-other"), .onRequest)

        let secondService = CodexService(defaults: defaults)
        Self.retainedServices.append(secondService)

        XCTAssertEqual(secondService.effectiveAccessMode(for: "thread-full"), .fullAccess)
        XCTAssertEqual(secondService.selectedAccessMode, .onRequest)
    }

    func testImmediateThreadAccessModeSyncUsesElectronRPC() async {
        let service = makeService()
        service.isConnected = true
        service.isInitialized = true
        service.supportsThreadRuntimeModeSync = true
        var capturedMethod: String?
        var capturedParams: JSONValue?
        service.requestTransportOverride = { method, params in
            capturedMethod = method
            capturedParams = params
            return RPCMessage(
                id: .string("set-runtime-mode"),
                result: .object(["runtimeMode": .string("full-access")]),
                includeJSONRPC: false
            )
        }

        await service.setThreadAccessMode(.fullAccess, for: "thread-sync")

        XCTAssertEqual(service.effectiveAccessMode(for: "thread-sync"), .fullAccess)
        XCTAssertEqual(capturedMethod, "djl/thread/runtimeMode/set")
        XCTAssertEqual(capturedParams?.objectValue?["threadId"], .string("thread-sync"))
        XCTAssertEqual(capturedParams?.objectValue?["runtimeMode"], .string("full-access"))
    }

    func testFailedImmediateSyncRollsBackLatestSelection() async {
        let service = makeService()
        service.isConnected = true
        service.isInitialized = true
        service.supportsThreadRuntimeModeSync = true
        service.setThreadAccessModeOverride(.onRequest, for: "thread-sync-failure")
        service.confirmThreadAccessMode(.onRequest, for: "thread-sync-failure")
        service.requestTransportOverride = { _, _ in
            throw CodexServiceError.invalidResponse("sync failed")
        }

        await service.setThreadAccessMode(.fullAccess, for: "thread-sync-failure")

        XCTAssertEqual(service.effectiveAccessMode(for: "thread-sync-failure"), .onRequest)
    }

    func testRemoteElectronModeUpdatesThreadWithoutChangingDefault() {
        let service = makeService()
        service.setSelectedAccessMode(.onRequest)

        service.applyRemoteThreadAccessMode(.autoReview, for: "thread-remote-mode")

        XCTAssertEqual(service.effectiveAccessMode(for: "thread-remote-mode"), .autoReview)
        XCTAssertEqual(service.selectedAccessMode, .onRequest)
    }

    func testElectronRuntimeModeNotificationUpdatesThreadWithoutEchoing() {
        let service = makeService()
        service.setSelectedAccessMode(.onRequest)
        var outboundRequestCount = 0
        service.requestTransportOverride = { _, _ in
            outboundRequestCount += 1
            return RPCMessage(
                id: .string("unexpected-request"),
                result: .object([:]),
                includeJSONRPC: false
            )
        }

        service.handleIncomingRPCMessage(RPCMessage(
            method: "djl/thread/runtimeMode/updated",
            params: .object([
                "threadId": .string("thread-notification"),
                "runtimeMode": .string("auto-approval"),
            ]),
            includeJSONRPC: false
        ))

        XCTAssertEqual(service.effectiveAccessMode(for: "thread-notification"), .autoReview)
        XCTAssertEqual(outboundRequestCount, 0)
    }

    func testRapidThreadAccessSelectionsAreLastWriteWins() async {
        let service = makeService()
        service.isConnected = true
        service.isInitialized = true
        service.supportsThreadRuntimeModeSync = true
        var delayedFullAccessResponse: CheckedContinuation<RPCMessage, Error>?

        service.requestTransportOverride = { _, params in
            let runtimeMode = params?.objectValue?["runtimeMode"]?.stringValue
            if runtimeMode == "full-access" {
                return try await withCheckedThrowingContinuation { continuation in
                    delayedFullAccessResponse = continuation
                }
            }
            return RPCMessage(
                id: .string("auto-approval-response"),
                result: .object(["runtimeMode": .string("auto-approval")]),
                includeJSONRPC: false
            )
        }

        let firstSelection = Task {
            await service.setThreadAccessMode(.fullAccess, for: "thread-race")
        }
        while delayedFullAccessResponse == nil {
            await Task.yield()
        }

        await service.setThreadAccessMode(.autoReview, for: "thread-race")
        delayedFullAccessResponse?.resume(returning: RPCMessage(
            id: .string("full-access-response"),
            result: .object(["runtimeMode": .string("full-access")]),
            includeJSONRPC: false
        ))
        await firstSelection.value

        XCTAssertEqual(service.effectiveAccessMode(for: "thread-race"), .autoReview)
    }

    func testTurnStartUsesThreadAccessModeInsteadOfDefault() async throws {
        let service = makeService()
        service.isConnected = true
        service.availableModels = [makeModel()]
        service.setSelectedAccessMode(.onRequest)
        service.setThreadAccessModeOverride(.fullAccess, for: "thread-full-turn")
        var capturedParams: JSONValue?
        service.requestTransportOverride = { method, params in
            if method == "turn/start" {
                capturedParams = params
            }
            return RPCMessage(
                id: .string("turn-full-access"),
                result: .object([
                    "turn": .object(["id": .string("turn-full-access")]),
                    "runtimeMode": .string("full-access"),
                ]),
                includeJSONRPC: false
            )
        }

        try await service.sendTurnStart("Use full access", to: "thread-full-turn")

        XCTAssertEqual(capturedParams?.objectValue?["approvalPolicy"], .string("never"))
        XCTAssertEqual(
            capturedParams?.objectValue?["sandboxPolicy"]?.objectValue?["type"],
            .string("dangerFullAccess")
        )
    }

    func testPhoneRuntimeSettingsBecomeThreadScopedWithoutChangingAppDefaults() {
        let service = makeService()
        service.availableModels = [makeModel(), makeGPT55Model()]
        service.setSelectedModelId("gpt-5.4")
        service.setSelectedReasoningEffort("medium")
        service.setSelectedServiceTier(nil)

        service.applyRemoteRuntimeSettings(from: CodexThread(
            id: "thread-remote",
            model: "gpt-5.5",
            reasoningEffort: "high",
            serviceTier: "fast",
            runtimeSettingsRevision: 1,
            runtimeSettingsUpdatedAt: 123,
            runtimeSettingsSource: "phone"
        ))

        XCTAssertEqual(service.selectedModelId, "gpt-5.4")
        XCTAssertEqual(service.runtimeModelIdentifierForTurn(), "gpt-5.4")
        XCTAssertEqual(service.runtimeModelIdentifierForTurn(threadId: "thread-remote"), "gpt-5.5")
        XCTAssertEqual(service.selectedReasoningEffortForSelectedModel(threadId: "thread-remote"), "high")
        XCTAssertEqual(service.effectiveServiceTier(for: "thread-remote"), .fast)

        service.applyRemoteRuntimeSettings(from: CodexThread(
            id: "thread-remote",
            model: "gpt-5.4",
            reasoningEffort: "medium",
            serviceTier: nil,
            runtimeSettingsRevision: 2,
            runtimeSettingsUpdatedAt: 456,
            runtimeSettingsSource: "phone"
        ))

        XCTAssertEqual(service.runtimeModelIdentifierForTurn(threadId: "thread-remote"), "gpt-5.4")
        XCTAssertEqual(service.selectedReasoningEffortForSelectedModel(threadId: "thread-remote"), "medium")
        XCTAssertNil(service.effectiveServiceTier(for: "thread-remote"))
    }

    func testRemoteRuntimeSettingsPreserveElectronAccessMode() {
        let service = makeService()
        service.availableModels = [makeModel(), makeGPT55Model()]

        service.applyRemoteRuntimeSettings(from: CodexThread(
            id: "thread-combined-runtime",
            model: "gpt-5.5",
            reasoningEffort: "high",
            serviceTier: "fast",
            runtimeSettingsRevision: 1,
            runtimeSettingsUpdatedAt: 123,
            runtimeSettingsSource: "phone",
            runtimeMode: "full-access"
        ))

        XCTAssertEqual(service.runtimeModelIdentifierForTurn(threadId: "thread-combined-runtime"), "gpt-5.5")
        XCTAssertEqual(service.effectiveAccessMode(for: "thread-combined-runtime"), .fullAccess)
    }

    func testNewerTimestampWinsAfterBridgeRevisionResets() {
        let service = makeService()
        service.availableModels = [makeModel(), makeGPT55Model()]

        service.applyRemoteRuntimeSettings(from: CodexThread(
            id: "thread-reset",
            model: "gpt-5.5",
            reasoningEffort: "high",
            serviceTier: "fast",
            runtimeSettingsRevision: 12,
            runtimeSettingsUpdatedAt: 100,
            runtimeSettingsSource: "phone"
        ))
        service.applyRemoteRuntimeSettings(from: CodexThread(
            id: "thread-reset",
            model: "gpt-5.4",
            reasoningEffort: "medium",
            serviceTier: nil,
            runtimeSettingsRevision: 1,
            runtimeSettingsUpdatedAt: 200,
            runtimeSettingsSource: "phone"
        ))

        XCTAssertEqual(service.runtimeModelIdentifierForTurn(threadId: "thread-reset"), "gpt-5.4")
        XCTAssertEqual(service.selectedReasoningEffortForSelectedModel(threadId: "thread-reset"), "medium")
        XCTAssertNil(service.effectiveServiceTier(for: "thread-reset"))
        XCTAssertEqual(service.threadRuntimeOverride(for: "thread-reset")?.runtimeSettingsRevision, 1)
    }

    func testDesktopRuntimeSettingsDoNotOverridePhoneSelection() {
        let service = makeService()
        service.availableModels = [makeModel(), makeGPT55Model()]
        service.setThreadModelOverride("gpt-5.4", for: "thread-phone-authority")
        service.setThreadReasoningEffortOverride("medium", for: "thread-phone-authority")

        service.applyRemoteRuntimeSettings(from: CodexThread(
            id: "thread-phone-authority",
            model: "gpt-5.5",
            reasoningEffort: "high",
            serviceTier: "fast",
            runtimeSettingsRevision: 9,
            runtimeSettingsUpdatedAt: 999,
            runtimeSettingsSource: "desktop"
        ))

        XCTAssertEqual(service.runtimeModelIdentifierForTurn(threadId: "thread-phone-authority"), "gpt-5.4")
        XCTAssertEqual(service.selectedReasoningEffortForSelectedModel(threadId: "thread-phone-authority"), "medium")
        XCTAssertNil(service.effectiveServiceTier(for: "thread-phone-authority"))
    }

    func testClearingSelectedModelFallsBackToGPT55Medium() {
        let service = makeService()
        service.availableModels = [makeGPT55Model(), makeModel()]
        service.setSelectedModelId("gpt-5.4")
        service.setSelectedReasoningEffort("high")

        service.setSelectedModelId(nil)

        XCTAssertEqual(service.selectedModelId, "gpt-5.5")
        XCTAssertEqual(service.selectedReasoningEffort, "medium")
        XCTAssertEqual(service.runtimeModelIdentifierForTurn(), "gpt-5.5")
        XCTAssertEqual(service.selectedReasoningEffortForSelectedModel(), "medium")
    }

    func testPersistedModelSelectionIsUsableBeforeModelListRefresh() {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        defaults.set("gpt-5.3-codex", forKey: CodexService.selectedModelIdDefaultsKey)

        let service = CodexService(defaults: defaults)
        Self.retainedServices.append(service)

        XCTAssertTrue(service.availableModels.isEmpty)
        XCTAssertTrue(service.hasPersistedSelectedModelId)
        XCTAssertEqual(service.selectedModelId, "gpt-5.3-codex")
        XCTAssertEqual(service.runtimeModelIdentifierForTurn(), "gpt-5.3-codex")
        XCTAssertEqual(service.selectedReasoningEffortForSelectedModel(), "medium")
        XCTAssertEqual(
            TurnComposerMetaMapper.modelTitle(forIdentifier: service.selectedModelId),
            "GPT-5.3-Codex"
        )
    }

    func testComposerShowsLoadingForPersistedDefaultBeforeModelListRefresh() {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        defaults.set("gpt-5.5", forKey: CodexService.selectedModelIdDefaultsKey)

        let service = CodexService(defaults: defaults)
        Self.retainedServices.append(service)
        service.isBootstrappingConnectionSync = true

        XCTAssertTrue(service.availableModels.isEmpty)
        XCTAssertNil(service.visibleSelectedModelIDForComposer())
        XCTAssertTrue(service.isRuntimeSelectionLoadingForComposer())
        XCTAssertEqual(service.runtimeModelIdentifierForTurn(), "gpt-5.5")
    }

    func testComposerKeepsCustomPersistedModelVisibleDuringBootstrap() {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        defaults.set("gpt-5.3-codex", forKey: CodexService.selectedModelIdDefaultsKey)

        let service = CodexService(defaults: defaults)
        Self.retainedServices.append(service)
        service.isBootstrappingConnectionSync = true

        XCTAssertEqual(service.visibleSelectedModelIDForComposer(), "gpt-5.3-codex")
        XCTAssertFalse(service.isRuntimeSelectionLoadingForComposer())
    }

    func testDefaultModelFallbackIsNotPersistedBeforeModelListRefresh() {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)

        let service = CodexService(defaults: defaults)
        Self.retainedServices.append(service)
        service.normalizeRuntimeSelectionsAfterModelsUpdate()

        XCTAssertFalse(service.hasPersistedSelectedModelId)
        XCTAssertNil(service.selectedModelId)
        XCTAssertNil(service.selectedReasoningEffort)
        XCTAssertEqual(service.runtimeModelIdentifierForTurn(), "gpt-5.5")
        XCTAssertNil(defaults.string(forKey: CodexService.selectedModelIdDefaultsKey))
    }

    func testModelListRefreshPersistsResolvedDefaultForFutureLaunches() {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)

        let firstService = CodexService(defaults: defaults)
        Self.retainedServices.append(firstService)
        firstService.availableModels = [makeGPT55Model(), makeModel()]
        firstService.normalizeRuntimeSelectionsAfterModelsUpdate()

        XCTAssertTrue(firstService.hasPersistedSelectedModelId)
        XCTAssertEqual(firstService.selectedModelId, "gpt-5.5")
        XCTAssertEqual(defaults.string(forKey: CodexService.selectedModelIdDefaultsKey), "gpt-5.5")

        let secondService = CodexService(defaults: defaults)
        Self.retainedServices.append(secondService)

        XCTAssertTrue(secondService.hasPersistedSelectedModelId)
        XCTAssertEqual(secondService.selectedModelId, "gpt-5.5")
    }

    func testContinuationInheritsThreadRuntimeOverrides() {
        let service = makeService()
        service.availableModels = [makeModel()]
        service.setSelectedModelId("gpt-5.4")
        service.applyThreadRuntimeOverride(CodexThreadRuntimeOverride(
            modelId: "gpt-5.4",
            reasoningEffort: "high",
            serviceTierRawValue: CodexServiceTier.fast.rawValue,
            overridesModel: true,
            overridesReasoning: true,
            overridesServiceTier: true,
            runtimeSettingsRevision: 9,
            runtimeSettingsUpdatedAt: 123
        ), to: "thread-old")

        service.inheritThreadRuntimeOverrides(from: "thread-old", to: "thread-new")

        XCTAssertEqual(
            service.selectedReasoningEffortForSelectedModel(threadId: "thread-new"),
            "high"
        )
        XCTAssertEqual(service.effectiveServiceTier(for: "thread-new"), .fast)
        XCTAssertEqual(service.threadRuntimeOverride(for: "thread-new")?.runtimeSettingsRevision, 0)
        XCTAssertEqual(service.threadRuntimeOverride(for: "thread-new")?.runtimeSettingsUpdatedAt, 0)
    }

    func testStartThreadUsesProvidedRuntimeOverrideForServiceTier() async throws {
        let service = makeService()
        service.isConnected = true
        service.availableModels = [makeModel()]
        service.setSelectedModelId("gpt-5.4")
        service.setSelectedServiceTier(nil)

        var capturedThreadStartParams: [JSONValue] = []
        service.requestTransportOverride = { method, params in
            XCTAssertEqual(method, "thread/start")
            capturedThreadStartParams.append(params ?? .null)
            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([
                    "thread": .object([
                        "id": .string("thread-new"),
                        "cwd": .string("/tmp/project"),
                    ]),
                ]),
                includeJSONRPC: false
            )
        }

        let override = CodexThreadRuntimeOverride(
            reasoningEffort: "high",
            serviceTierRawValue: "fast",
            overridesReasoning: true,
            overridesServiceTier: true
        )
        let thread = try await service.startThread(runtimeOverride: override)

        XCTAssertEqual(thread.id, "thread-new")
        XCTAssertEqual(capturedThreadStartParams.first?.objectValue?["serviceTier"]?.stringValue, "fast")
        XCTAssertEqual(service.effectiveServiceTier(for: "thread-new"), .fast)
        XCTAssertTrue(service.hydratedThreadIDs.contains("thread-new"))
        XCTAssertTrue(service.initialTurnsLoadedByThreadID.contains("thread-new"))
    }

    func testStartThreadDropsFastRuntimeOverrideWhenSelectedModelDoesNotSupportFastMode() async throws {
        let service = makeService()
        service.isConnected = true
        service.availableModels = [makeLowOnlyModel()]
        service.setSelectedModelId("gpt-5.4-low")

        var capturedThreadStartParams: [JSONValue] = []
        service.requestTransportOverride = { method, params in
            XCTAssertEqual(method, "thread/start")
            capturedThreadStartParams.append(params ?? .null)
            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([
                    "thread": .object([
                        "id": .string("thread-new"),
                        "cwd": .string("/tmp/project"),
                    ]),
                ]),
                includeJSONRPC: false
            )
        }

        let override = CodexThreadRuntimeOverride(
            reasoningEffort: "low",
            serviceTierRawValue: "fast",
            overridesReasoning: true,
            overridesServiceTier: true
        )
        _ = try await service.startThread(runtimeOverride: override)

        XCTAssertNil(capturedThreadStartParams.first?.objectValue?["serviceTier"]?.stringValue)
    }

    func testUnsupportedThreadReasoningOverrideIsNotReportedAsActive() {
        let service = makeService()
        service.availableModels = [makeLowOnlyModel()]
        service.setSelectedModelId("gpt-5.4-low")
        service.setThreadReasoningEffortOverride("high", for: "thread-old")

        XCTAssertFalse(service.isThreadReasoningEffortOverridden("thread-old"))
        XCTAssertEqual(service.selectedReasoningEffortForSelectedModel(threadId: "thread-old"), "low")
    }

    private func makeService() -> CodexService {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        let service = CodexService(defaults: defaults)
        Self.retainedServices.append(service)
        return service
    }

    private func makeModel() -> CodexModelOption {
        CodexModelOption(
            id: "gpt-5.4",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            description: "Test model",
            isDefault: true,
            supportsFastMode: true,
            supportedReasoningEfforts: [
                CodexReasoningEffortOption(reasoningEffort: "medium", description: "Medium"),
                CodexReasoningEffortOption(reasoningEffort: "high", description: "High"),
            ],
            defaultReasoningEffort: "medium"
        )
    }

    private func makeGPT55Model() -> CodexModelOption {
        CodexModelOption(
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Test model",
            isDefault: true,
            supportsFastMode: true,
            supportedReasoningEfforts: [
                CodexReasoningEffortOption(reasoningEffort: "medium", description: "Medium"),
                CodexReasoningEffortOption(reasoningEffort: "high", description: "High"),
            ],
            defaultReasoningEffort: "medium"
        )
    }

    private func makeLowOnlyModel() -> CodexModelOption {
        CodexModelOption(
            id: "gpt-5.4-low",
            model: "gpt-5.4-low",
            displayName: "GPT-5.4 Low",
            description: "Test model",
            isDefault: true,
            supportedReasoningEfforts: [
                CodexReasoningEffortOption(reasoningEffort: "low", description: "Low"),
            ],
            defaultReasoningEffort: "low"
        )
    }
}
