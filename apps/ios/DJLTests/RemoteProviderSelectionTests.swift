import XCTest
@testable import DJL

@MainActor
final class RemoteProviderSelectionTests: XCTestCase {
    private static var retainedServices: [CodexService] = []

    func testCatalogDecodesAndRetainsProviderIdentity() throws {
        let data = Data(#"{"id":"codex::gpt-6-astra","model":"gpt-6-astra","displayName":"GPT-6 Astra","djlProvider":"codex","providerDisplayName":"Codex","supportedReasoningEfforts":["high"]}"#.utf8)
        let model = try JSONDecoder().decode(CodexModelOption.self, from: data)
        XCTAssertEqual(model.djlProvider, "codex")
        XCTAssertEqual(model.providerDisplayName, "Codex")
        let roundTrip = try JSONDecoder().decode(CodexModelOption.self, from: JSONEncoder().encode(model))
        XCTAssertEqual(roundTrip, model)
    }

    func testTurnRequestCarriesTheChosenProviderAndRawModelTogether() throws {
        let service = CodexService(defaults: UserDefaults(suiteName: UUID().uuidString)!)
        Self.retainedServices.append(service)
        service.availableModels = ["codex", "claudeAgent"].map { provider in
            CodexModelOption(id: "\(provider)::shared-model", model: "shared-model", displayName: "Shared model", description: "", isDefault: provider == "codex", supportedReasoningEfforts: [], defaultReasoningEffort: nil, djlProvider: provider, providerDisplayName: provider)
        }
        service.setSelectedModelId("claudeAgent::shared-model")
        let params = try service.buildTurnStartRequestParams(threadId: "qa", userInput: "Hello", attachments: [], skillMentions: [], mentionMentions: [], imageURLKey: "image_url", includeStructuredSkillItems: false, includeStructuredMentionItems: false, collaborationMode: nil, includeServiceTier: false)
        XCTAssertEqual(params["djlProvider"], .string("claudeAgent"))
        XCTAssertEqual(params["model"], .string("shared-model"))
    }

    func testLegacyRawModelDoesNotSwitchTheThreadProvider() {
        let service = CodexService(defaults: UserDefaults(suiteName: UUID().uuidString)!)
        Self.retainedServices.append(service)
        service.threads = [CodexThread(id: "qa", model: "gpt-6-astra", modelProvider: "codex")]
        service.availableModels = [
            CodexModelOption(id: "codex::gpt-6-astra", model: "gpt-6-astra", displayName: "GPT-6 Astra", description: "", isDefault: true, supportedReasoningEfforts: [], defaultReasoningEffort: nil, djlProvider: "codex"),
            CodexModelOption(id: "opencode::openai/gpt-5", model: "openai/gpt-5", displayName: "GPT-5", description: "", isDefault: false, supportedReasoningEfforts: [], defaultReasoningEffort: nil, djlProvider: "opencode"),
        ]
        service.setThreadModelOverride("openai/gpt-5", for: "qa")
        XCTAssertEqual(service.selectedModelOption(threadId: "qa")?.djlProvider, "codex")
        XCTAssertEqual(service.runtimeModelIdentifierForTurn(threadId: "qa"), "gpt-6-astra")
        service.setThreadModelOverride("opencode::openai/gpt-5", for: "qa")
        XCTAssertEqual(service.selectedModelOption(threadId: "qa")?.djlProvider, "opencode")
    }

    func testStudioScopeSurvivesThreadEncoding() throws {
        var thread = CodexThread(id: "qa", cwd: "/work/studio")
        thread.djlScope = "studio"
        let decoded = try JSONDecoder().decode(CodexThread.self, from: JSONEncoder().encode(thread))
        XCTAssertEqual(decoded.djlScope, "studio")
    }
}
