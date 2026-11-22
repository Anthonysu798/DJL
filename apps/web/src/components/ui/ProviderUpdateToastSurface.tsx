import "@fontsource-variable/geist";
import "./providerUpdateToast.css";

import { Toast } from "@base-ui/react/toast";
import { useGSAP } from "@gsap/react";
import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@djl/contracts";
import { gsap } from "gsap";
import { useId, useRef, type ReactNode } from "react";
import { PROVIDER_ICON_COMPONENT_BY_PROVIDER } from "../ProviderIcon";

gsap.registerPlugin(useGSAP);

function UpdateIllustration() {
  const id = useId();
  return (
    <svg className="djl-update-illustration" viewBox="0 0 132 116" fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id={`${id}-tile`}
          x1="32"
          y1="30"
          x2="94"
          y2="88"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--update-art-light)" />
          <stop offset="1" stopColor="var(--update-art-shade)" />
        </linearGradient>
      </defs>
      <ellipse cx="68" cy="99" rx="46" ry="9" fill="var(--update-art-accent)" opacity=".09" />
      <path
        d="m21 79 43-23a9 9 0 0 1 8 0l43 23c4 2 4 6 0 8L72 110a9 9 0 0 1-8 0L21 87c-4-2-4-6 0-8Z"
        fill="var(--update-art-accent)"
        opacity=".12"
      />
      <path
        d="m21 69 43-23a9 9 0 0 1 8 0l43 23c4 2 4 6 0 8L72 100a9 9 0 0 1-8 0L21 77c-4-2-4-6 0-8Z"
        fill="var(--update-art-base)"
        stroke="var(--update-art-line)"
      />
      <g className="djl-update-art-module">
        <path
          d="M19 53v10c0 2 1 3 3 4l42 23a9 9 0 0 0 8 0l42-23c2-1 3-2 3-4V53"
          fill="var(--update-art-shade)"
          stroke="var(--update-art-line)"
        />
        <path
          d="m22 49 42-23a9 9 0 0 1 8 0l42 23c4 2 4 6 0 8L72 80a9 9 0 0 1-8 0L22 57c-4-2-4-6 0-8Z"
          fill={`url(#${id}-tile)`}
          stroke="var(--update-art-line)"
        />
        <path
          d="m32 54 31 17m-23-22 12 7m44 8 8-4"
          stroke="var(--update-art-accent)"
          strokeLinecap="round"
          opacity=".55"
        />
        <path
          d="m65 64 14-8"
          stroke="var(--update-art-accent)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      <g className="djl-update-art-arrow">
        <path
          d="M70 48V10m0 0L58 22m12-12 12 12"
          stroke="var(--update-art-accent)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M99 27v8m-4-4h8M37 16v6m-3-3h6"
          stroke="var(--update-art-accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity=".5"
        />
      </g>
    </svg>
  );
}

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
        gsap.from(".djl-update-art-module, .djl-update-art-arrow", {
          y: 10,
          opacity: 0,
          duration: 0.65,
          stagger: 0.12,
          ease: "power3.out",
          clearProps: "transform,opacity",
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
        <UpdateIllustration />
      </div>
      <div className="djl-update-part">{actions}</div>
      {close}
    </Toast.Content>
  );
}
