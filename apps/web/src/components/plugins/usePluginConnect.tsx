// FILE: usePluginConnect.tsx
// Purpose: One Connect for every kind of app: browser sign-in starts at once, a device sign-in
//          (GitHub) shows its code until the user has approved DJL, and an app that takes an
//          access token asks for it first.

import {
  findPluginCatalogEntry,
  type PluginAppInput,
  type PluginsSnapshot,
} from "@synara/contracts";
import { useState } from "react";

import type { usePluginActions } from "~/lib/pluginsReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { PluginDeviceCodeDialog } from "./PluginDeviceCodeDialog";
import { PluginTokenDialog } from "./PluginTokenDialog";

type PluginActions = ReturnType<typeof usePluginActions>;

export function usePluginConnect(
  snapshot: PluginsSnapshot | undefined,
  actions: Pick<PluginActions, "connect" | "saveAppToken">,
) {
  const [target, setTarget] = useState<PluginAppInput>();
  const appOf = (current: PluginsSnapshot | undefined, input: PluginAppInput) =>
    current
      ? findPluginCatalogEntry(current, input.pluginId)?.apps.find((app) => app.id === input.appId)
      : undefined;

  const connectApp = (input: PluginAppInput) => {
    if (appOf(snapshot, input)?.auth === "apiKey") {
      actions.saveAppToken.reset();
      setTarget(input);
    } else {
      actions.connect.mutate(input);
    }
  };

  /** Right after a plugin is added, ask for the token its first unconnected token app needs. */
  const promptAfterInstall = (current: PluginsSnapshot, pluginId: string) => {
    const app = findPluginCatalogEntry(current, pluginId)?.apps.find(
      (item) =>
        item.auth === "apiKey" &&
        !current.connections.some(
          (connection) =>
            connection.pluginId === pluginId &&
            connection.appId === item.id &&
            connection.state === "connected",
        ),
    );
    if (app) connectApp({ pluginId, appId: app.id });
  };

  const app = target ? appOf(snapshot, target) : undefined;
  // Mounted only while open, so a pasted token never lingers in the form.
  const dialog =
    target && app ? (
      <PluginTokenDialog
        open
        appName={app.name}
        tokenUrl={app.tokenUrl}
        tokenScopes={app.tokenScopes}
        pending={actions.saveAppToken.isPending}
        error={actions.saveAppToken.error?.message}
        onOpenChange={(open) => {
          if (!open) setTarget(undefined);
        }}
        onOpenLink={(url) => void ensureNativeApi().shell.openExternal(url)}
        onSubmit={(token) =>
          actions.saveAppToken.mutate(
            { ...target, token },
            { onSuccess: () => setTarget(undefined) },
          )
        }
      />
    ) : null;

  const device = actions.connect.data?.userCode ? actions.connect.data : undefined;
  const deviceApp = device ? appOf(snapshot, device) : undefined;
  const deviceConnection = device
    ? snapshot?.connections.find(
        (connection) =>
          connection.pluginId === device.pluginId && connection.appId === device.appId,
      )
    : undefined;
  const deviceDialog =
    device?.userCode && deviceApp ? (
      <PluginDeviceCodeDialog
        appName={deviceApp.name}
        userCode={device.userCode}
        state={deviceConnection?.state}
        message={deviceConnection?.message}
        retrying={actions.connect.isPending}
        onOpenPage={() => void ensureNativeApi().shell.openExternal(device.authorizeUrl)}
        onRetry={() => actions.connect.mutate({ pluginId: device.pluginId, appId: device.appId })}
        onClose={() => actions.connect.reset()}
      />
    ) : null;

  return {
    connectApp,
    promptAfterInstall,
    dialog: (
      <>
        {dialog}
        {deviceDialog}
      </>
    ),
  };
}
