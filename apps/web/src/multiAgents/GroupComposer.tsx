// FILE: GroupComposer.tsx
// Purpose: The group chat composer: @ menu for members and All, the "wake N agents" check
//          before @all, file attachments and an explicit skill.
// Layer: UI component

import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  type Group,
  type ProviderSkillReference,
  type UploadChatAttachment,
} from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { ensureNativeApi } from "~/nativeApi";

import type { GroupSendInput } from "./GroupChatView";
import { shouldConfirmAll } from "./groupChat.logic";
import {
  activeMentionQuery,
  insertMention,
  mentionMenuItems,
  type MentionQuery,
} from "./groupComposer.logic";

export type GroupComposerHandle = { setText: (text: string) => void; focus: () => void };

type Attachment = { key: string; name: string; upload: UploadChatAttachment };

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });

export function GroupComposer(props: {
  group: Group;
  send: (input: GroupSendInput) => Promise<boolean>;
  handle?: Ref<GroupComposerHandle>;
}) {
  const { t } = useTranslation("shell");
  const { group } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skill, setSkill] = useState<ProviderSkillReference | null>(null);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const skillsQuery = useQuery({
    queryKey: ["multi-agents", "skills", group.folder],
    queryFn: () => ensureNativeApi().provider.listSkillsCatalog({ cwd: group.folder }),
    enabled: skillMenuOpen,
  });
  const skills = (skillsQuery.data?.skills ?? []).filter((entry) => entry.enabled);
  const menuItems = mention ? mentionMenuItems(group, mention.query) : [];

  useImperativeHandle(props.handle, () => ({
    setText: (value) => {
      setText(value);
      requestAnimationFrame(() => {
        const element = textareaRef.current;
        if (!element) return;
        element.focus();
        element.setSelectionRange(value.length, value.length);
      });
    },
    focus: () => textareaRef.current?.focus(),
  }));

  const updateMention = (value: string, cursor: number) => {
    setMention(activeMentionQuery(value, cursor));
    setHighlight(0);
  };

  const choose = (handle: string) => {
    if (!mention) return;
    const next = insertMention(text, mention, handle);
    setText(next.text);
    setMention(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const submit = async (confirmed = false) => {
    const value = text.trim();
    if (!value) return;
    if (!confirmed && shouldConfirmAll(group, value)) {
      setConfirming(true);
      return;
    }
    const sent = await props.send({
      text: value,
      attachments: attachments.map((entry) => entry.upload),
      ...(skill ? { skills: [skill] } : {}),
    });
    if (sent) {
      setText("");
      setAttachments([]);
      setSkill(null);
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

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > PROVIDER_SEND_TURN_MAX_FILE_BYTES) continue;
      const dataUrl = await readDataUrl(file);
      const mimeType = file.type || "application/octet-stream";
      next.push({
        key: `${file.name}-${file.size}-${file.lastModified}`,
        name: file.name,
        upload: mimeType.startsWith("image/")
          ? { type: "image", name: file.name, mimeType, sizeBytes: file.size, dataUrl }
          : { type: "file", name: file.name, mimeType, sizeBytes: file.size, dataUrl },
      });
    }
    setAttachments((current) => [...current, ...next].slice(0, PROVIDER_SEND_TURN_MAX_ATTACHMENTS));
  };

  return (
    <div className="relative border-t border-border p-3">
      {menuItems.length > 0 ? (
        <ul
          role="listbox"
          className="absolute bottom-full left-3 z-10 mb-1 max-h-56 w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          {menuItems.map((item, index) => (
            <li key={item.handle}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${index === highlight ? "bg-muted" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(item.handle);
                }}
              >
                @{item.handle}
                {item.isAll ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t("multiAgents.chat.allMembers")}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {attachments.length > 0 || skill ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {attachments.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="rounded-md bg-muted px-2 py-0.5 text-xs"
              aria-label={t("multiAgents.composer.removeAttachment", { name: entry.name })}
              onClick={() =>
                setAttachments((current) => current.filter((item) => item.key !== entry.key))
              }
            >
              {entry.name} ×
            </button>
          ))}
          {skill ? (
            <button
              type="button"
              className="rounded-md bg-primary/10 px-2 py-0.5 text-xs"
              aria-label={t("multiAgents.composer.removeAttachment", { name: skill.name })}
              onClick={() => setSkill(null)}
            >
              {skill.name} ×
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          className="min-h-10 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          rows={2}
          value={text}
          placeholder={t("multiAgents.chat.placeholder")}
          onChange={(event) => {
            setText(event.target.value);
            updateMention(event.target.value, event.target.selectionStart);
          }}
          onClick={(event) =>
            updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
          }
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (menuItems.length > 0) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setHighlight((current) => (current + step + menuItems.length) % menuItems.length);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                choose(menuItems[highlight]?.handle ?? menuItems[0]!.handle);
                return;
              }
              if (event.key === "Escape") {
                setMention(null);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex flex-col gap-1">
          <Button size="xs" variant="ghost" onClick={() => fileInputRef.current?.click()}>
            {t("multiAgents.composer.attach")}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setSkillMenuOpen((open) => !open)}>
            {t("multiAgents.composer.skill")}
          </Button>
        </div>
        <Button size="sm" onClick={() => void submit()} disabled={!text.trim()}>
          {t("multiAgents.chat.send")}
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          void addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {skillMenuOpen ? (
        <ul className="absolute right-3 bottom-full z-10 mb-1 max-h-56 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
          {skills.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("multiAgents.composer.noSkills")}
            </li>
          ) : (
            skills.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    setSkill({ name: entry.name, path: entry.path });
                    setSkillMenuOpen(false);
                  }}
                >
                  <span className="font-medium">{entry.name}</span>
                  {entry.description ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.description}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
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
