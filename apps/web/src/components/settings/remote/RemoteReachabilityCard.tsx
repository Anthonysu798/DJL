// FILE: RemoteReachabilityCard.tsx
// Purpose: The "Stay reachable" settings under Remote: when DJL keeps this computer awake for a
//          paired phone, whether DJL starts with the computer, and the limits no app can remove.

import type { DesktopRemoteKeepAwakeMode, DesktopRemoteReachabilityState } from "@djl/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import { settingRowAnchorId } from "~/settingsNavigation";

const KEEP_AWAKE_MODES: readonly DesktopRemoteKeepAwakeMode[] = ["never", "pluggedIn", "always"];

export function RemoteReachabilityCard(props: {
  /** Changes when the phone connects or leaves, so "staying awake" is read again. */
  refreshKey: string;
}) {
  const { t } = useTranslation("settings");
  const bridge = window.desktopBridge?.remote;
  const [state, setState] = useState<DesktopRemoteReachabilityState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void bridge?.getReachability?.().then(
      (next) => {
        if (active) setState(next);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [bridge, props.refreshKey]);

  // An older desktop build has no reachability settings to show.
  if (!bridge?.setReachability || !state) return null;

  const change = (patch: { keepAwake?: DesktopRemoteKeepAwakeMode; openAtLogin?: boolean }) => {
    setFailed(false);
    // Show the choice at once; the reply carries what the computer is really doing.
    setState({ ...state, ...patch });
    void bridge.setReachability?.(patch).then(setState, () => {
      setState(state);
      setFailed(true);
    });
  };

  return (
    <section
      className="remote-reach"
      id={settingRowAnchorId("remote-reachability")}
      aria-labelledby="remote-reach-heading"
    >
      <div className="remote-reach-head">
        <h2 id="remote-reach-heading">{t("remote.reach.title")}</h2>
        <p>{t("remote.reach.description")}</p>
      </div>
      <div className="remote-reach-row">
        <div className="remote-reach-copy">
          <h3>{t("remote.reach.keepAwake.label")}</h3>
          <p role="status" className="remote-status">
            <span
              className={cn(
                "size-1.5 rounded-full",
                state.stayingAwake ? "bg-emerald-500" : "bg-muted-foreground/50",
              )}
            />
            {state.stayingAwake ? t("remote.reach.status.awake") : t("remote.reach.status.normal")}
          </p>
        </div>
        <Select<DesktopRemoteKeepAwakeMode>
          value={state.keepAwake}
          onValueChange={(value) => {
            if (value !== null) change({ keepAwake: value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-44 min-w-0 rounded-full"
            aria-label={t("remote.reach.keepAwake.label")}
          >
            <SelectValue>{t(`remote.reach.keepAwake.${state.keepAwake}`)}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {KEEP_AWAKE_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {t(`remote.reach.keepAwake.${mode}`)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <div className="remote-reach-row">
        <div className="remote-reach-copy">
          <h3>{t("remote.reach.login.label")}</h3>
          <p>
            {state.openAtLoginSupported
              ? t("remote.reach.login.hint")
              : t("remote.reach.login.unsupported")}
          </p>
        </div>
        <Switch
          aria-label={t("remote.reach.login.label")}
          checked={state.openAtLogin}
          disabled={!state.openAtLoginSupported}
          onCheckedChange={(next) => change({ openAtLogin: next })}
        />
      </div>
      {failed ? (
        <p role="alert" className="remote-action-error">
          {t("remote.reach.saveFailed")}
        </p>
      ) : null}
      <p className="remote-reach-limits">{t("remote.reach.limits")}</p>
    </section>
  );
}
