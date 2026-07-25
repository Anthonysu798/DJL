"use client";

import "./nav-pills.css";

/* Centered glass nav-pill cluster for the top bar. The active section id renders
   as a solid white pill (reference "Home"), the rest as quiet ghost links. This
   renders its own labelled <nav> landmark, so the lead must NOT wrap it in
   another <nav>. The cluster hides below 900px (see nav-pills.css). */
export function NavPills({
  nav,
  active,
}: {
  nav: readonly { id: string; label: string }[];
  active: string;
}) {
  return (
    <nav className="np-cluster" aria-label="Sections">
      {nav.map((item) => {
        const isActive = active === item.id;
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={isActive ? "np-pill active" : "np-pill"}
            aria-current={isActive ? "page" : undefined}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
