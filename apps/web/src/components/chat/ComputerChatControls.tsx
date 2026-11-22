import type { ProviderMentionReference, ProviderSkillReference, ThreadId } from "@djl/contracts";
import { parseComputerInvocation } from "@djl/shared/computerInvocation";
import { useTranslation } from "~/i18n";
import { MonitorIcon } from "~/lib/icons";
import { useThreadComputerStateSeed } from "~/hooks/useThreadComputerStateSeed";
import type { useComputerChatControl } from "~/hooks/useComputerChatControl";
import { selectThreadComputerState, useComputerStateStore } from "~/computerStateStore";
import { Button } from "../ui/button";
import { ConnectedComputerSetupRequiredCard } from "./ComputerSetupRequiredCard";

export function ComputerChatControlButton({
  control,
  iconOnly,
}: {
  readonly control: ReturnType<typeof useComputerChatControl>;
  readonly iconOnly: boolean;
}) {
  const { t } = useTranslation();
  const label = t(
    control.enabled ? "computer:computerControlIsOnForThisChat" : "computer:computerControlIsOff",
  );
  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      aria-label={label}
      title={label}
      aria-pressed={control.enabled}
      aria-busy={control.pending}
      disabled={control.pending}
      onClick={() => control.setEnabled(!control.enabled)}
    >
      <MonitorIcon className="size-3.5" />
      {!iconOnly ? t("settings:computerControl") : null}
    </Button>
  );
}
export function ComputerChatStatus(props: {
  readonly threadId: ThreadId;
  readonly enabled: boolean;
  readonly error: Error | null;
  readonly messages: readonly {
    readonly role: string;
    readonly text: string;
    readonly mentions?: readonly ProviderMentionReference[];
    readonly skills?: readonly ProviderSkillReference[];
  }[];
}) {
  useThreadComputerStateSeed(props.threadId);
  const state = useComputerStateStore(selectThreadComputerState(props.threadId));
  const message = props.messages.findLast((entry) => entry.role === "user");
  const requested =
    props.enabled ||
    (message &&
      (parseComputerInvocation(message.text) !== null ||
        message.mentions?.some(
          (ref) =>
            ref.path === "plugin://djl/computer-use" ||
            ref.path.startsWith(
              "plugin://djl-mcp/" + encodeURIComponent("plugin://djl/computer-use") + "/",
            ),
        ) ||
        message.skills?.some((ref) => ref.path === "builtin://djl/computer-use/operate")));
  const availability = state?.availability;
  return (
    <>
      {props.error ? (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {props.error.message}
        </p>
      ) : null}
      {requested && availability?.kind === "permission-required" ? (
        <div className="mb-3">
          <ConnectedComputerSetupRequiredCard
            missing={availability.missing}
            buildSignature={availability.buildSignature}
            {...(availability.bundleId ? { bundleId: availability.bundleId } : {})}
          />
        </div>
      ) : null}
    </>
  );
}
