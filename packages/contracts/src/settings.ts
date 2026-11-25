import { Schema } from "effect";
import { TrimmedString } from "./baseSchemas";
import { DEFAULT_GIT_TEXT_GENERATION_MODEL } from "./model";
import { ModelSelection, ProviderKind, ThreadEnvironmentMode } from "./orchestration";

const StringSetting = TrimmedString.check(Schema.isMaxLength(4096));
const CustomModels = Schema.Array(Schema.String.check(Schema.isMaxLength(256))).pipe(
  Schema.withDecodingDefault(() => []),
);

const ProviderSettingsBase = {
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  customModels: CustomModels,
};

export const CodexServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "codex")),
  homePath: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type CodexServerProviderSettings = typeof CodexServerProviderSettings.Type;

export const ClaudeServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "claude")),
  launchArgs: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withDecodingDefault(() => ""),
  ),
});
export type ClaudeServerProviderSettings = typeof ClaudeServerProviderSettings.Type;

export const GeminiServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "gemini")),
});
export type GeminiServerProviderSettings = typeof GeminiServerProviderSettings.Type;

export const GrokServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "grok")),
});
export type GrokServerProviderSettings = typeof GrokServerProviderSettings.Type;

export const KimiServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "kimi")),
  region: Schema.Literals(["existing", "global", "mainland-cn"]).pipe(
    Schema.withDecodingDefault(() => "existing"),
  ),
});
export type KimiServerProviderSettings = typeof KimiServerProviderSettings.Type;

export const IFlowServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "iflow")),
});
export type IFlowServerProviderSettings = typeof IFlowServerProviderSettings.Type;

export const QwenServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "qwen")),
});
export type QwenServerProviderSettings = typeof QwenServerProviderSettings.Type;

// https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli — npm `@github/copilot` installs `copilot`.
export const CopilotServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "copilot")),
});
export type CopilotServerProviderSettings = typeof CopilotServerProviderSettings.Type;

export const CodeBuddyServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "codebuddy")),
});
export type CodeBuddyServerProviderSettings = typeof CodeBuddyServerProviderSettings.Type;

// Doubao and DeepSeek coding plans run on the Claude Code harness; binaryPath is that `claude`.
// Their API keys live in the server secret store, never in settings.
export const DoubaoServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "claude")),
  region: Schema.Literals(["china", "international"]).pipe(
    Schema.withDecodingDefault(() => "china"),
  ),
});
export type DoubaoServerProviderSettings = typeof DoubaoServerProviderSettings.Type;

export const DeepSeekServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "claude")),
});
export type DeepSeekServerProviderSettings = typeof DeepSeekServerProviderSettings.Type;

export const MuseServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "muse")),
});
export type MuseServerProviderSettings = typeof MuseServerProviderSettings.Type;

export const DroidServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "droid")),
});
export type DroidServerProviderSettings = typeof DroidServerProviderSettings.Type;

export const CursorServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "cursor-agent")),
  apiEndpoint: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type CursorServerProviderSettings = typeof CursorServerProviderSettings.Type;

export const OpenCodeServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  serverUrl: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  serverPassword: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  experimentalWebSockets: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
});
export type OpenCodeServerProviderSettings = typeof OpenCodeServerProviderSettings.Type;

export const KiloServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "kilo")),
  serverUrl: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  serverPassword: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type KiloServerProviderSettings = typeof KiloServerProviderSettings.Type;

/**
 * DJL Cloud: the hosted, credit-based provider. The session token never lives
 * in settings (settings are streamed to the renderer); it is stored in the
 * server's secrets directory. Only the preferred region hint is a setting.
 */
export const DjlCloudServerProviderSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  region: Schema.Literals(["auto", "global", "asia"]).pipe(
    Schema.withDecodingDefault(() => "auto" as const),
  ),
});
export type DjlCloudServerProviderSettings = typeof DjlCloudServerProviderSettings.Type;

export const PiServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "pi")),
  agentDir: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type PiServerProviderSettings = typeof PiServerProviderSettings.Type;

const DisabledSkillNames = Schema.Array(Schema.String.check(Schema.isMaxLength(256))).pipe(
  Schema.withDecodingDefault(() => []),
);

// User-level skill toggles. Skills are keyed by lowercased name because the
// unified catalog dedupes provider copies of the same skill by name.
export const SkillsServerSettings = Schema.Struct({
  disabled: DisabledSkillNames,
});
export type SkillsServerSettings = typeof SkillsServerSettings.Type;

// Which harnesses list downloaded local (Ollama) models in their model picker.
const LocalModelHarnessToggle = Schema.Boolean.pipe(Schema.withDecodingDefault(() => true));
export const LocalModelsServerSettings = Schema.Struct({
  harnesses: Schema.Struct({
    claudeAgent: LocalModelHarnessToggle,
    codex: LocalModelHarnessToggle,
    opencode: LocalModelHarnessToggle,
  }).pipe(Schema.withDecodingDefault(() => ({}))),
});
export type LocalModelsServerSettings = typeof LocalModelsServerSettings.Type;
export type LocalModelHarness = keyof LocalModelsServerSettings["harnesses"];
// Extra Claude Code / Codex subscription accounts. Each lives in its own CLI config folder
// (`dir`), so its login stays separate; `active` names the account new chats use for each
// provider, and an absent entry means the CLI's normal login.
export const CliAccountProvider = Schema.Literals(["claudeAgent", "codex"]);
export type CliAccountProvider = typeof CliAccountProvider.Type;
export const CliAccountId = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,80}$/));
export const CliAccountSetting = Schema.Struct({
  id: CliAccountId,
  provider: CliAccountProvider,
  name: Schema.String.check(Schema.isMaxLength(80)),
  dir: Schema.String.check(Schema.isMaxLength(1024)),
});
export type CliAccountSetting = typeof CliAccountSetting.Type;
const CliAccountActive = Schema.Struct({
  claudeAgent: Schema.optionalKey(CliAccountId),
  codex: Schema.optionalKey(CliAccountId),
});
export const CliAccountsServerSettings = Schema.Struct({
  accounts: Schema.Array(CliAccountSetting).pipe(Schema.withDecodingDefault(() => [])),
  active: CliAccountActive.pipe(Schema.withDecodingDefault(() => ({}))),
  /** When a chat's account hits its usage limit, continue on the account with the most left. */
  autoSwitch: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
});
export type CliAccountsServerSettings = typeof CliAccountsServerSettings.Type;

export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  enableProviderUpdateChecks: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  enableAutomaticProviderUpdates: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  defaultThreadEnvMode: ThreadEnvironmentMode.pipe(Schema.withDecodingDefault(() => "local")),
  addProjectBaseDirectory: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(() => ({
      provider: "opencode" as const,
      model: DEFAULT_GIT_TEXT_GENERATION_MODEL,
    })),
  ),
  providers: Schema.Struct({
    codex: CodexServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    claudeAgent: ClaudeServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    cursor: CursorServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    gemini: GeminiServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    grok: GrokServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    kimi: KimiServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    iflow: IFlowServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    qwen: QwenServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    copilot: CopilotServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    codebuddy: CodeBuddyServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    doubao: DoubaoServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    deepseek: DeepSeekServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    muse: MuseServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    droid: DroidServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    kilo: KiloServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    opencode: OpenCodeServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    pi: PiServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    djlCloud: DjlCloudServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  }).pipe(Schema.withDecodingDefault(() => ({}))),
  skills: SkillsServerSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  localModels: LocalModelsServerSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  cliAccounts: CliAccountsServerSettings.pipe(Schema.withDecodingDefault(() => ({}))),
});
export type ServerSettings = typeof ServerSettings.Type;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = Schema.decodeSync(ServerSettings)({});

const ModelSelectionPatch = Schema.Struct({
  provider: Schema.optionalKey(ProviderKind),
  model: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(256))),
  options: Schema.optionalKey(Schema.Unknown),
});

const ProviderSettingsBasePatch = {
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(StringSetting),
  customModels: Schema.optionalKey(CustomModels),
};

export const ServerSettingsPatch = Schema.Struct({
  enableAssistantStreaming: Schema.optionalKey(Schema.Boolean),
  enableProviderUpdateChecks: Schema.optionalKey(Schema.Boolean),
  enableAutomaticProviderUpdates: Schema.optionalKey(Schema.Boolean),
  defaultThreadEnvMode: Schema.optionalKey(ThreadEnvironmentMode),
  addProjectBaseDirectory: Schema.optionalKey(StringSetting),
  textGenerationModelSelection: Schema.optionalKey(ModelSelectionPatch),
  providers: Schema.optionalKey(
    Schema.Struct({
      codex: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          homePath: Schema.optionalKey(StringSetting),
        }),
      ),
      claudeAgent: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          launchArgs: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4096))),
        }),
      ),
      cursor: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          apiEndpoint: Schema.optionalKey(StringSetting),
        }),
      ),
      gemini: Schema.optionalKey(Schema.Struct(ProviderSettingsBasePatch)),
      grok: Schema.optionalKey(Schema.Struct(ProviderSettingsBasePatch)),
      kimi: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          region: Schema.optionalKey(Schema.Literals(["existing", "global", "mainland-cn"])),
        }),
      ),
      iflow: Schema.optionalKey(Schema.Struct(ProviderSettingsBasePatch)),
      qwen: Schema.optionalKey(Schema.Struct(ProviderSettingsBasePatch)),
      copilot: Schema.optionalKey(Schema.Struct(ProviderSettingsBasePatch)),
      codebuddy: Schema.optionalKey(Schema.Struct(ProviderSettingsBasePatch)),
      doubao: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          region: Schema.optionalKey(Schema.Literals(["china", "international"])),
        }),
      ),
      deepseek: Schema.optionalKey(Schema.Struct(ProviderSettingsBasePatch)),
      muse: Schema.optionalKey(Schema.Struct(ProviderSettingsBasePatch)),
      droid: Schema.optionalKey(Schema.Struct(ProviderSettingsBasePatch)),
      kilo: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          serverUrl: Schema.optionalKey(StringSetting),
          serverPassword: Schema.optionalKey(StringSetting),
        }),
      ),
      opencode: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          serverUrl: Schema.optionalKey(StringSetting),
          serverPassword: Schema.optionalKey(StringSetting),
          experimentalWebSockets: Schema.optionalKey(Schema.Boolean),
        }),
      ),
      pi: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          binaryPath: Schema.optionalKey(StringSetting),
          agentDir: Schema.optionalKey(StringSetting),
        }),
      ),
      djlCloud: Schema.optionalKey(
        Schema.Struct({
          enabled: Schema.optionalKey(Schema.Boolean),
          region: Schema.optionalKey(Schema.Literals(["auto", "global", "asia"])),
        }),
      ),
    }),
  ),
  skills: Schema.optionalKey(
    Schema.Struct({
      disabled: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMaxLength(256)))),
    }),
  ),
  localModels: Schema.optionalKey(
    Schema.Struct({
      harnesses: Schema.optionalKey(
        Schema.Struct({
          claudeAgent: Schema.optionalKey(Schema.Boolean),
          codex: Schema.optionalKey(Schema.Boolean),
          opencode: Schema.optionalKey(Schema.Boolean),
        }),
      ),
    }),
  ),
  cliAccounts: Schema.optionalKey(
    Schema.Struct({
      accounts: Schema.optionalKey(Schema.Array(CliAccountSetting)),
      active: Schema.optionalKey(CliAccountActive),
      autoSwitch: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;

export class ServerSettingsError extends Schema.TaggedErrorClass<ServerSettingsError>()(
  "ServerSettingsError",
  {
    settingsPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Server settings error at ${this.settingsPath}: ${this.detail}`;
  }
}
