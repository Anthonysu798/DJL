import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { isElectron } from "~/env";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { ArrowLeftIcon, ArrowUpIcon } from "~/lib/icons";
import {
  FIRST_RUN_TOUR_REPLAY_EVENT,
  FIRST_RUN_TOUR_STORAGE_KEY,
  FIRST_RUN_CORE_TOUR_TARGETS,
  FIRST_RUN_TOUR_TARGETS,
  FirstRunTourStorageSchema,
  INITIAL_FIRST_RUN_TOUR_STORAGE,
  INITIAL_SETTINGS_TOUR_STORAGE,
  markFirstRunTourSeen,
  markSettingsTourSeen,
  SETTINGS_TOUR_REPLAY_EVENT,
  SETTINGS_TOUR_STORAGE_KEY,
  SettingsTourStorageSchema,
  settingsTourTarget,
  shouldAutoStartFirstRunTour,
  shouldAutoStartSettingsTour,
} from "~/onboarding/firstRunTour";
import {
  isSettingsSectionVisible,
  normalizeSettingsSection,
  SETTINGS_NAV_ITEMS,
} from "~/settingsNavigation";
import { useStore } from "~/store";
import { Button } from "../ui/button";
import { Popover, PopoverDescription, PopoverPopup, PopoverTitle } from "../ui/popover";
import { useSidebar } from "../ui/sidebar";

const AUTO_START_DELAY_MS = 700;
const TARGET_DISCOVERY_TIMEOUT_MS = 1_500;
const SPOTLIGHT_PADDING_PX = 6;
const SPOTLIGHT_TRANSITION_CLASS_NAME =
  "transition-[top,left,width,height] duration-150 ease-out motion-reduce:transition-none";

type ActiveTour = "first-run" | "settings";

const SETTINGS_TOUR_ITEMS = SETTINGS_NAV_ITEMS.filter(
  (item) => isSettingsSectionVisible(item.id) && (!item.desktopOnly || isElectron),
);
const SETTINGS_TOUR_TARGETS = SETTINGS_TOUR_ITEMS.map((item) => settingsTourTarget(item.id));

interface SpotlightRect {
  readonly bottom: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly width: number;
}

function measureTarget(target: HTMLElement): SpotlightRect {
  const rect = target.getBoundingClientRect();
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
  };
}

function targetSelector(target: string): string {
  return `[data-onboarding-target="${target}"]`;
}

export function FirstRunTour() {
  const { t } = useTranslation("shell");
  const { t: tSettings } = useTranslation("settings");
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const activeSettingsSection = normalizeSettingsSection(routeSearch.section);
  const threadsHydrated = useStore((state) => state.threadsHydrated);
  const { isMobile, setOpen, setOpenMobile } = useSidebar();
  const [firstRunStorage, setFirstRunStorage] = useLocalStorage(
    FIRST_RUN_TOUR_STORAGE_KEY,
    INITIAL_FIRST_RUN_TOUR_STORAGE,
    FirstRunTourStorageSchema,
  );
  const [settingsStorage, setSettingsStorage] = useLocalStorage(
    SETTINGS_TOUR_STORAGE_KEY,
    INITIAL_SETTINGS_TOUR_STORAGE,
    SettingsTourStorageSchema,
  );
  const [activeTour, setActiveTour] = useState<ActiveTour | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [pendingStepIndex, setPendingStepIndex] = useState<number | null>(null);
  const [includeLocalAiSteps, setIncludeLocalAiSteps] = useState(false);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);
  const autoStartScheduledRef = useRef<Record<ActiveTour, boolean>>({
    "first-run": false,
    settings: false,
  });

  const isOpen = activeTour !== null;
  const tourTargets =
    activeTour === "settings"
      ? SETTINGS_TOUR_TARGETS
      : includeLocalAiSteps
        ? FIRST_RUN_TOUR_TARGETS
        : FIRST_RUN_CORE_TOUR_TARGETS;
  const stepTarget = tourTargets[stepIndex] ?? tourTargets[0] ?? null;
  const isLastStep = stepIndex === tourTargets.length - 1;

  const finishTour = useCallback(() => {
    if (activeTour === "settings") {
      setSettingsStorage((current) => markSettingsTourSeen(current));
    } else if (activeTour === "first-run") {
      setFirstRunStorage((current) => markFirstRunTourSeen(current));
    }
    setActiveTour(null);
    setPendingStepIndex(null);
    setTargetElement(null);
    setSpotlightRect(null);
  }, [activeTour, setFirstRunStorage, setSettingsStorage]);

  const navigateToSettingsTourStep = useCallback(
    (nextStepIndex: number) => {
      const item = SETTINGS_TOUR_ITEMS[nextStepIndex];
      if (!item) return Promise.resolve();
      return navigate({
        to: "/settings",
        replace: true,
        search: (previous) => ({
          ...previous,
          section: item.id === "general" ? undefined : item.id,
          target: undefined,
        }),
      });
    },
    [navigate],
  );

  const startTour = useCallback(
    (tour: ActiveTour) => {
      autoStartScheduledRef.current[tour] = true;
      setStepIndex(0);
      setPendingStepIndex(null);
      setTargetElement(null);
      setSpotlightRect(null);
      if (tour === "first-run") {
        setIncludeLocalAiSteps(document.querySelector(targetSelector("local-ai-card")) !== null);
      }
      setOpen(true);
      if (isMobile) setOpenMobile(true);

      const showTour = () => setActiveTour(tour);
      if (tour === "first-run" && pathname === "/settings") {
        void navigate({ to: "/" }).then(showTour);
        return;
      }
      if (tour === "settings") {
        void navigateToSettingsTourStep(0).then(showTour);
        return;
      }
      showTour();
    },
    [isMobile, navigate, navigateToSettingsTourStep, pathname, setOpen, setOpenMobile],
  );

  useEffect(() => {
    const replay = () => startTour("first-run");
    window.addEventListener(FIRST_RUN_TOUR_REPLAY_EVENT, replay);
    return () => window.removeEventListener(FIRST_RUN_TOUR_REPLAY_EVENT, replay);
  }, [startTour]);

  useEffect(() => {
    const replay = () => startTour("settings");
    window.addEventListener(SETTINGS_TOUR_REPLAY_EVENT, replay);
    return () => window.removeEventListener(SETTINGS_TOUR_REPLAY_EVENT, replay);
  }, [startTour]);

  useEffect(() => {
    const scheduledTours = autoStartScheduledRef.current;
    if (
      activeTour !== null ||
      scheduledTours["first-run"] ||
      !shouldAutoStartFirstRunTour({
        threadsHydrated,
        seenVersion: firstRunStorage.seenVersion,
      })
    ) {
      return;
    }
    scheduledTours["first-run"] = true;
    let started = false;
    const timeout = window.setTimeout(() => {
      started = true;
      startTour("first-run");
    }, AUTO_START_DELAY_MS);
    return () => {
      window.clearTimeout(timeout);
      if (!started) scheduledTours["first-run"] = false;
    };
  }, [activeTour, firstRunStorage.seenVersion, startTour, threadsHydrated]);

  useEffect(() => {
    const scheduledTours = autoStartScheduledRef.current;
    if (
      activeTour !== null ||
      scheduledTours.settings ||
      !shouldAutoStartSettingsTour({
        firstRunSeenVersion: firstRunStorage.seenVersion,
        pathname,
        seenVersion: settingsStorage.seenVersion,
        threadsHydrated,
      })
    ) {
      return;
    }
    scheduledTours.settings = true;
    let started = false;
    const timeout = window.setTimeout(() => {
      started = true;
      startTour("settings");
    }, AUTO_START_DELAY_MS);
    return () => {
      window.clearTimeout(timeout);
      if (!started) scheduledTours.settings = false;
    };
  }, [
    activeTour,
    firstRunStorage.seenVersion,
    pathname,
    settingsStorage.seenVersion,
    startTour,
    threadsHydrated,
  ]);

  useEffect(() => {
    if (activeTour !== "first-run" || includeLocalAiSteps || stepIndex > 1) return;
    const revealLocalAiSteps = () => {
      if (!document.querySelector(targetSelector("local-ai-card"))) return false;
      setIncludeLocalAiSteps(true);
      return true;
    };
    if (revealLocalAiSteps()) return;
    const observer = new MutationObserver(() => {
      if (revealLocalAiSteps()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [activeTour, includeLocalAiSteps, stepIndex]);

  const moveToStep = useCallback(
    (nextStepIndex: number) => {
      if (activeTour !== "settings") {
        setStepIndex(nextStepIndex);
        return;
      }

      const item = SETTINGS_TOUR_ITEMS[nextStepIndex];
      if (!item) return;
      if (pathname === "/settings" && activeSettingsSection === item.id) {
        setStepIndex(nextStepIndex);
        return;
      }

      setPendingStepIndex(nextStepIndex);
      void navigateToSettingsTourStep(nextStepIndex).catch(() => {
        setPendingStepIndex(null);
      });
    },
    [activeSettingsSection, activeTour, navigateToSettingsTourStep, pathname],
  );

  useLayoutEffect(() => {
    if (activeTour !== "settings" || pendingStepIndex === null || pathname !== "/settings") {
      return;
    }
    const pendingItem = SETTINGS_TOUR_ITEMS[pendingStepIndex];
    if (!pendingItem || activeSettingsSection !== pendingItem.id) return;
    setStepIndex(pendingStepIndex);
    setPendingStepIndex(null);
  }, [activeSettingsSection, activeTour, pathname, pendingStepIndex]);

  useLayoutEffect(() => {
    if (!isOpen || !stepTarget) return;
    let found = false;
    let observer: MutationObserver | null = null;
    const findTarget = () => {
      if (found) return;
      const nextTarget = document.querySelector<HTMLElement>(targetSelector(stepTarget));
      if (!nextTarget) return;
      found = true;
      observer?.disconnect();
      setTargetElement(nextTarget);
      nextTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    findTarget();
    if (!found) {
      observer = new MutationObserver(findTarget);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    const timeout = window.setTimeout(() => {
      if (found) return;
      if (isLastStep) finishTour();
      else moveToStep(stepIndex + 1);
    }, TARGET_DISCOVERY_TIMEOUT_MS);
    return () => {
      observer?.disconnect();
      window.clearTimeout(timeout);
    };
  }, [finishTour, isLastStep, isOpen, moveToStep, stepIndex, stepTarget]);

  useLayoutEffect(() => {
    if (!targetElement) {
      setSpotlightRect(null);
      return;
    }
    const update = () => setSpotlightRect(measureTarget(targetElement));
    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(targetElement);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [targetElement]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finishTour();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finishTour, isOpen]);

  const stepCopy = useMemo(() => {
    if (activeTour === "settings") {
      const item = SETTINGS_TOUR_ITEMS[stepIndex] ?? SETTINGS_TOUR_ITEMS[0];
      return {
        description: item ? tSettings(item.descriptionKey) : "",
        title: item ? tSettings(item.labelKey) : "",
      };
    }
    return {
      description: stepTarget ? t(`onboarding.steps.${stepTarget}.description`) : "",
      title: stepTarget ? t(`onboarding.steps.${stepTarget}.title`) : "",
    };
  }, [activeTour, stepIndex, stepTarget, t, tSettings]);

  const tourAriaLabel =
    activeTour === "settings" ? t("settingsTour.ariaLabel") : t("onboarding.ariaLabel");

  if (!isOpen || !stepTarget || !targetElement || !spotlightRect) return null;

  const top = Math.max(0, spotlightRect.top - SPOTLIGHT_PADDING_PX);
  const left = Math.max(0, spotlightRect.left - SPOTLIGHT_PADDING_PX);
  const right = Math.min(window.innerWidth, spotlightRect.right + SPOTLIGHT_PADDING_PX);
  const bottom = Math.min(window.innerHeight, spotlightRect.bottom + SPOTLIGHT_PADDING_PX);

  return (
    <>
      <div
        aria-hidden
        className={`fixed inset-x-0 top-0 z-40 bg-black/45 ${SPOTLIGHT_TRANSITION_CLASS_NAME}`}
        style={{ height: top }}
      />
      <div
        aria-hidden
        className={`fixed inset-x-0 bottom-0 z-40 bg-black/45 ${SPOTLIGHT_TRANSITION_CLASS_NAME}`}
        style={{ top: bottom }}
      />
      <div
        aria-hidden
        className={`fixed left-0 z-40 bg-black/45 ${SPOTLIGHT_TRANSITION_CLASS_NAME}`}
        style={{ top, width: left, height: bottom - top }}
      />
      <div
        aria-hidden
        className={`fixed right-0 z-40 bg-black/45 ${SPOTLIGHT_TRANSITION_CLASS_NAME}`}
        style={{ top, left: right, height: bottom - top }}
      />
      <div
        aria-hidden
        className={`fixed z-40 rounded-lg border-2 border-primary shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-background)_75%,transparent)] ${SPOTLIGHT_TRANSITION_CLASS_NAME}`}
        style={{ top, left, width: right - left, height: bottom - top }}
      />

      <Popover open modal onOpenChange={(open) => !open && finishTour()}>
        <PopoverPopup
          anchor={targetElement}
          side={isMobile ? "bottom" : "right"}
          align="center"
          sideOffset={18}
          className="w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-border bg-[var(--color-background-elevated-primary-opaque)] shadow-xl motion-reduce:transition-none"
        >
          <div aria-label={tourAriaLabel} className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                {isMobile ? (
                  <ArrowUpIcon className="size-4" aria-hidden />
                ) : (
                  <ArrowLeftIcon className="size-4" aria-hidden />
                )}
              </span>
              <div className="min-w-0">
                <PopoverTitle className="text-base leading-5">{stepCopy.title}</PopoverTitle>
                <PopoverDescription className="mt-1.5 text-sm leading-5">
                  {stepCopy.description}
                </PopoverDescription>
              </div>
            </div>

            <div className="flex items-center gap-1.5" aria-hidden>
              {tourTargets.length > 6 ? (
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted-foreground/20">
                  <span
                    className="block h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
                    style={{ width: `${((stepIndex + 1) / tourTargets.length) * 100}%` }}
                  />
                </span>
              ) : (
                tourTargets.map((target, index) => (
                  <span
                    key={target}
                    className={`h-1.5 rounded-full transition-[width,background-color] motion-reduce:transition-none ${
                      index === stepIndex ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/25"
                    }`}
                  />
                ))
              )}
              <span className="ml-1 text-xs text-muted-foreground">
                {t("onboarding.progress", {
                  current: stepIndex + 1,
                  total: tourTargets.length,
                })}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <Button size="xs" variant="ghost" onClick={finishTour}>
                {t("onboarding.skip")}
              </Button>
              <div className="flex items-center gap-2">
                {stepIndex > 0 ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={pendingStepIndex !== null}
                    onClick={() => moveToStep(stepIndex - 1)}
                  >
                    {t("onboarding.back")}
                  </Button>
                ) : null}
                <Button
                  size="xs"
                  disabled={pendingStepIndex !== null}
                  onClick={() => {
                    if (isLastStep) finishTour();
                    else moveToStep(stepIndex + 1);
                  }}
                >
                  {t(isLastStep ? "onboarding.finish" : "onboarding.next")}
                </Button>
              </div>
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </>
  );
}
