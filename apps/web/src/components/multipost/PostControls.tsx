import type { ReactNode } from "react";
import { IconCheck } from "@tabler/icons-react";
import type { MultiPostAccount } from "@djl/contracts";
import { PlatformMark } from "./PlatformMark";
import { useMultiPostText } from "./shared";

export const skippedText = {
  "needs-video": ["skippedNeedsVideo", "{{name}} was skipped: it needs a video."],
  "needs-media": ["skippedNeedsMedia", "{{name}} was skipped: it needs a photo or video."],
  unsupported: [
    "skippedUnsupported",
    "{{name}} was skipped: it only takes articles or podcasts. Use the advanced editor.",
  ],
} as const;

/** Tap an account to leave it out of this post; `children` is the trailing "add" chip. */
export function AccountChips({
  accounts,
  selected,
  onToggle,
  children,
}: {
  accounts: MultiPostAccount[];
  selected: (account: MultiPostAccount) => boolean;
  onToggle: (account: MultiPostAccount, on: boolean) => void;
  children?: ReactNode;
}) {
  const l = useMultiPostText();
  return (
    <div className="mp-chips" role="group" aria-label={l("postTo", "Post to")}>
      {accounts.map((account) => {
        const on = selected(account);
        return (
          <button
            key={account.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            className="mp-chip"
            onClick={() => onToggle(account, !on)}
          >
            <PlatformMark platformKey={account.platformKey} name={account.label} />
            <span>{account.label}</span>
            <IconCheck className="mp-chip-check" size={14} stroke={2.4} aria-hidden="true" />
          </button>
        );
      })}
      {children}
    </div>
  );
}

export function WhenPicker({
  later,
  date,
  timezone,
  onLater,
  onDate,
}: {
  later: boolean;
  date: string;
  timezone: string;
  onLater: (later: boolean) => void;
  onDate: (date: string) => void;
}) {
  const l = useMultiPostText();
  return (
    <div className="mp-step mp-when">
      <div
        className="mp-segment"
        role="radiogroup"
        aria-label={l("timing", "When to publish")}
        data-later={later || undefined}
      >
        <button type="button" role="radio" aria-checked={!later} onClick={() => onLater(false)}>
          {l("rightAway", "Right away")}
        </button>
        <button type="button" role="radio" aria-checked={later} onClick={() => onLater(true)}>
          {l("pickATime", "Pick a time")}
        </button>
      </div>
      {later && (
        <label className="mp-when-pick">
          <input
            type="datetime-local"
            aria-label={l("dateTime", "Date and time")}
            value={date}
            onChange={(event) => onDate(event.target.value)}
          />
          <small className="mp-muted">
            {l("yourTime", "Your local time ({{timezone}})", { timezone })}
          </small>
        </label>
      )}
    </div>
  );
}
