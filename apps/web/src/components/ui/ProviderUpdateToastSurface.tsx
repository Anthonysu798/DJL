import "@fontsource-variable/geist";
import "./providerUpdateToast.css";

import { Toast } from "@base-ui/react/toast";
import { useGSAP } from "@gsap/react";
import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@djl/contracts";
import { gsap } from "gsap";
import { useRef, type ReactNode } from "react";

import { ArrowUpIcon, CheckIcon, XIcon } from "~/lib/icons";

import { PROVIDER_ICON_COMPONENT_BY_PROVIDER } from "../ProviderIcon";

gsap.registerPlugin(useGSAP);

const ICON_LIMIT = 3;

/** The small mark on the agent icons: new update, updating, updated or failed. */
function StatusBadge({ status }: { status: string | undefined }) {
  return (
    <span className="djl-update-badge">
      {status === "loading" ? (
        <span className="djl-update-spinner" />
      ) : status === "success" ? (
        <CheckIcon className="size-2.5" />
      ) : status === "error" ? (
        <XIcon className="size-2.5" />
      ) : (
        <ArrowUpIcon className="size-2.5" />
      )}
    </span>
  );
}

/**
 * The CLI update notice as one compact liquid-glass card: the agents' icons with a status mark,
 * a title and one quiet line (the version change, progress or what failed), then the actions.
 */
export function ProviderUpdateToastSurface({
  providers,
  status,
  hidden,
  actions,
  close,
}: {
  providers: readonly ProviderKind[];
  status: string | undefined;
  hidden: boolean;
  actions: ReactNode;
  close: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".djl-update-part", {
          y: 6,
          autoAlpha: 0,
          duration: 0.28,
          stagger: 0.04,
          ease: "power3.out",
          clearProps: "transform,opacity,visibility",
        });
      });
      return () => media.revert();
    },
    { scope: content, dependencies: [status], revertOnUpdate: true },
  );

  return (
    <Toast.Content
      ref={content}
      className="djl-update-content liquid-glass"
      data-status={status}
      data-collapsed-hidden={hidden || undefined}
    >
      <div className="djl-update-heading djl-update-part">
        <div
          className="djl-update-icons"
          title={providers.map((provider) => PROVIDER_DISPLAY_NAMES[provider]).join(", ")}
          aria-hidden="true"
        >
          {providers.slice(0, ICON_LIMIT).map((provider) => {
            const Icon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[provider];
            return (
              <span key={provider} className="djl-update-icon">
                <Icon className="size-[18px]" />
              </span>
            );
          })}
          <StatusBadge status={status} />
        </div>
        <div className="min-w-0 flex-1">
          <Toast.Title className="djl-update-title" data-slot="toast-title" />
          <Toast.Description className="djl-update-description" data-slot="toast-description" />
        </div>
      </div>
      {status === "loading" ? <div className="djl-update-progress djl-update-part" /> : null}
      <div className="djl-update-part">{actions}</div>
      {close}
    </Toast.Content>
  );
}
