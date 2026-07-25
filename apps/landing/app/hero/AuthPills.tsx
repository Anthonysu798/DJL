"use client";

import "./nav-pills.css";

/* Right-side auth pill pair for the top bar, matching the reference "Log in" +
   "Sign up". For DJL these carry real actions: the lead wires the ghost pill to
   the language toggle and the primary pill to "Open workspace". Labels and hrefs
   are passed in so the kit stays bilingual and action-agnostic. */
export function AuthPills({
  ghostLabel,
  ghostHref,
  primaryLabel,
  primaryHref,
}: {
  ghostLabel: string;
  ghostHref: string;
  primaryLabel: string;
  primaryHref: string;
}) {
  return (
    <div className="np-auth">
      <a href={ghostHref} className="np-ghost" aria-label={ghostLabel}>
        {ghostLabel}
      </a>
      <a href={primaryHref} className="np-primary" aria-label={primaryLabel}>
        {primaryLabel}
      </a>
    </div>
  );
}
