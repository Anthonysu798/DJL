// FILE: ModelGuideCard.tsx
// Purpose: Explains the local-versus-API model tradeoff in the desktop onboarding flow.

import {
  IconArrowLeft,
  IconCloud,
  IconCreditCard,
  IconDeviceLaptop,
  IconKey,
  IconLock,
  IconPlugConnected,
  IconWifi,
} from "@tabler/icons-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup } from "~/components/ui/popover";
import { ChevronDownIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

type ModelGuideCardProps = {
  anchor: HTMLElement | null;
  currentModel: string | null;
  hasConnectedProvider: boolean;
  connectionPending: boolean;
  onConnect: () => void;
  onChoose: () => void;
  onContinue: () => void;
};

const LOCAL_BULLETS = ["computer", "private", "simple", "long"] as const;
const API_BULLETS = ["powerful", "planning", "tools", "long"] as const;

function BulletList(props: {
  items: readonly string[];
  translationPrefix: string;
  inverted?: boolean;
}) {
  const { t } = useTranslation("shell");
  return (
    <ul className="mt-2 space-y-1.5 text-[13px] leading-[18px]">
      {props.items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <span
            aria-hidden
            className={cn(
              "mt-[0.48rem] size-1 shrink-0 rounded-full",
              props.inverted ? "bg-background" : "bg-foreground",
            )}
          />
          <span>{t(`${props.translationPrefix}.${item}` as never)}</span>
        </li>
      ))}
    </ul>
  );
}

function SetupPath(props: {
  connectionPending: boolean;
  onBack: () => void;
  onContinue: () => void;
  onPrimaryAction: () => void;
  primaryLabel: string;
}) {
  const { t } = useTranslation("shell");
  const steps = [
    {
      icon: IconCloud,
      text: t("onboarding.modelGuide.setup.choose"),
    },
    {
      icon: IconKey,
      text: t("onboarding.modelGuide.setup.key"),
    },
    {
      icon: IconPlugConnected,
      text: t("onboarding.modelGuide.setup.paste"),
    },
  ] as const;

  return (
    <section className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-base font-semibold leading-6">
          {t("onboarding.modelGuide.setup.title")}
        </h3>
        <Button size="sm" variant="ghost" className="shrink-0" onClick={props.onBack}>
          <IconArrowLeft aria-hidden className="size-4 rtl:rotate-180" stroke={1.8} />
          {t("onboarding.back")}
        </Button>
      </div>

      <ol className="mt-4 grid grid-flow-dense gap-2 sm:grid-cols-3">
        {steps.map((step, index) => {
          const StepIcon = step.icon;
          const isDestination = index === steps.length - 1;
          return (
            <li
              key={step.text}
              className={cn(
                "group relative min-h-32 overflow-hidden rounded-xl border p-3 transition-[transform,border-color,background-color] duration-200 motion-reduce:transition-none",
                "hover:-translate-y-0.5 focus-within:-translate-y-0.5",
                isDestination
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground hover:border-foreground/40",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={cn(
                    "grid size-7 place-items-center rounded-full border text-[11px] font-semibold tabular-nums",
                    isDestination
                      ? "border-background/35 bg-background/10 text-background"
                      : "border-border bg-muted text-foreground",
                  )}
                >
                  {index + 1}
                </span>
                <StepIcon
                  aria-hidden
                  className="size-5 transition-transform duration-300 group-hover:scale-110 motion-reduce:transition-none"
                  stroke={1.7}
                />
              </div>
              <p
                className={cn(
                  "mt-5 text-[12px] font-medium leading-[18px]",
                  isDestination ? "text-background" : "text-foreground",
                )}
              >
                {step.text}
              </p>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border bg-muted/50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-background text-foreground shadow-sm ring-1 ring-border">
            <IconLock aria-hidden className="size-4" stroke={1.8} />
          </span>
          <p className="pt-0.5 text-[11px] leading-[17px] text-muted-foreground">
            {t("onboarding.modelGuide.goodToKnow.security")}
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0"
          disabled={props.connectionPending}
          onClick={props.onPrimaryAction}
        >
          {props.primaryLabel}
        </Button>
      </div>

      <button
        type="button"
        className="mt-3 text-[11px] font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        onClick={props.onContinue}
      >
        {t("onboarding.modelGuide.actions.continue")}
      </button>
    </section>
  );
}

function GuideContent(props: Omit<ModelGuideCardProps, "anchor">) {
  const { t } = useTranslation(["shell", "common"]);
  const [setupExpanded, setSetupExpanded] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);

  const primaryAction = props.hasConnectedProvider ? props.onChoose : props.onConnect;
  const primaryLabel = props.hasConnectedProvider
    ? t("onboarding.modelGuide.actions.choose")
    : t("onboarding.modelGuide.actions.connect");

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("onboarding.modelGuide.ariaLabel")}
      tabIndex={-1}
      className="w-full outline-none"
    >
      <div className="relative pe-9">
        <h2 className="text-xl font-semibold leading-7">{t("onboarding.modelGuide.title")}</h2>
        <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
          {t("onboarding.modelGuide.description")}
        </p>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("actions.close", { ns: "common" })}
          title={t("actions.close", { ns: "common" })}
          className="absolute -end-1 -top-1 rounded-full"
          onClick={props.onContinue}
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      {setupExpanded ? (
        <SetupPath
          connectionPending={props.connectionPending}
          onBack={() => setSetupExpanded(false)}
          onContinue={props.onContinue}
          onPrimaryAction={primaryAction}
          primaryLabel={primaryLabel}
        />
      ) : (
        <div className="animate-in fade-in duration-200 motion-reduce:animate-none">
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <section className="rounded-xl border border-border bg-background p-3.5 text-foreground">
              <div className="flex items-center gap-2">
                <IconDeviceLaptop aria-hidden className="size-5" stroke={1.7} />
                <h3 className="text-sm font-semibold">{t("onboarding.modelGuide.local.title")}</h3>
              </div>
              {props.currentModel ? (
                <span className="mt-2 inline-flex max-w-full rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  <span className="truncate">
                    {t("onboarding.modelGuide.local.current", { model: props.currentModel })}
                  </span>
                </span>
              ) : null}
              <BulletList
                items={LOCAL_BULLETS}
                translationPrefix="onboarding.modelGuide.local.bullets"
              />
            </section>

            <section className="rounded-xl border border-foreground bg-foreground p-3.5 text-background shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <IconCloud aria-hidden className="size-5" stroke={1.7} />
                <h3 className="text-sm font-semibold">{t("onboarding.modelGuide.api.title")}</h3>
                <span className="rounded-md bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground">
                  {t("onboarding.modelGuide.api.recommended")}
                </span>
              </div>
              <BulletList
                inverted
                items={API_BULLETS}
                translationPrefix="onboarding.modelGuide.api.bullets"
              />
            </section>
          </div>

          <p className="mt-3 border-l-[3px] border-foreground bg-muted/60 px-3 py-2 text-[12px] leading-[18px] text-foreground">
            {t("onboarding.modelGuide.recommendation")}
          </p>

          <section className="mt-3">
            <h3 className="text-sm font-semibold">{t("onboarding.modelGuide.goodToKnow.title")}</h3>
            <ul className="mt-2 space-y-1.5 text-[12px] leading-[18px] text-muted-foreground">
              <li className="flex items-start gap-2">
                <IconWifi
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-foreground"
                  stroke={1.7}
                />
                <span>{t("onboarding.modelGuide.goodToKnow.internet")}</span>
              </li>
              <li className="flex items-start gap-2">
                <IconCreditCard
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-foreground"
                  stroke={1.7}
                />
                <span>{t("onboarding.modelGuide.goodToKnow.cost")}</span>
              </li>
              <li className="flex items-start gap-2">
                <IconLock
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-foreground"
                  stroke={1.7}
                />
                <span>{t("onboarding.modelGuide.goodToKnow.security")}</span>
              </li>
            </ul>
          </section>

          <p className="mt-3 text-[11px] leading-[18px] text-muted-foreground">
            {t("onboarding.modelGuide.largeLocal")}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={props.connectionPending} onClick={primaryAction}>
              {primaryLabel}
            </Button>
            <Button size="sm" variant="outline" onClick={props.onContinue}>
              {t("onboarding.modelGuide.actions.continue")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={false}
              className="ms-auto"
              onClick={() => setSetupExpanded(true)}
            >
              {t("onboarding.modelGuide.actions.how")}
              <ChevronDownIcon aria-hidden className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ModelGuideCard(props: ModelGuideCardProps) {
  const content = <GuideContent {...props} />;

  if (!props.anchor) {
    return (
      <div
        style={{
          alignItems: "center",
          display: "flex",
          inset: 0,
          justifyContent: "center",
          padding: "1rem",
          position: "fixed",
          zIndex: 50,
        }}
      >
        <div className="max-h-[calc(100vh-2rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-[var(--color-background-elevated-primary-opaque)] p-5 shadow-2xl">
          {content}
        </div>
      </div>
    );
  }

  const anchorRect = props.anchor.getBoundingClientRect();
  const sideOffset = Math.min(64, Math.max(20, anchorRect.top - 584));
  const maxHeight = Math.max(320, anchorRect.top - sideOffset - 8);

  return (
    <Popover open modal onOpenChange={(open) => !open && props.onContinue()}>
      <PopoverPopup
        anchor={props.anchor}
        side="top"
        align="center"
        sideOffset={sideOffset}
        collisionAvoidance={{ align: "shift", fallbackAxisSide: "none", side: "shift" }}
        style={
          {
            "--model-guide-connector-height": `${sideOffset}px`,
            "--model-guide-max-height": `${maxHeight}px`,
          } as CSSProperties
        }
        className="max-h-(--model-guide-max-height) w-[min(36rem,calc(100vw-2rem))] rounded-2xl border border-border bg-[var(--color-background-elevated-primary-opaque)] shadow-2xl after:absolute after:start-1/2 after:top-full after:h-(--model-guide-connector-height) after:border-s after:border-dashed after:border-foreground/70 after:content-[''] motion-reduce:transition-none"
      >
        {content}
      </PopoverPopup>
    </Popover>
  );
}
