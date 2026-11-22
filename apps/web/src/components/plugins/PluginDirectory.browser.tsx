// FILE: PluginDirectory.browser.tsx
// Purpose: Verifies the plugin directory and detail screens against a fixed snapshot.
// Layer: Browser UI test

import "../../index.css";

import type {
  PluginAppConnection,
  PluginAppInput,
  PluginCatalogEntry,
  PluginsSnapshot,
} from "@synara/contracts";
import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { PluginDetailView } from "./PluginDetail";
import { PluginDirectoryView } from "./PluginDirectory";
import { AddCustomServerDialog } from "./AddCustomServerDialog";
import { AddMarketplaceDialog } from "./AddMarketplaceDialog";
import { PluginTokenDialog } from "./PluginTokenDialog";
import { UploadPluginDialog } from "./UploadPluginDialog";
import { PluginManageView } from "./PluginManage";
import { PluginsSettingsView } from "./PluginsSettingsPanel";

const hosted = (
  id: string,
  displayName: string,
  category: string,
  featured: boolean,
): PluginCatalogEntry => ({
  id,
  name: id,
  displayName,
  shortDescription: `Work with ${displayName}`,
  longDescription: `Use ${displayName} from any DJL agent.`,
  category,
  featured,
  builtIn: false,
  developer: displayName,
  version: "1.0.0",
  websiteUrl: `https://${id}.example`,
  privacyPolicyUrl: `https://${id}.example/privacy`,
  capabilities: ["Read", "Write"],
  examplePrompts: [`List my ${displayName} items`, "Create one", "Summarize the week"],
  apps: [
    {
      id,
      name: displayName,
      transport: { type: "http", url: `https://mcp.${id}.example/mcp` },
      auth: "oauth",
    },
  ],
  skills: [],
});

const multipost: PluginCatalogEntry = {
  id: "djl-multipost",
  name: "multipost",
  displayName: "MultiPost",
  shortDescription: "Publish to your social accounts",
  category: "Marketing",
  featured: true,
  builtIn: true,
  developer: "DJL",
  version: "1.0.0",
  capabilities: ["Publishing"],
  examplePrompts: ["Post this to my accounts", "Draft a post", "Show my results"],
  apps: [
    {
      id: "DJL multipost mcp",
      name: "DJL multipost mcp",
      transport: { type: "builtin" },
      auth: "none",
    },
  ],
  skills: [{ name: "multipost-post", description: "Post with confirmation" }],
};

const linear = hosted("linear", "Linear", "Planning and docs", true);
const sentry = hosted("sentry", "Sentry", "Developer tools", false);

const baseSnapshot: PluginsSnapshot = {
  sources: [{ id: "djl", kind: "djl", name: "DJL", plugins: [multipost, linear, sentry] }],
  installed: [],
  connections: [],
};

const withLinearAdded: PluginsSnapshot = {
  ...baseSnapshot,
  installed: [{ pluginId: "linear", enabled: true, installedAt: "2026-11-19T00:00:00.000Z" }],
  connections: [{ pluginId: "linear", appId: "linear", state: "not_connected" }],
};

const withLinear = (connection: Partial<PluginAppConnection>): PluginsSnapshot => ({
  ...withLinearAdded,
  connections: [{ pluginId: "linear", appId: "linear", state: "not_connected", ...connection }],
});

function Directory(props: {
  onOpen?: (pluginId: string) => void;
  initial?: PluginsSnapshot;
  notice?: string;
  onRefreshMarketplace?: (sourceId: string) => void;
  onRemoveMarketplace?: (sourceId: string) => void;
}) {
  const [snapshot, setSnapshot] = useState(props.initial ?? baseSnapshot);
  return (
    <div className="dark h-[780px] overflow-y-auto bg-background text-foreground">
      <PluginDirectoryView
        snapshot={snapshot}
        loading={false}
        error={undefined}
        pendingPluginId={undefined}
        onOpen={props.onOpen ?? vi.fn()}
        onAdd={(pluginId) => {
          if (pluginId === "linear") setSnapshot(withLinearAdded);
        }}
        onUninstall={() => setSnapshot(baseSnapshot)}
        onRefresh={vi.fn()}
        onOpenSettings={vi.fn()}
        onAddServer={vi.fn()}
        onCreateSkill={vi.fn()}
        onAddMarketplace={vi.fn()}
        onUploadPlugin={vi.fn()}
        notice={props.notice}
        onRefreshMarketplace={props.onRefreshMarketplace ?? vi.fn()}
        onRemoveMarketplace={props.onRemoveMarketplace ?? vi.fn()}
      />
    </div>
  );
}

function detail(snapshot: PluginsSnapshot, plugin: PluginCatalogEntry) {
  const handlers = {
    onBack: vi.fn(),
    onAdd: vi.fn(),
    onUninstall: vi.fn(),
    onManage: vi.fn(),
    onConnect: vi.fn<(input: PluginAppInput) => void>(),
    onDisconnect: vi.fn<(input: PluginAppInput) => void>(),
    onUse: vi.fn<(prompt: string) => void>(),
    onOpenLink: vi.fn<(url: string) => void>(),
  };
  return {
    handlers,
    element: (
      <div className="dark h-[780px] overflow-y-auto bg-background text-foreground">
        <PluginDetailView
          snapshot={snapshot}
          plugin={plugin}
          pending={false}
          error={undefined}
          {...handlers}
        />
      </div>
    ),
  };
}

describe("Plugin directory", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("groups plugins into a featured section and one section per category", async () => {
    const screen = await render(<Directory />);
    const featured = page.getByRole("region", { name: "Featured" });
    await expect.element(featured.getByText("MultiPost", { exact: true })).toBeVisible();
    await expect.element(featured.getByText("Linear", { exact: true })).toBeVisible();
    await expect.element(featured.getByText("Sentry", { exact: true })).not.toBeInTheDocument();
    await expect
      .element(
        page.getByRole("region", { name: "Developer tools" }).getByText("Sentry", { exact: true }),
      )
      .toBeVisible();
    await screen.unmount();
  });

  it("searches across plugins and says when nothing matches", async () => {
    const screen = await render(<Directory />);
    const search = page.getByRole("textbox", { name: "Search plugins" });
    await search.fill("sentry");
    const results = page.getByRole("region", { name: "Results" });
    await expect.element(results.getByText("Sentry", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Linear", { exact: true })).not.toBeInTheDocument();
    await search.fill("zzzz");
    await expect.element(page.getByText("No matches. Try another search.")).toBeVisible();
    await screen.unmount();
  });

  it("adds a plugin with one click and then offers uninstall instead", async () => {
    const onOpen = vi.fn<(pluginId: string) => void>();
    const screen = await render(<Directory onOpen={onOpen} />);
    const tools = page.getByRole("region", { name: "Planning and docs" });
    await tools.getByRole("button", { name: "Add Linear" }).click();
    await expect.element(tools.getByRole("button", { name: "Add Linear" })).not.toBeInTheDocument();
    await tools.getByRole("button", { name: "More actions for Linear" }).click();
    // The menu names the plugin it acts on and keeps Uninstall apart below a rule.
    await expect.element(page.getByText("By Linear")).toBeVisible();
    const separators = page.getByRole("separator").elements();
    expect(separators.at(-1)?.nextElementSibling?.textContent).toBe("Uninstall");
    await page.getByRole("menuitem", { name: "Uninstall" }).click();
    await expect.element(tools.getByRole("button", { name: "Add Linear" })).toBeVisible();

    await tools.getByRole("button", { name: /Linear Work with Linear/ }).click();
    expect(onOpen).toHaveBeenCalledWith("linear");
    await screen.unmount();
  });

  it("never offers to uninstall a built-in plugin", async () => {
    const screen = await render(<Directory />);
    const marketing = page.getByRole("region", { name: "Marketing" });
    await marketing.getByRole("button", { name: "More actions for MultiPost" }).click();
    await expect.element(page.getByRole("menuitem", { name: "View details" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Uninstall" })).not.toBeInTheDocument();
    await screen.unmount();
  });
});

describe("Plugin detail", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers Add for a plugin that is not added and keeps its prompts disabled", async () => {
    const { element, handlers } = detail(baseSnapshot, linear);
    const screen = await render(element);
    await expect.element(page.getByRole("heading", { name: "Linear", exact: true })).toBeVisible();
    await expect.element(page.getByText("By Linear · Work with Linear")).toBeVisible();
    await expect.element(page.getByRole("button", { name: /List my Linear items/ })).toBeDisabled();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    expect(handlers.onAdd).toHaveBeenCalledOnce();
    await screen.unmount();
  });

  it("shows an added but unconnected app as not connected and blocks Try now", async () => {
    const { element, handlers } = detail(withLinearAdded, linear);
    const screen = await render(element);
    await expect.element(page.getByText("Not connected")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Try now" })).toBeDisabled();
    await page.getByRole("button", { name: "More actions for Linear" }).click();
    await page.getByRole("menuitem", { name: "Uninstall" }).click();
    expect(handlers.onUninstall).toHaveBeenCalledOnce();
    await page.getByRole("button", { name: "Open Privacy Policy" }).click();
    expect(handlers.onOpenLink).toHaveBeenCalledWith("https://linear.example/privacy");
    await expect
      .element(page.getByRole("button", { name: "Open Terms of Service" }))
      .not.toBeInTheDocument();
    await screen.unmount();
  });

  it("offers Connect and Manage for an added plugin that is not signed in", async () => {
    const { element, handlers } = detail(withLinearAdded, linear);
    const screen = await render(element);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    expect(handlers.onConnect).toHaveBeenCalledWith({ pluginId: "linear", appId: "linear" });
    await page.getByRole("button", { name: "Manage" }).click();
    expect(handlers.onManage).toHaveBeenCalledOnce();
    await screen.unmount();
  });

  it("offers Disconnect and unlocks the prompts once signed in", async () => {
    const { element, handlers } = detail(withLinear({ state: "connected" }), linear);
    const screen = await render(element);
    await expect.element(page.getByText("Connected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Disconnect" }).click();
    expect(handlers.onDisconnect).toHaveBeenCalledWith({ pluginId: "linear", appId: "linear" });
    await page.getByRole("button", { name: /Create one/ }).click();
    expect(handlers.onUse).toHaveBeenCalledWith("Create one");
    await screen.unmount();
  });

  it("offers Reconnect when the sign-in expired or failed, and says why", async () => {
    const expired = detail(withLinear({ state: "expired" }), linear);
    let screen = await render(expired.element);
    await expect.element(page.getByText("Sign-in expired")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Try now" })).toBeDisabled();
    await page.getByRole("button", { name: "Reconnect" }).click();
    expect(expired.handlers.onConnect).toHaveBeenCalledOnce();
    await screen.unmount();

    const failed = detail(withLinear({ state: "error", message: "Sign-in was refused" }), linear);
    screen = await render(failed.element);
    await expect.element(page.getByRole("alert")).toHaveTextContent("Sign-in was refused");
    await expect.element(page.getByRole("button", { name: "Reconnect" })).toBeVisible();
    await screen.unmount();
  });

  it("shows that it is waiting while the user signs in in their browser", async () => {
    const { element } = detail(withLinear({ state: "connecting" }), linear);
    const screen = await render(element);
    await expect.element(page.getByText("Waiting for you to sign in…")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
    await screen.unmount();
  });

  it("lets a built-in plugin's prompts start a chat and lists its skills", async () => {
    const { element, handlers } = detail(baseSnapshot, multipost);
    const screen = await render(element);
    await expect.element(page.getByText("Built in")).toBeVisible();
    await expect.element(page.getByText("$multipost-post")).toBeVisible();
    await page.getByRole("button", { name: /Draft a post/ }).click();
    expect(handlers.onUse).toHaveBeenCalledWith("Draft a post");
    await page.getByRole("button", { name: "Try now" }).click();
    expect(handlers.onUse).toHaveBeenLastCalledWith("Post this to my accounts");
    await screen.unmount();
  });
});

describe("Plugin manage page", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("signs out, uninstalls, and lists the plugin's details", async () => {
    const snapshot = withLinear({ state: "connected" });
    const handlers = {
      onBack: vi.fn(),
      onViewDetails: vi.fn(),
      onUninstall: vi.fn(),
      onConnect: vi.fn<(input: PluginAppInput) => void>(),
      onDisconnect: vi.fn<(input: PluginAppInput) => void>(),
      onOpenLink: vi.fn<(url: string) => void>(),
    };
    const screen = await render(
      <div className="dark h-[780px] overflow-y-auto bg-background text-foreground">
        <PluginManageView
          snapshot={snapshot}
          plugin={linear}
          installed={snapshot.installed[0]!}
          pending={false}
          error={undefined}
          {...handlers}
        />
      </div>,
    );
    await page.getByRole("button", { name: "Disconnect" }).click();
    expect(handlers.onDisconnect).toHaveBeenCalledWith({ pluginId: "linear", appId: "linear" });
    await page.getByRole("button", { name: "View details" }).click();
    expect(handlers.onViewDetails).toHaveBeenCalledOnce();
    await page.getByRole("button", { name: "Uninstall" }).click();
    expect(handlers.onUninstall).toHaveBeenCalledOnce();

    await expect.element(page.getByText("Browser sign-in (OAuth)")).toBeVisible();
    // Shown in the viewer's own time zone, so the expected text is computed the same way.
    const added = new Date(snapshot.installed[0]!.installedAt).toLocaleDateString("en", {
      dateStyle: "medium",
    });
    expect(added).toMatch(/^Nov (18|19), 2026$/);
    await expect.element(page.getByText(added)).toBeVisible();
    await page.getByRole("button", { name: "View privacy policy" }).click();
    expect(handlers.onOpenLink).toHaveBeenCalledWith("https://linear.example/privacy");
    // The fixture has no terms link, so the row is left out rather than shown empty.
    await expect.element(page.getByText("Terms of Service")).not.toBeInTheDocument();
    await screen.unmount();
  });
});

describe("PluginsSettingsView", () => {
  const word: PluginCatalogEntry = {
    ...multipost,
    id: "djl-word",
    name: "word",
    displayName: "Word Documents",
    apps: [],
    skills: [{ name: "word-documents", description: "Create and edit .docx files" }],
  };
  const snapshot: PluginsSnapshot = {
    sources: [{ id: "djl", kind: "djl", name: "DJL", plugins: [word, linear, sentry] }],
    installed: [
      { pluginId: "linear", enabled: true, installedAt: "2026-11-19T00:00:00.000Z" },
      { pluginId: "sentry", enabled: false, installedAt: "2026-11-19T00:00:00.000Z" },
    ],
    connections: [
      { pluginId: "linear", appId: "linear", state: "connected" },
      { pluginId: "sentry", appId: "sentry", state: "connected" },
    ],
  };
  const settings = () => {
    const handlers = {
      onOpen: vi.fn(),
      onBrowse: vi.fn(),
      onRefresh: vi.fn(),
      onSetEnabled: vi.fn(),
      onConnect: vi.fn(),
      onDisconnect: vi.fn(),
    };
    return {
      handlers,
      element: (
        <div className="dark h-[780px] overflow-y-auto bg-background p-6 text-foreground">
          <PluginsSettingsView
            snapshot={snapshot}
            pending={false}
            error={undefined}
            skills={<p>Provider skills</p>}
            {...handlers}
          />
        </div>
      ),
    };
  };

  it("lists added plugins with a switch, and keeps built-in ones always on", async () => {
    const { element, handlers } = settings();
    await render(element);
    await expect.element(page.getByRole("tab", { name: /Plugins\s*3/ })).toBeVisible();
    await expect
      .element(page.getByRole("switch", { name: "Turn Word Documents on or off" }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("switch", { name: "Turn Sentry on or off" }))
      .not.toBeChecked();
    await page.getByRole("switch", { name: "Turn Linear on or off" }).click();
    expect(handlers.onSetEnabled).toHaveBeenCalledWith({ pluginId: "linear", enabled: false });
  });

  it("shows only the tool servers a new chat is given", async () => {
    await render(settings().element);
    // Sentry is connected but turned off, so agents do not get it.
    await page.getByRole("tab", { name: /MCP servers\s*1/ }).click();
    await expect.element(page.getByText("djl_linear")).toBeVisible();
    await expect.element(page.getByText("djl_sentry")).not.toBeInTheDocument();
  });

  it("lists plugin skills above the provider skills, and filters by search", async () => {
    await render(settings().element);
    await page.getByRole("tab", { name: /Skills\s*1/ }).click();
    await expect.element(page.getByText("$word-documents")).toBeVisible();
    await expect.element(page.getByText("Provider skills")).toBeVisible();
    await page.getByRole("textbox").fill("linear");
    await expect.element(page.getByRole("tab", { name: /Plugins\s*1/ })).toBeVisible();
    await expect.element(page.getByRole("tab", { name: /Skills\s*0/ })).toBeVisible();
  });
});

describe("AddCustomServerDialog", () => {
  it("submits the trimmed address and leaves out an empty token", async () => {
    const onSubmit = vi.fn();
    await render(
      <AddCustomServerDialog
        open
        pending={false}
        error="DJL could not reach that address."
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    await expect.element(page.getByRole("alert")).toHaveTextContent("could not reach");
    await expect.element(page.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    await page.getByLabelText("Name").fill("My Tools");
    await page.getByLabelText("Server address").fill(" https://tools.example/mcp ");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    expect(onSubmit).toHaveBeenCalledWith({ name: "My Tools", url: "https://tools.example/mcp" });
  });
});

const github: PluginCatalogEntry = {
  ...hosted("github", "GitHub", "Developer tools", true),
  apps: [
    {
      id: "github",
      name: "GitHub",
      transport: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      auth: "apiKey",
      tokenUrl: "https://github.com/settings/tokens/new",
      tokenScopes: ["repo", "read:org"],
    },
  ],
};
const withGithub = (state: PluginAppConnection["state"]): PluginsSnapshot => ({
  sources: [{ id: "djl", kind: "djl", name: "DJL", plugins: [github] }],
  installed: [{ pluginId: "github", enabled: true, installedAt: "2026-11-20T00:00:00.000Z" }],
  connections: [{ pluginId: "github", appId: "github", state }],
});

describe("Access-token apps", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers Connect, then Disconnect once a token is saved", async () => {
    const notConnected = detail(withGithub("not_connected"), github);
    let screen = await render(notConnected.element);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    expect(notConnected.handlers.onConnect).toHaveBeenCalledWith({
      pluginId: "github",
      appId: "github",
    });
    await screen.unmount();

    const connected = detail(withGithub("connected"), github);
    screen = await render(connected.element);
    await page.getByRole("button", { name: "Disconnect" }).click();
    expect(connected.handlers.onDisconnect).toHaveBeenCalledOnce();
    await screen.unmount();
  });

  it("asks for a token, links to where it is made, and lists the scopes to pick", async () => {
    const onSubmit = vi.fn<(token: string) => void>();
    const onOpenLink = vi.fn<(url: string) => void>();
    const screen = await render(
      <PluginTokenDialog
        open
        appName="GitHub"
        tokenUrl="https://github.com/settings/tokens/new"
        tokenScopes={["repo", "read:org"]}
        pending={false}
        error="The server refused this access token."
        onOpenChange={vi.fn()}
        onOpenLink={onOpenLink}
        onSubmit={onSubmit}
      />,
    );
    await expect.element(page.getByRole("heading", { name: "Connect GitHub" })).toBeVisible();
    await expect
      .element(page.getByText("When you create it, select: repo, read:org"))
      .toBeVisible();
    await expect.element(page.getByRole("alert")).toHaveTextContent("refused this access token");
    await page.getByRole("button", { name: "Create a token" }).click();
    expect(onOpenLink).toHaveBeenCalledWith("https://github.com/settings/tokens/new");
    const connect = page.getByRole("button", { name: "Connect", exact: true });
    await expect.element(connect).toBeDisabled();
    await page.getByLabelText("Access token").fill("  ghp_example  ");
    await connect.click();
    expect(onSubmit).toHaveBeenCalledWith("ghp_example");
    await screen.unmount();
  });
});

describe("Plugin sources", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const marketPlugin = {
    ...hosted("market-acme--tools", "Acme Tools", "Design", false),
  };
  const withMarketplace: PluginsSnapshot = {
    ...baseSnapshot,
    sources: [
      ...baseSnapshot.sources,
      {
        id: "market-acme",
        kind: "marketplace",
        name: "Acme Market",
        url: "https://market.example/plugins.json",
        plugins: [marketPlugin],
      },
    ],
  };

  it("shows a marketplace in its own tab with Refresh and Remove", async () => {
    const onRefresh = vi.fn<(sourceId: string) => void>();
    const onRemove = vi.fn<(sourceId: string) => void>();
    const screen = await render(
      <Directory
        initial={withMarketplace}
        notice="Plugins left out because their manifest is not valid: 2"
        onRefreshMarketplace={onRefresh}
        onRemoveMarketplace={onRemove}
      />,
    );
    // The All tab keeps the catalog and leaves marketplace plugins to their own tab.
    await expect.element(page.getByText("Linear", { exact: true }).first()).toBeVisible();
    await expect.element(page.getByText("Acme Tools", { exact: true })).not.toBeInTheDocument();

    await page.getByRole("tab", { name: "Acme Market" }).click();
    await expect.element(page.getByText("Acme Tools", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Linear", { exact: true })).not.toBeInTheDocument();
    await expect
      .element(page.getByText("Plugins left out because their manifest is not valid: 2"))
      .toBeVisible();
    await page.getByRole("button", { name: "Refresh marketplace" }).click();
    expect(onRefresh).toHaveBeenCalledWith("market-acme");
    await page.getByRole("button", { name: "Remove marketplace" }).click();
    expect(onRemove).toHaveBeenCalledWith("market-acme");
    await screen.unmount();
  });

  it("shows no tabs while there is no marketplace", async () => {
    const screen = await render(<Directory />);
    await expect.element(page.getByRole("tab", { name: "All" })).not.toBeInTheDocument();
    await screen.unmount();
  });

  it("adds a marketplace by its trimmed address", async () => {
    const onSubmit = vi.fn<(url: string) => void>();
    const screen = await render(
      <AddMarketplaceDialog
        open
        pending={false}
        error={undefined}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const add = page.getByRole("button", { name: "Add", exact: true });
    await expect.element(add).toBeDisabled();
    await page.getByLabelText("Marketplace address").fill(" https://market.example/plugins.json ");
    await add.click();
    expect(onSubmit).toHaveBeenCalledWith("https://market.example/plugins.json");
    await screen.unmount();
  });

  it("adds a plugin from pasted manifest JSON and shows why one was refused", async () => {
    const onSubmit = vi.fn<(manifest: string) => void>();
    const screen = await render(
      <UploadPluginDialog
        open
        pending={false}
        error={"This plugin manifest is not valid:\nid: Use up to 63 lowercase letters"}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    await expect.element(page.getByRole("alert")).toHaveTextContent("id: Use up to 63");
    await expect.element(page.getByRole("button", { name: "Choose a file" })).toBeVisible();
    const add = page.getByRole("button", { name: "Add plugin" });
    await expect.element(add).toBeDisabled();
    await page.getByLabelText("Or paste the manifest JSON").fill('{ "id": "acme" }');
    await add.click();
    expect(onSubmit).toHaveBeenCalledWith('{ "id": "acme" }');
    await screen.unmount();
  });
});
