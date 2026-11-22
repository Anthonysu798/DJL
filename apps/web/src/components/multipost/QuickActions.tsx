import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  IconBulb,
  IconCalendarWeek,
  IconChartBar,
  IconLink,
  IconPhotoPlus,
  IconSpeakerphone,
} from "@tabler/icons-react";
import type { MultiPostState } from "@synara/contracts";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { uploadMultiPostMedia } from "./client";
import { accountReady, autopilotOn, errorMessage, useMultiPostText } from "./shared";

const tones = ["friendly", "professional", "playful", "bold"] as const;
type Style = {
  tone: (typeof tones)[number];
  emojis: boolean;
  hashtags: boolean;
  business: string;
  name: string;
  /** Hashtags the person always wants, as they typed them. */
  tags: string;
  /** DJL asks about the business once, before the first one-click post. */
  asked: boolean;
};
const STYLE_KEY = "djl:multipost:style";
const ADVANCED_KEY = "djl:multipost:advanced";
const defaultStyle: Style = {
  tone: "friendly",
  emojis: true,
  hashtags: true,
  business: "",
  name: "",
  tags: "",
  asked: false,
};
function savedStyle(): Style {
  try {
    const saved = JSON.parse(localStorage.getItem(STYLE_KEY) ?? "{}") as Partial<Style>;
    return {
      ...defaultStyle,
      ...saved,
      tone: tones.includes(saved.tone as Style["tone"]) ? saved.tone! : defaultStyle.tone,
    };
  } catch {
    return defaultStyle;
  }
}

const finish =
  "Post it to all my connected accounts with djl_multipost_post. If Autopilot is off, leave the preview for me to approve.";
/** Each recipe is one sentence of intent; the agent and Autopilot do the rest. */
const recipes = [
  {
    id: "idea",
    icon: IconBulb,
    input: "text",
    request: (value: string) =>
      `Create an eye-catching image and a short caption for this idea: ${value}. Save the image in the workspace first. ${finish}`,
  },
  {
    id: "link",
    icon: IconLink,
    input: "url",
    request: (value: string) =>
      `Read this page: ${value} . Write a post about it and use its main image, or create one. ${finish}`,
  },
  {
    id: "media",
    icon: IconPhotoPlus,
    input: "file",
    request: (value: string) =>
      `Look at this file with djl_multipost_inspect_media: ${value} . Write a caption that fits what is really in it, then post it with that file to every connected account that accepts it, using djl_multipost_post. If Autopilot is off, leave the preview for me to approve.`,
  },
  {
    id: "week",
    icon: IconCalendarWeek,
    input: null,
    request: () =>
      "Plan 7 posts, one for each of the next 7 days. For each one write the caption and create an image, then schedule it with djl_multipost_post at a good local time. When done, show me the plan as a short list.",
  },
  {
    id: "announce",
    icon: IconSpeakerphone,
    input: "text",
    request: (value: string) =>
      `Write an announcement post for: ${value}. Create a matching image and save it in the workspace first. ${finish}`,
  },
  {
    id: "results",
    icon: IconChartBar,
    input: null,
    skill: "$multipost-status",
    request: () =>
      "Tell me in plain words what happened to my recent posts (posted, waiting, failed and why), and suggest what I should post next.",
  },
] as const;
type Recipe = (typeof recipes)[number];
const copy: Record<
  Recipe["id"],
  [title: string, hint: string, field?: string, placeholder?: string]
> = {
  idea: [
    "Post from an idea",
    "Say it in a few words. Get a picture and a caption, posted.",
    "Your idea",
    "Our new oat latte is here",
  ],
  link: [
    "Post about a link",
    "Paste a product or article link. DJL reads it and posts about it.",
    "Link",
  ],
  media: [
    "Post a photo or video",
    "Pick a file. DJL looks at it, writes the caption and posts it.",
  ],
  week: ["Plan my week", "Seven posts with pictures, scheduled one a day."],
  announce: [
    "Announce something",
    "A sale, an event, opening hours. Say what and when.",
    "What's happening?",
    "20% off everything this Saturday",
  ],
  results: ["How did my posts do?", "A plain summary, and what to post next."],
};

export default function QuickActions({
  threadId,
  state,
  onPrompt,
  onAccounts,
  resources,
}: {
  threadId: string;
  state: MultiPostState;
  onPrompt: (text: string) => Promise<boolean>;
  onAccounts: () => void;
  resources?: ReactNode;
}) {
  const l = useMultiPostText();
  const { i18n } = useTranslation("chat");
  const picker = useRef<HTMLInputElement>(null);
  const [style, setStyle] = useState(savedStyle);
  const [open, setOpen] = useState<Recipe["id"] | null>(null);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState<Recipe["id"] | null>(null);
  const [error, setError] = useState("");
  /** The post that waits while DJL asks about the business for the first time. */
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [advanced, setAdvanced] = useState(() => {
    try {
      return localStorage.getItem(ADVANCED_KEY) === "on";
    } catch {
      return false;
    }
  });
  const ready = state.accounts.filter((account) => accountReady(account, state.capabilities));
  const onAutopilot = ready.filter(autopilotOn).length;
  // A post that waited for the one-time question is sent with the answers just typed.
  const latest = useRef(style);
  const update = (patch: Partial<Style>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setStyle(next);
    try {
      localStorage.setItem(STYLE_KEY, JSON.stringify(next));
    } catch {}
  };
  const send = async (recipe: Recipe, input = "") => {
    setSending(recipe.id);
    setError("");
    const language = new Intl.DisplayNames(["en"], { type: "language" }).of(i18n.language);
    const style = latest.current;
    const text = [
      "skill" in recipe ? recipe.skill : "$multipost-publish",
      recipe.request(input.trim()),
      `Tone: ${style.tone}.`,
      style.emojis ? "Use a few emojis." : "No emojis.",
      style.hashtags ? "Add 3 to 5 relevant hashtags." : "No hashtags.",
      language && `Write the post in ${language}.`,
      style.name.trim() && `My business is called ${style.name.trim()}.`,
      style.business.trim() && `About my business: ${style.business.trim()}`,
      style.hashtags && style.tags.trim() && `Always include these hashtags: ${style.tags.trim()}.`,
    ]
      .filter(Boolean)
      .join(" ");
    try {
      await onPrompt(text);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(null);
    }
  };
  const pick = async (recipe: Recipe, file: File | undefined) => {
    if (!file) return;
    setSending(recipe.id);
    setError("");
    try {
      await send(recipe, (await uploadMultiPostMedia(threadId, file)).url);
    } catch (e) {
      setError(errorMessage(e));
      setSending(null);
    }
  };
  /** Runs now, or right after the one-time question about the business. */
  const start = (recipe: Recipe, run: () => void) => {
    if (style.asked || style.name.trim() || style.business.trim() || recipe.id === "results") run();
    else setPending(() => run);
  };
  const resume = () => {
    update({ asked: true });
    pending?.();
    setPending(null);
  };
  const submit = (recipe: Recipe) => (event: FormEvent) => {
    event.preventDefault();
    start(recipe, () => void send(recipe, value));
  };
  return (
    <div className="mp-oneclick">
      <section className="mp-card mp-oneclick-hero">
        <div>
          <h2>{l("oneClickTitle", "One click. DJL does the rest.")}</h2>
          <p className="mp-muted">
            {l(
              "oneClickHint",
              "Pick one. The agent writes it, makes the picture and posts it for you.",
            )}
          </p>
        </div>
        {!ready.length ? (
          <div className="mp-autopilot-line">
            <span>{l("connectFirstShort", "Connect an account to get started.")}</span>
            <Button size="sm" onClick={onAccounts}>
              {l("stepConnect", "Connect an account")}
            </Button>
          </div>
        ) : (
          <div className="mp-autopilot-line" data-on={onAutopilot > 0 || undefined}>
            <span>
              {onAutopilot > 0
                ? l(
                    "autopilotOnCount",
                    "Autopilot is on for {{n}} of {{total}} accounts: those posts go out without asking.",
                    { n: onAutopilot, total: ready.length },
                  )
                : l(
                    "autopilotOffAll",
                    "Autopilot is off: you approve a preview before anything is posted.",
                  )}
            </span>
            {onAutopilot < ready.length && (
              <Button size="sm" variant="outline" onClick={onAccounts}>
                {l("turnOnAutopilot", "Turn on Autopilot")}
              </Button>
            )}
          </div>
        )}
      </section>
      {error && (
        <p role="alert" className="mp-error mp-banner">
          {error}
        </p>
      )}
      {pending && (
        <form
          className="mp-card mp-first-time"
          aria-label={l("firstTimeTitle", "One quick thing first")}
          onSubmit={(event) => {
            event.preventDefault();
            resume();
          }}
        >
          <h2>{l("firstTimeTitle", "One quick thing first")}</h2>
          <p className="mp-muted">
            {l(
              "firstTimeHint",
              "Tell DJL about your business once. Every post will sound like you. You can change it any time under Make it yours.",
            )}
          </p>
          <label className="mp-field">
            <span>{l("businessName", "Business name")}</span>
            <input
              autoFocus
              maxLength={80}
              placeholder={l("businessNamePlaceholder", "Sunrise Bakery")}
              value={style.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <label className="mp-field">
            <span>{l("aboutBusiness", "About your business")}</span>
            <textarea
              rows={2}
              maxLength={400}
              placeholder={l(
                "aboutBusinessPlaceholder",
                "A family bakery in Toronto. Warm, a little funny.",
              )}
              value={style.business}
              onChange={(event) => update({ business: event.target.value })}
            />
          </label>
          <div className="mp-actions">
            <Button type="submit">{l("saveAndContinue", "Save and continue")}</Button>
            <Button type="button" variant="ghost" onClick={resume}>
              {l("skipForNow", "Skip for now")}
            </Button>
          </div>
        </form>
      )}
      <div className="mp-oneclick-body">
        <div className="mp-recipes">
          {recipes.map((recipe) => {
            const [title, hint, field, placeholder] = copy[recipe.id];
            const Icon = recipe.icon;
            const busy = sending === recipe.id;
            return (
              <article
                className="mp-recipe"
                key={recipe.id}
                data-recipe={recipe.id}
                data-open={open === recipe.id || undefined}
                data-busy={busy || undefined}
              >
                <button
                  type="button"
                  className="mp-recipe-main"
                  disabled={!ready.length || sending !== null}
                  aria-expanded={
                    recipe.input && recipe.input !== "file" ? open === recipe.id : undefined
                  }
                  onClick={() => {
                    if (recipe.input === null) start(recipe, () => void send(recipe));
                    else if (recipe.input === "file") start(recipe, () => picker.current?.click());
                    else {
                      setValue("");
                      setOpen(open === recipe.id ? null : recipe.id);
                    }
                  }}
                >
                  <span className="mp-recipe-icon" aria-hidden="true">
                    <Icon size={22} stroke={1.7} />
                  </span>
                  <strong>{l(`recipe_${recipe.id}`, title)}</strong>
                  <span className="mp-muted">
                    {busy
                      ? l("handingOver", "Handing it to the agent…")
                      : l(`recipe_${recipe.id}_hint`, hint)}
                  </span>
                </button>
                {open === recipe.id && field && (
                  <form className="mp-recipe-form" onSubmit={submit(recipe)}>
                    <input
                      autoFocus
                      type={recipe.input === "url" ? "url" : "text"}
                      aria-label={l(`recipe_${recipe.id}_field`, field)}
                      placeholder={
                        placeholder ? l(`recipe_${recipe.id}_placeholder`, placeholder) : "https://"
                      }
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                    />
                    <Button type="submit" disabled={!value.trim() || sending !== null}>
                      {l("createAndPost", "Create and post")}
                    </Button>
                  </form>
                )}
                {recipe.input === "file" && (
                  <input
                    ref={picker}
                    className="sr-only"
                    type="file"
                    accept="image/*,video/*"
                    aria-label={l("choosePhotoOrVideo", "Choose a photo or video")}
                    onChange={(event) => {
                      void pick(recipe, event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                )}
              </article>
            );
          })}
        </div>
        <section className="mp-card mp-style">
          <h2>{l("makeItYours", "Make it yours")}</h2>
          <p className="mp-muted">
            {l("makeItYoursHint", "Set it once. Every one-click post follows it.")}
          </p>
          <div className="mp-style-group" role="radiogroup" aria-label={l("tone", "Tone")}>
            {tones.map((tone) => (
              <button
                type="button"
                role="radio"
                className="mp-chip"
                key={tone}
                aria-checked={style.tone === tone}
                onClick={() => update({ tone })}
              >
                {l(
                  `tone_${tone}`,
                  {
                    friendly: "Friendly",
                    professional: "Professional",
                    playful: "Playful",
                    bold: "Bold",
                  }[tone],
                )}
              </button>
            ))}
          </div>
          <div className="mp-style-group">
            {(["emojis", "hashtags"] as const).map((key) => (
              <button
                type="button"
                role="checkbox"
                className="mp-chip"
                key={key}
                aria-checked={style[key]}
                onClick={() => update({ [key]: !style[key] })}
              >
                {l(key, { emojis: "Emojis", hashtags: "Hashtags" }[key])}
              </button>
            ))}
          </div>
          <label className="mp-field">
            <span>{l("businessName", "Business name")}</span>
            <input
              maxLength={80}
              placeholder={l("businessNamePlaceholder", "Sunrise Bakery")}
              value={style.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          {style.hashtags && (
            <label className="mp-field">
              <span>{l("usualHashtags", "Hashtags you always use")}</span>
              <input
                maxLength={200}
                placeholder={l("usualHashtagsPlaceholder", "#SunriseBakery #TorontoEats")}
                value={style.tags}
                onChange={(event) => update({ tags: event.target.value })}
              />
            </label>
          )}
          <label className="mp-field">
            <span>{l("aboutBusiness", "About your business")}</span>
            <textarea
              rows={3}
              maxLength={400}
              placeholder={l(
                "aboutBusinessPlaceholder",
                "A family bakery in Toronto. Warm, a little funny.",
              )}
              value={style.business}
              onChange={(event) => update({ business: event.target.value })}
            />
          </label>
        </section>
      </div>
      {resources && (
        <section className="mp-card mp-advanced">
          <label className="mp-advanced-switch">
            <span>
              <strong>{l("advancedTools", "Advanced tools")}</strong>
              <span className="mp-muted">
                {l(
                  "advancedToolsHint",
                  "Product links, video clips, media library and more. Most people never need these.",
                )}
              </span>
            </span>
            <Switch
              checked={advanced}
              aria-label={l("advancedTools", "Advanced tools")}
              onCheckedChange={(on) => {
                setAdvanced(on);
                try {
                  localStorage.setItem(ADVANCED_KEY, on ? "on" : "off");
                } catch {}
              }}
            />
          </label>
          {advanced && <div className="mp-all-tools">{resources}</div>}
        </section>
      )}
    </div>
  );
}
