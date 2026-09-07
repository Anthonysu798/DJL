import "@fontsource-variable/geist";
import "./providerUpdateToast.css";

import { Toast } from "@base-ui/react/toast";
import { useGSAP } from "@gsap/react";
import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@synara/contracts";
import { gsap } from "gsap";
import { useRef, type ReactNode } from "react";
import { DjlLogo } from "../DjlLogo";
import { PROVIDER_ICON_COMPONENT_BY_PROVIDER } from "../ProviderIcon";

gsap.registerPlugin(useGSAP);

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
          y: 7,
          autoAlpha: 0,
          duration: 0.32,
          stagger: 0.045,
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
      className="djl-update-content"
      data-collapsed-hidden={hidden || undefined}
    >
      <div className="djl-update-heading djl-update-part">
        <div className="djl-update-mark">
          <DjlLogo alt="DJL" className="size-8" />
        </div>
        <div className="min-w-0 flex-1">
          <Toast.Title className="djl-update-title" data-slot="toast-title" />
          <Toast.Description
            className={status === "warning" ? "sr-only" : "djl-update-description"}
            data-slot="toast-description"
          />
          <div className="djl-update-providers">
            {providers.map((provider) => {
              const Icon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[provider];
              return (
                <span key={provider} className="djl-update-provider">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {PROVIDER_DISPLAY_NAMES[provider]}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <div className="djl-update-part">{actions}</div>
      {close}
    </Toast.Content>
  );
}
