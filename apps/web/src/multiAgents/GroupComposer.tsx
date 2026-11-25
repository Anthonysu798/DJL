// FILE: GroupComposer.tsx
// Purpose: The group chat composer, built from the main chat composer's pieces: the same card,
//          `+` menu, `$` skill menu, image and file thumbnails and send button, plus the @ menu
//          for members and All and the "wake N agents" check before @all.
// Layer: UI component

import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  type Group,
  type ProviderSkillDescriptor,
  type UploadChatAttachment,
} from "@djl/contracts";
import { useQuery } from "@tanstack/react-query";
import { resolveSkillOrigin, skillGroupKey } from "~/lib/skillOrigin";
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";

import {
  ComposerCommandMenu,
  type ComposerCommandItem,
} from "~/components/chat/ComposerCommandMenu";
import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { ComposerReferenceAttachments } from "~/components/chat/ComposerReferenceAttachments";
import type { ExpandedImagePreview } from "~/components/chat/ExpandedImagePreview";
import {
  CHAT_COLUMN_FRAME_CLASS_NAME,
  COMPOSER_COMMAND_MENU_FLOATING_WRAPPER_CLASS_NAME,
  COMPOSER_COMMAND_MENU_ITEM_ACTIVE_CLASS_NAME,
  COMPOSER_COMMAND_MENU_ITEM_CLASS_NAME,
  COMPOSER_COMMAND_MENU_SURFACE_CLASS_NAME,
  COMPOSER_EDITOR_MIN_HEIGHT_CLASS_NAME,
  COMPOSER_EDITOR_PADDING_CLASS_NAME,
  COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME,
  COMPOSER_FOOTER_ROW_CLASS_NAME,
  COMPOSER_INPUT_SHELL_CLASS_NAME,
  COMPOSER_INPUT_SURFACE_CLASS_NAME,
} from "~/components/chat/composerPickerStyles";
import { GroupChatIcon } from "~/components/Icons";
import { ProviderIcon } from "~/components/ProviderIcon";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Menu, MenuItem, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { detectComposerTrigger } from "~/composer-logic";
import type { ComposerFileAttachment, ComposerImageAttachment } from "~/composerDraftStore";
import { useTheme } from "~/hooks/useTheme";
import { COMPOSER_ATTACHMENT_ACCEPT } from "~/lib/composerSend";
import {
  ComposerSendArrowIcon,
  FlagIcon,
  PaperclipIcon,
  PlusIcon,
  SkillCubeIcon,
  XIcon,
} from "~/lib/icons";
import {
  buildSkillSearchFields,
  normalizeProviderDiscoveryText,
  rankProviderDiscoveryItems,
} from "~/lib/providerDiscovery";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { parseGroupMentions } from "@djl/shared/groupChat";

import { GroupAgentAvatar } from "./GroupAgentAvatar";
import type { GroupSendInput } from "./GroupChatView";
import { shouldConfirmAll, type GroupMemberRow } from "./groupChat.logic";
import {
  activeMentionQuery,
  composerTokens,
  insertMention,
  insertSkillToken,
  mentionMenuItems,
  plainExcerpt,
  replyMessageText,
  referencedSkills,
} from "./groupComposer.logic";

type ReplyTarget = Pick<GroupMemberRow, "handle" | "provider" | "text">;

export type GroupComposerHandle = {
  setText: (text: string) => void;
  focus: () => void;
  /** Switches the composer to mission mode, where Send plans a mission for the team. */
  startMission: () => void;
  /** Reply to one answer: a chip names who is being answered; the input stays the user's own. */
  replyTo: (row: ReplyTarget) => void;
};

type SkillRange = { query: string; rangeStart: number; rangeEnd: number };
type ComposerMenu =
  | { kind: "mention"; start: number; query: string }
  | ({ kind: "skill" } & SkillRange)
  | null;

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });

const menuAt = (text: string, cursor: number): ComposerMenu => {
  const mention = activeMentionQuery(text, cursor);
  if (mention) return { kind: "mention", ...mention };
  const trigger = detectComposerTrigger(text, cursor);
  return trigger?.kind === "skill"
    ? {
        kind: "skill",
        query: trigger.query,
        rangeStart: trigger.rangeStart,
        rangeEnd: trigger.rangeEnd,
      }
    : null;
};

export function GroupComposer(props: {
  group: Group;
  send: (input: GroupSendInput) => Promise<boolean>;
  onExpandImage: (preview: ExpandedImagePreview) => void;
  handle?: Ref<GroupComposerHandle>;
  /** Plans a mission for the goal; resolves true once the planner has it. */
  onMission?: ((goal: string) => Promise<boolean>) | undefined;
}) {
  const { t } = useTranslation("shell");
  const { t: tChat } = useTranslation("chat");
  const { resolvedTheme } = useTheme();
  const { group } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [text, setText] = useState("");
  const [menu, setMenu] = useState<ComposerMenu>(null);
  const [highlight, setHighlight] = useState(0);
  const [images, setImages] = useState<ComposerImageAttachment[]>([]);
  const [files, setFiles] = useState<ComposerFileAttachment[]>([]);
  const [chosenSkills, setChosenSkills] = useState<ProviderSkillDescriptor[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [missionMode, setMissionMode] = useState(false);
  const [reply, setReply] = useState<ReplyTarget | null>(null);

  const skillsQuery = useQuery({
    queryKey: ["multi-agents", "skills", group.folder],
    queryFn: () => ensureNativeApi().provider.listSkillsCatalog({ cwd: group.folder }),
    enabled: menu?.kind === "skill",
  });
  const skillItems: ComposerCommandItem[] =
    menu?.kind === "skill"
      ? rankProviderDiscoveryItems(
          (skillsQuery.data?.skills ?? []).filter((entry) => entry.enabled),
          normalizeProviderDiscoveryText(menu.query),
          buildSkillSearchFields,
        ).map((skill) => ({
          id: `skill:${skill.path}`,
          type: "skill",
          skill,
          group: skillGroupKey(resolveSkillOrigin(skill), "group"),
          label: skill.interface?.displayName ?? skill.name,
          description: skill.interface?.shortDescription ?? skill.description ?? skill.path,
        }))
      : [];
  const mentionItems = menu?.kind === "mention" ? mentionMenuItems(group, menu.query) : [];
  const menuLength = menu?.kind === "skill" ? skillItems.length : mentionItems.length;
  const membersByHandle = new Map(group.members.map((member) => [member.handle, member]));
  const handles = group.members.map((member) => member.handle);
  const tokens = composerTokens(text, {
    handles,
    skillNames: chosenSkills.map((skill) => skill.name),
  });
  let tokenStart = 0;
  const keyedTokens = tokens.map((token) => {
    const start = tokenStart;
    tokenStart += token.text.length;
    return { kind: token.kind, text: token.text, start };
  });
  // Who this message will wake, shown beside Send while the user types. Without an @, the
  // group's lead or "everyone" setting decides; "whoever answered last" is left unsaid.
  const mentioned = parseGroupMentions(reply ? `@${reply.handle} ${text}` : text, handles);
  const lead = group.members.find((member) => member.id === group.defaultRecipient);
  const toEveryone =
    mentioned.all ||
    (mentioned.handles.length === 0 && !lead && group.defaultRecipient === "all" && !!text.trim());
  // Muted members sit out rounds that go to everyone, unless nobody else is left.
  const unmuted = group.members.filter((member) => !member.muted);
  const recipients = toEveryone
    ? unmuted.length > 0
      ? unmuted
      : group.members
    : mentioned.handles.length > 0
      ? mentioned.handles.flatMap((handle) => membersByHandle.get(handle) ?? [])
      : lead && text.trim()
        ? [lead]
        : [];
  const recipientsLabel =
    recipients.length === 0
      ? null
      : toEveryone
        ? t("multiAgents.composer.sendsToAll")
        : t("multiAgents.composer.sendsTo", {
            names: recipients.map((member) => member.handle).join(", "),
          });

  const placeCursor = (value: string, cursor: number) =>
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(cursor, cursor);
      setMenu(menuAt(value, cursor));
    });

  useImperativeHandle(props.handle, () => ({
    setText: (value) => {
      setText(value);
      placeCursor(value, value.length);
    },
    focus: () => textareaRef.current?.focus(),
    startMission: () => {
      setMissionMode(true);
      textareaRef.current?.focus();
    },
    replyTo: (row) => {
      setMissionMode(false);
      setReply(row);
      textareaRef.current?.focus();
    },
  }));

  const updateMenu = (value: string, cursor: number) => {
    setMenu(menuAt(value, cursor));
    setHighlight(0);
  };

  const chooseMention = (handle: string) => {
    if (menu?.kind !== "mention") return;
    const next = insertMention(text, menu, handle);
    setText(next.text);
    setMenu(null);
    placeCursor(next.text, next.cursor);
  };

  const chooseSkill = (item: ComposerCommandItem) => {
    if (menu?.kind !== "skill" || item.type !== "skill") return;
    const next = insertSkillToken(text, menu, item.skill.name);
    setText(next.text);
    setChosenSkills((current) =>
      current.some((skill) => skill.path === item.skill.path) ? current : [...current, item.skill],
    );
    setMenu(null);
    placeCursor(next.text, next.cursor);
  };

  const startToken = (symbol: "@" | "$") => {
    const element = textareaRef.current;
    const cursor = element?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const insert = before.length === 0 || /\s$/.test(before) ? symbol : ` ${symbol}`;
    const next = before + insert + text.slice(cursor);
    setText(next);
    placeCursor(next, cursor + insert.length);
  };

  const addFiles = (incoming: readonly File[]) => {
    const room = PROVIDER_SEND_TURN_MAX_ATTACHMENTS - images.length - files.length;
    const accepted = incoming
      .filter((file) => file.size <= PROVIDER_SEND_TURN_MAX_FILE_BYTES)
      .slice(0, Math.max(0, room));
    const nextImages: ComposerImageAttachment[] = [];
    const nextFiles: ComposerFileAttachment[] = [];
    for (const file of accepted) {
      const base = {
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        file,
      };
      if (base.mimeType.startsWith("image/"))
        nextImages.push({ ...base, type: "image", previewUrl: URL.createObjectURL(file) });
      else nextFiles.push({ ...base, type: "file" });
    }
    if (nextImages.length > 0) setImages((current) => [...current, ...nextImages]);
    if (nextFiles.length > 0) setFiles((current) => [...current, ...nextFiles]);
  };

  const removeImage = (id: string) =>
    setImages((current) =>
      current.filter((image) => {
        if (image.id === id) URL.revokeObjectURL(image.previewUrl);
        return image.id !== id;
      }),
    );

  const submit = async (confirmed = false) => {
    const value = text.trim();
    if (!value) return;
    if (missionMode && props.onMission) {
      if (await props.onMission(value)) {
        setText("");
        setReply(null);
        setMissionMode(false);
        setMenu(null);
      }
      return;
    }
    if (!confirmed && shouldConfirmAll(group, value)) {
      setConfirming(true);
      return;
    }
    const attachments: UploadChatAttachment[] = await Promise.all(
      [...images, ...files].map(async (entry): Promise<UploadChatAttachment> => {
        const dataUrl = await readDataUrl(entry.file);
        const { name, mimeType, sizeBytes } = entry;
        return entry.type === "image"
          ? { type: "image", name, mimeType, sizeBytes, dataUrl }
          : { type: "file", name, mimeType, sizeBytes, dataUrl };
      }),
    );
    const skills = referencedSkills(value, chosenSkills).map(({ name, path }) => ({ name, path }));
    const sent = await props.send({
      text: reply ? replyMessageText(reply, value) : value,
      attachments,
      ...(skills.length > 0 ? { skills } : {}),
    });
    if (sent) {
      for (const image of images) URL.revokeObjectURL(image.previewUrl);
      setText("");
      setReply(null);
      setImages([]);
      setFiles([]);
      setChosenSkills([]);
      setMenu(null);
    }
  };

  const confirmAll = async () => {
    setConfirming(false);
    if (dontAskAgain)
      await ensureNativeApi()
        .groups.update({ groupId: group.id, skipAllWarning: true })
        .catch(() => undefined);
    await submit(true);
  };

  const menuOpen = menu !== null && (menu.kind === "skill" || mentionItems.length > 0);

  return (
    <div className={cn(CHAT_COLUMN_FRAME_CLASS_NAME, "px-4 pt-1 pb-4")}>
      <div className={cn(COMPOSER_INPUT_SHELL_CLASS_NAME, menuOpen && "overflow-visible")}>
        <div
          data-dragging={dragging ? "" : undefined}
          className={cn(
            COMPOSER_INPUT_SURFACE_CLASS_NAME,
            "cursor-text focus-within:border-foreground/25 data-dragging:border-dashed data-dragging:border-foreground/40 dark:focus-within:border-foreground/25 dark:data-dragging:border-foreground/40",
            menuOpen && "overflow-visible",
          )}
          onClick={(event) => {
            // The whole card is the text field: a click on its padding focuses the input.
            if (event.target === event.currentTarget) textareaRef.current?.focus();
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDragging(false);
          }}
          onDrop={(event) => {
            setDragging(false);
            if (event.dataTransfer.files.length === 0) return;
            event.preventDefault();
            addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <div className={cn(COMPOSER_EDITOR_PADDING_CLASS_NAME, menuOpen && "overflow-visible")}>
            {menuOpen ? (
              <div className={COMPOSER_COMMAND_MENU_FLOATING_WRAPPER_CLASS_NAME}>
                {menu?.kind === "skill" ? (
                  <ComposerCommandMenu
                    items={skillItems}
                    resolvedTheme={resolvedTheme}
                    isLoading={skillsQuery.isLoading}
                    triggerKind="skill"
                    activeItemId={skillItems[highlight]?.id ?? null}
                    onHighlightedItemChange={(itemId) => {
                      const index = skillItems.findIndex((item) => item.id === itemId);
                      if (index !== -1) setHighlight(index);
                    }}
                    onSelect={chooseSkill}
                  />
                ) : (
                  <div className={COMPOSER_COMMAND_MENU_SURFACE_CLASS_NAME}>
                    <div role="listbox" className="max-h-72 overflow-y-auto p-1">
                      {mentionItems.map((item, index) => {
                        const member = membersByHandle.get(item.handle);
                        return (
                          <div
                            key={item.handle}
                            role="option"
                            aria-selected={index === highlight}
                            className={cn(
                              COMPOSER_COMMAND_MENU_ITEM_CLASS_NAME,
                              index === highlight && COMPOSER_COMMAND_MENU_ITEM_ACTIVE_CLASS_NAME,
                            )}
                            onMouseMove={() => setHighlight(index)}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              chooseMention(item.handle);
                            }}
                          >
                            <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/60">
                              {member ? (
                                <ProviderIcon provider={member.provider} className="size-3.5" />
                              ) : (
                                <GroupChatIcon className="size-3.5" />
                              )}
                            </span>
                            <span className="shrink-0 text-[11.5px] font-medium text-foreground/80">
                              @{item.handle}
                            </span>
                            <span className="truncate text-[11px] text-muted-foreground/55">
                              {item.isAll ? t("multiAgents.chat.allMembers") : (member?.role ?? "")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            {reply ? (
              <div
                data-testid="group-composer-reply"
                className="mb-2 flex animate-in items-center gap-2 rounded-xl bg-[var(--glass-control-fill)] py-1.5 pr-1.5 pl-2.5 text-xs duration-200 fade-in slide-in-from-bottom-1 motion-reduce:animate-none"
              >
                <GroupAgentAvatar provider={reply.provider} size="xs" />
                <span className="shrink-0 font-medium text-foreground">
                  {t("multiAgents.reply.replyingTo", { name: reply.handle })}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {plainExcerpt(reply.text, 140)}
                </span>
                <button
                  type="button"
                  aria-label={t("multiAgents.reply.cancelReply")}
                  title={t("multiAgents.reply.cancelReply")}
                  className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--glass-control-fill-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.94]"
                  onClick={() => {
                    setReply(null);
                    textareaRef.current?.focus();
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ) : null}
            <ComposerReferenceAttachments
              assistantSelections={[]}
              fileComments={[]}
              files={files}
              images={images}
              nonPersistedImageIdSet={new Set()}
              onExpandImage={props.onExpandImage}
              onRemoveAssistantSelections={() => undefined}
              onRemoveFileComments={() => undefined}
              onRemoveFile={(id) => setFiles((current) => current.filter((file) => file.id !== id))}
              onRemoveImage={removeImage}
            />
            <div className="relative">
              {/* The text is drawn here so mentions and skills can be coloured; the textarea on
                  top keeps the caret, selection and typing, with its own text transparent. */}
              <div
                ref={mirrorRef}
                aria-hidden
                data-testid="group-composer-mirror"
                className={cn(
                  "pointer-events-none absolute inset-0 overflow-hidden wrap-break-word whitespace-pre-wrap text-foreground",
                  COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME,
                )}
              >
                {keyedTokens.map((token) =>
                  token.kind === "text" ? (
                    <span key={token.start}>{token.text}</span>
                  ) : (
                    <span
                      key={token.start}
                      data-token={token.kind}
                      className="rounded-[4px] bg-[color-mix(in_srgb,var(--color-text-accent)_16%,transparent)] text-[var(--color-text-accent)] [box-decoration-break:clone]"
                    >
                      {token.text}
                    </span>
                  ),
                )}
                {"\u200b"}
              </div>
              <textarea
                ref={textareaRef}
                data-testid="group-composer-input"
                aria-label={
                  missionMode
                    ? t("multiAgents.mission.placeholder")
                    : t("multiAgents.chat.placeholder")
                }
                className={cn(
                  "relative m-0 block max-h-[200px] w-full resize-none overflow-y-auto border-0 bg-transparent p-0 text-transparent caret-[var(--color-text-foreground)] [field-sizing:content] [scrollbar-width:none] focus:outline-none [&::-webkit-scrollbar]:hidden",
                  COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME,
                  COMPOSER_EDITOR_MIN_HEIGHT_CLASS_NAME,
                  "placeholder:text-muted-foreground/40",
                )}
                rows={2}
                value={text}
                placeholder={
                  missionMode
                    ? t("multiAgents.mission.placeholder")
                    : t("multiAgents.chat.placeholder")
                }
                onScroll={(event) => {
                  if (mirrorRef.current)
                    mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
                }}
                onChange={(event) => {
                  setText(event.target.value);
                  updateMenu(event.target.value, event.target.selectionStart);
                }}
                onClick={(event) =>
                  updateMenu(event.currentTarget.value, event.currentTarget.selectionStart)
                }
                onPaste={(event) => {
                  const pasted = Array.from(event.clipboardData.files);
                  if (pasted.length === 0) return;
                  event.preventDefault();
                  addFiles(pasted);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (menuOpen) {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      if (menuLength === 0) return;
                      const step = event.key === "ArrowDown" ? 1 : -1;
                      setHighlight((current) => (current + step + menuLength) % menuLength);
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setMenu(null);
                      return;
                    }
                    if ((event.key === "Enter" || event.key === "Tab") && menuLength > 0) {
                      event.preventDefault();
                      if (menu?.kind === "skill")
                        chooseSkill(skillItems[highlight] ?? skillItems[0]!);
                      else chooseMention((mentionItems[highlight] ?? mentionItems[0]!).handle);
                      return;
                    }
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
            </div>
          </div>
          <div className={COMPOSER_FOOTER_ROW_CLASS_NAME}>
            <div className="flex min-w-0 items-center gap-1">
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="chrome"
                      className="shrink-0 rounded-md"
                      aria-label={tChat("composer.extras")}
                    />
                  }
                >
                  <PlusIcon aria-hidden="true" className="size-4" />
                </MenuTrigger>
                <ComposerPickerMenuPopup align="start">
                  <MenuItem onClick={() => fileInputRef.current?.click()}>
                    <PaperclipIcon className="size-4 shrink-0" />
                    {tChat("composer.addFiles")}
                  </MenuItem>
                  <MenuItem onClick={() => startToken("$")}>
                    <SkillCubeIcon className="size-4 shrink-0" />
                    {t("multiAgents.composer.skill")}
                  </MenuItem>
                </ComposerPickerMenuPopup>
              </Menu>
              {(
                [
                  ["@", t("multiAgents.composer.mention")],
                  ["$", t("multiAgents.composer.skill")],
                ] as const
              ).map(([symbol, label]) => (
                <Tooltip key={symbol}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={label}
                        className="flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-[13px] text-[var(--color-text-foreground-secondary)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.94]"
                        onClick={() => startToken(symbol)}
                      />
                    }
                  >
                    {symbol}
                  </TooltipTrigger>
                  <TooltipPopup side="top">{label}</TooltipPopup>
                </Tooltip>
              ))}
              {props.onMission ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={t("multiAgents.mission.toggle")}
                        aria-pressed={missionMode}
                        data-testid="group-composer-mission"
                        className={cn(
                          "flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-[var(--color-text-foreground-secondary)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.94] [&_svg]:size-3.5",
                          missionMode &&
                            "bg-[var(--color-background-button-secondary-hover)] text-foreground",
                        )}
                        onClick={() => {
                          setMissionMode((on) => !on);
                          textareaRef.current?.focus();
                        }}
                      />
                    }
                  >
                    <FlagIcon />
                    {missionMode ? t("multiAgents.mission.mode") : null}
                  </TooltipTrigger>
                  <TooltipPopup side="top">{t("multiAgents.mission.toggleHint")}</TooltipPopup>
                </Tooltip>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              {recipientsLabel ? (
                <span
                  data-testid="group-composer-recipients"
                  title={recipientsLabel}
                  className="flex animate-in items-center -space-x-1.5 duration-200 fade-in motion-reduce:animate-none"
                >
                  <span className="sr-only">{recipientsLabel}</span>
                  {recipients.slice(0, 4).map((member) => (
                    <GroupAgentAvatar
                      key={member.id}
                      provider={member.provider}
                      size="xs"
                      className="ring-2 ring-[var(--color-background-surface)]"
                    />
                  ))}
                </span>
              ) : null}
              <Button
                type="button"
                variant="prominent"
                size="icon-xs"
                className="size-7 rounded-full transition-[opacity,transform,background-color] duration-200 ease-out active:scale-90 disabled:scale-90 sm:size-7"
                disabled={!text.trim()}
                aria-label={t("multiAgents.chat.send")}
                onClick={() => void submit()}
              >
                <ComposerSendArrowIcon aria-hidden="true" className="size-5 shrink-0" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <input
        ref={fileInputRef}
        data-testid="group-composer-files"
        type="file"
        accept={COMPOSER_ATTACHMENT_ACCEPT}
        multiple
        className="sr-only"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogPopup className="max-w-sm gap-0 p-0">
          <DialogHeader className="gap-1 p-4 pr-12">
            <DialogTitle className="text-base">
              {t("multiAgents.confirmAll.title", { count: group.members.length })}
            </DialogTitle>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-3 px-4 py-2 text-sm">
            <p className="text-muted-foreground">{t("multiAgents.confirmAll.body")}</p>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={dontAskAgain}
                onChange={(event) => setDontAskAgain(event.target.checked)}
              />
              {t("multiAgents.confirmAll.dontAsk")}
            </label>
          </DialogPanel>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
              {t("multiAgents.confirmAll.cancel")}
            </Button>
            <Button size="sm" onClick={() => void confirmAll()}>
              {t("multiAgents.confirmAll.send")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
