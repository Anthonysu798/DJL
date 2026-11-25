// FILE: ComposerPinnedSkills.tsx
// Purpose: The skills a new-chat topic attaches, shown as quiet removable pills above the
//          message text. They travel with the message without a `/skill` token in the prompt,
//          and the server inlines each SKILL.md so the agent follows its best practices.
// Layer: Chat composer presentation. Ids and topic mapping live in `@djl/starter-skills`;
//        styles live in index.css (`.composer-pinned-skill*`).

import type { StarterSkillId } from "@djl/starter-skills";
import { useTranslation } from "react-i18next";

import { CentralIcon } from "~/lib/central-icons";
import { XIcon } from "~/lib/icons";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** One glyph per skill, so the pills read at a glance without the label. */
const SKILL_ICONS: Record<StarterSkillId, string> = {
  docx: "file-text",
  "copy-editing": "text-edit",
  xlsx: "table",
  "build-dashboard": "layout-dashboard",
  pptx: "slides-wide",
  "theme-factory": "color-palette",
  "djl-research": "search-intelligence",
  "djl-email": "email-1",
  "djl-planning": "checklist",
  "frontend-design": "window-sparkle",
  "frontend-ui-engineering": "layout-grid-1",
  "systematic-debugging": "bug",
  "djl-automation": "lightning",
  "code-review-and-quality": "code-analyze",
  "documentation-and-adrs": "book",
  "create-readme": "text-block",
};

export function ComposerPinnedSkills(props: {
  skills: readonly StarterSkillId[];
  onRemove: (id: StarterSkillId) => void;
}) {
  const { t } = useTranslation("chat");
  if (props.skills.length === 0) return null;
  return (
    <ul
      aria-label={t("home.skillsLabel")}
      className="-mx-1 -mt-0.5 mb-2.5 flex flex-wrap items-center gap-1.5"
    >
      {props.skills.map((id, index) => {
        const name = t(`home.skills.${id}.name` as never);
        return (
          <li
            key={id}
            className="composer-pinned-skill"
            style={{ animationDelay: `${index * 45}ms` }}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="composer-pinned-skill-label">
                    <CentralIcon
                      name={SKILL_ICONS[id]}
                      className="composer-pinned-skill-icon size-3.5 shrink-0"
                    />
                    <span className="min-w-0 truncate">{name}</span>
                  </span>
                }
              />
              <TooltipPopup side="top" className="max-w-64 whitespace-normal leading-snug">
                <p className="text-xs text-muted-foreground">
                  {t(`home.skills.${id}.description` as never)}
                </p>
              </TooltipPopup>
            </Tooltip>
            <button
              type="button"
              aria-label={t("home.removeSkill", { name })}
              className="composer-pinned-skill-remove"
              onClick={() => props.onRemove(id)}
            >
              <XIcon className="size-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
