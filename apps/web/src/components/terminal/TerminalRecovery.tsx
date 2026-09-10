import { useState } from "react";
import { useTranslation } from "react-i18next";
import { readNativeApi } from "~/nativeApi";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { TerminalRuntimeStatus } from "./terminalRuntimeTypes";

export function TerminalRecovery({
  status,
  cwd,
  cwdReady,
  onRetry,
  onDirectoryChange,
}: {
  status: TerminalRuntimeStatus;
  cwd: string;
  cwdReady: boolean;
  onRetry: () => void;
  onDirectoryChange: (cwd: string) => void;
}) {
  const { t } = useTranslation("workspace");
  const [directory, setDirectory] = useState(cwd);
  const [pickerError, setPickerError] = useState<string | null>(null);
  if (cwdReady && status !== "error" && status !== "exited") return null;
  return (
    <div
      className="absolute inset-x-3 top-3 z-20 mx-auto max-w-xl rounded-lg border border-border bg-background p-4 shadow-lg"
      role="status"
    >
      <p className="mb-3 text-sm">
        {t(cwdReady && status === "exited" ? "terminal.sessionEnded" : "terminal.recoveryHelp")}
      </p>
      {!cwdReady || status === "error" ? (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (directory.trim() === cwd) onRetry();
            else if (directory.trim()) onDirectoryChange(directory.trim());
          }}
        >
          <Input
            aria-label={t("terminal.workingDirectory")}
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!directory.trim()}>
            {t("terminal.useFolder")}
          </Button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onRetry}>
          {t(cwdReady && status === "exited" ? "terminal.restart" : "terminal.retry")}
        </Button>
        {!cwdReady || status === "error" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPickerError(null);
              void readNativeApi()
                ?.dialogs.pickFolder()
                .then((path) => {
                  if (!path) return;
                  setDirectory(path);
                  if (path === cwd) onRetry();
                  else onDirectoryChange(path);
                })
                .catch(() => setPickerError(t("terminal.folderPickerFailed")));
            }}
          >
            {t("terminal.chooseFolder")}
          </Button>
        ) : null}
      </div>
      {pickerError ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {pickerError}
        </p>
      ) : null}
    </div>
  );
}
