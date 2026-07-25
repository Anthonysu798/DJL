// FILE: DjlLogo.tsx
// Purpose: Render the supplied metallic DJL artwork with consistent accessibility behavior.
// Layer: Shared app branding primitive

import type { ImgHTMLAttributes } from "react";
import { cn } from "~/lib/utils";

export function DjlLogo({ className, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const ariaLabel = props["aria-label"];
  const accessibleName = alt ?? (typeof ariaLabel === "string" ? ariaLabel : "");
  const ariaHidden = props["aria-hidden"] ?? (accessibleName ? undefined : true);

  return (
    <img
      {...props}
      src="/djl-logo.png"
      alt={accessibleName}
      aria-hidden={ariaHidden}
      draggable={false}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}
