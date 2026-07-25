// FILE: TechnicalDetailsDisclosure.tsx
// Purpose: Shared disclosure for raw provider/runtime diagnostics.
// Layer: Chat status presentation
// Exports: TechnicalDetailsDisclosure

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { disclosureChevronClassName } from "~/lib/disclosureMotion";
import { ChevronRightIcon } from "~/lib/icons";

export function TechnicalDetailsDisclosure({ detail }: { detail: string | null | undefined }) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const normalizedDetail = detail?.trim();
  if (!normalizedDetail) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-1 text-xs text-current/70 transition-colors hover:text-current focus-visible:ring-1 focus-visible:ring-current/35 focus-visible:outline-none"
        aria-expanded={open}
      >
        <ChevronRightIcon className={disclosureChevronClassName(open, "size-3")} />
        {open ? t("errors.hideTechnicalDetails") : t("errors.showTechnicalDetails")}
      </button>
      <DisclosureRegion open={open}>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-black/5 p-2 font-mono text-[10px] leading-relaxed text-current/75 dark:bg-white/5">
          {normalizedDetail}
        </pre>
      </DisclosureRegion>
    </div>
  );
}
