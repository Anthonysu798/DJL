import "@fontsource-variable/geist";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { IconUser, IconStack2, IconTerminal2, IconPlus, IconX } from "@tabler/icons-react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import type { AgentAccountProfile, AgentWorkspacePane } from "~/agentWorkspaceStore";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "~/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectPopup,
  SelectItem,
  SelectValue,
} from "~/components/ui/select";
import { Button } from "~/components/ui/button";
import "./newTerminalDialog.css";

gsap.registerPlugin(useGSAP);
const PROVIDERS = {
  codex: "Codex",
  claudeAgent: "Claude Code",
  cursor: "Cursor",
  opencode: "OpenCode",
} as const;

export interface NewTerminalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: AgentAccountProfile[];
  profileId: string;
  onProfileChange: (id: string) => void;
  count: number;
  onCountChange: (count: number) => void;
  onAddAccount: () => void;
  onLaunch: (action: AgentWorkspacePane["action"]) => void;
}

function TerminalLaunchForm(props: NewTerminalDialogProps) {
  const { t } = useTranslation("workspace", { keyPrefix: "agents" });
  const content = useRef<HTMLFormElement>(null);
  const accountItems = [
    { value: "", label: t("shellOption") },
    ...props.profiles.map((profile) => ({
      value: profile.id,
      label: `${PROVIDERS[profile.provider]} · ${profile.name}`,
    })),
  ];
  const counts = [1, 5, 10].map((value) => ({
    value: String(value),
    label: t("terminalCount", { count: value }),
  }));
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          "[data-launch-reveal]",
          { opacity: 0, y: 8 },
          {
            opacity: 1,
            y: 0,
            duration: 0.3,
            stagger: 0.045,
            ease: "power2.out",
            clearProps: "opacity,transform",
          },
        );
      });
      return () => media.revert();
    },
    { scope: content },
  );

  return (
    <form
      ref={content}
      className="terminal-launch-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onLaunch("run");
      }}
    >
      <div data-launch-reveal>
        <Select
          items={accountItems}
          value={props.profileId}
          onValueChange={(value) => props.onProfileChange(value ?? "")}
        >
          <SelectTrigger className="terminal-launch-field" aria-label={t("account")}>
            <IconUser
              className="terminal-launch-field-icon"
              size={24}
              stroke={1.65}
              aria-hidden="true"
            />
            <span className="terminal-launch-field-copy">
              <span className="terminal-launch-field-label">{t("account")}</span>
              <SelectValue className="terminal-launch-field-value" />
            </span>
          </SelectTrigger>
          <SelectPopup
            alignItemWithTrigger={false}
            sideOffset={8}
            surface="settings"
            shellClassName="terminal-launch-menu"
          >
            {accountItems.map((item) => (
              <SelectItem key={item.value} value={item.value} className="terminal-launch-option">
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <div data-launch-reveal>
        <Select
          items={counts}
          value={String(props.count)}
          onValueChange={(value) => {
            if (value) props.onCountChange(Number(value));
          }}
        >
          <SelectTrigger className="terminal-launch-field" aria-label={t("quantity")}>
            <IconStack2
              className="terminal-launch-field-icon"
              size={24}
              stroke={1.65}
              aria-hidden="true"
            />
            <span className="terminal-launch-field-copy">
              <span className="terminal-launch-field-label">{t("quantity")}</span>
              <SelectValue
                key={props.count}
                className="terminal-launch-field-value terminal-launch-value-change"
              />
            </span>
          </SelectTrigger>
          <SelectPopup
            alignItemWithTrigger={false}
            sideOffset={8}
            surface="settings"
            shellClassName="terminal-launch-menu"
          >
            {counts.map((item) => (
              <SelectItem key={item.value} value={item.value} className="terminal-launch-option">
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <div className="terminal-launch-account-actions" data-launch-reveal>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="terminal-launch-link"
          onClick={props.onAddAccount}
        >
          <IconPlus size={14} stroke={1.7} aria-hidden="true" />
          {t("addAccount")}
        </Button>
        {props.profileId && (
          <div className="terminal-launch-signin-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="terminal-launch-link"
              onClick={() => props.onLaunch("login")}
            >
              {t("signIn")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="terminal-launch-link"
              onClick={() => props.onLaunch("status")}
            >
              {t("checkSignIn")}
            </Button>
          </div>
        )}
      </div>
      <div className="terminal-launch-footer" data-launch-reveal>
        <Button
          type="button"
          variant="ghost"
          className="terminal-launch-cancel"
          onClick={() => props.onOpenChange(false)}
        >
          {t("cancel")}
        </Button>
        <Button type="submit" className="terminal-launch-submit">
          <IconTerminal2 size={19} stroke={1.8} aria-hidden="true" />
          <span key={props.count} className="terminal-launch-value-change">
            {t("openTerminals", { count: props.count })}
          </span>
        </Button>
      </div>
    </form>
  );
}

export function NewTerminalDialog(props: NewTerminalDialogProps) {
  const { t } = useTranslation("workspace", { keyPrefix: "agents" });
  const { t: common } = useTranslation("common");
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup
        className="terminal-launch-dialog"
        showCloseButton={false}
        bottomStickOnMobile={false}
      >
        <DialogTitle className="terminal-launch-title">{t("newTerminal")}</DialogTitle>
        <DialogDescription className="terminal-launch-description">
          {t("setupDescription")}
        </DialogDescription>
        <TerminalLaunchForm {...props} />
        <DialogClose className="terminal-launch-close" aria-label={common("actions.close")}>
          <IconX size={21} stroke={1.7} aria-hidden="true" />
        </DialogClose>
      </DialogPopup>
    </Dialog>
  );
}
