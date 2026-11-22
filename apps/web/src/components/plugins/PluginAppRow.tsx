// FILE: PluginAppRow.tsx
// Purpose: One app of a plugin with its sign-in state and the single action that state allows.

import type { PluginApp, PluginAppConnection, PluginCatalogEntry } from "@synara/contracts";
import { useTranslation } from "react-i18next";

import { Button } from "../ui/button";
import { PluginGlyph } from "./PluginGlyph";

export function PluginAppRow(props: {
  plugin: PluginCatalogEntry;
  app: PluginApp;
  /** Undefined while the plugin is not added. */
  connection: PluginAppConnection | undefined;
  pending: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const { t } = useTranslation("shell");
  const { plugin, app, connection } = props;
  const state = connection?.state;
  const status = plugin.builtIn
    ? t("pluginLibrary.builtIn")
    : state === "connected"
      ? t("pluginLibrary.connected")
      : state === "connecting"
        ? t("pluginLibrary.connecting")
        : state === "expired"
          ? t("pluginLibrary.expired")
          : state === "error"
            ? (connection?.message ?? t("pluginLibrary.notConnected"))
            : t("pluginLibrary.notConnected");
  return (
    <li className="flex items-center gap-3 py-4">
      <PluginGlyph plugin={plugin} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{app.name}</span>
        <span
          className={
            state === "error" || state === "expired"
              ? "block text-sm text-destructive"
              : "block text-sm text-muted-foreground"
          }
          role={state === "error" ? "alert" : undefined}
        >
          {status}
        </span>
      </span>
      {connection && (app.auth === "oauth" || app.auth === "apiKey") ? (
        state === "connected" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.pending}
            onClick={props.onDisconnect}
          >
            {t("pluginLibrary.disconnect")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant={state === "connecting" ? "outline" : "default"}
            disabled={props.pending}
            onClick={props.onConnect}
          >
            {state === "expired" || state === "error"
              ? t("pluginLibrary.reconnect")
              : t("pluginLibrary.connect")}
          </Button>
        )
      ) : null}
    </li>
  );
}
