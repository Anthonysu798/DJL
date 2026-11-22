import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Schema } from "effect";
import {
  CustomModelProvider,
  CustomModelBaseUrl,
  type CustomModelApiProtocol,
} from "@djl/contracts";
import { ensureNativeApi } from "~/nativeApi";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogPanel,
} from "~/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectItem } from "~/components/ui/select";
import FadeContent from "~/components/react-bits/FadeContent";
import { SettingsSelectPopup } from "./SettingsPanelPrimitives";

const protocols: CustomModelApiProtocol[] = ["openai-chat", "openai-responses", "anthropic"];

export function CustomModelProviderDialog(props: {
  open: boolean;
  definition?: CustomModelProvider;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const existing = props.definition;
  const [providerId, setProviderId] = useState(existing?.providerId ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? "");
  const [protocol, setProtocol] = useState<CustomModelApiProtocol>(
    existing?.protocol ?? "openai-chat",
  );
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<Array<{ rowKey: string; id: string; name: string }>>(
    () => existing?.models.map((model) => ({ ...model, rowKey: crypto.randomUUID() })) ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState(false);
  const busy = saving || fetching;
  const definition = {
    providerId: providerId.trim(),
    name: name.trim(),
    baseUrl: baseUrl.trim(),
    protocol,
    models: models.map((model) => ({
      id: model.id.trim(),
      name: model.name.trim() || model.id.trim(),
    })),
  };
  const valid = Schema.is(CustomModelProvider)(definition);
  const validUrl = Schema.is(CustomModelBaseUrl)(baseUrl.trim());

  const fetchModels = async () => {
    setFetching(true);
    setError(null);
    try {
      const result = await ensureNativeApi().provider.fetchCustomModels({
        ...(existing ? { providerId: existing.providerId } : {}),
        baseUrl: baseUrl.trim(),
        protocol,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setModels((current) => {
        const merged = new Map(
          current.filter((model) => model.id.trim()).map((model) => [model.id.trim(), model]),
        );
        for (const model of result.models)
          if (!merged.has(model.id))
            merged.set(model.id, { ...model, rowKey: crypto.randomUUID() });
        return [...merged.values()];
      });
      setDiscovered(true);
    } catch (cause) {
      setError(
        t("models.custom.fetchFailed", {
          detail: cause instanceof Error ? cause.message : t("models.custom.tryManual"),
        }),
      );
    } finally {
      setFetching(false);
    }
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await ensureNativeApi().provider.saveCustomProvider({
        ...definition,
        ...(existing ? { replaceExisting: true } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey("");
      await props.onSaved();
      props.onOpenChange(false);
    } catch (cause) {
      setError(
        t("models.custom.saveFailed", {
          detail: cause instanceof Error ? cause.message : t("models.custom.tryAgain"),
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!saving) props.onOpenChange(open);
      }}
    >
      <DialogPopup surface="solid" className="max-w-xl overflow-hidden" showCloseButton={!saving}>
        <DialogHeader className="border-b border-border/60 pb-5">
          <DialogTitle>
            {t(existing ? "models.custom.editTitle" : "models.custom.title")}
          </DialogTitle>
          <DialogDescription className="max-w-md leading-relaxed">
            {t("models.custom.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="pt-5">
          <FadeContent trigger="mount" duration={0.22} initialOpacity={0.5} className="pt-4">
            <form
              id="custom-model-api"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
              className="space-y-5"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-xs font-medium">
                  <span>{t("models.custom.providerId")}</span>
                  <Input
                    value={providerId}
                    onChange={(event) => setProviderId(event.target.value)}
                    placeholder="my-relay"
                    disabled={Boolean(existing) || busy}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="space-y-2 text-xs font-medium">
                  <span>{t("models.custom.displayName")}</span>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t("models.custom.namePlaceholder")}
                    disabled={busy}
                    autoComplete="off"
                  />
                </label>
              </div>
              <p className="-mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {t("models.custom.idHint")}
              </p>
              <label className="block space-y-2 text-xs font-medium">
                <span>{t("models.custom.baseUrl")}</span>
                <Input
                  aria-label={t("models.custom.baseUrl")}
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://gateway.example/v1"
                  disabled={busy}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  aria-invalid={Boolean(baseUrl) && !validUrl}
                />
                {baseUrl && !validUrl ? (
                  <span className="block text-[11px] font-normal text-destructive">
                    {t("models.custom.urlHint")}
                  </span>
                ) : null}
              </label>
              <div className="space-y-2 text-xs font-medium">
                <span id="custom-api-protocol-label">{t("models.custom.protocol")}</span>
                <Select
                  value={protocol}
                  disabled={busy}
                  onValueChange={(value) => {
                    if (value) setProtocol(value as CustomModelApiProtocol);
                  }}
                >
                  <SelectTrigger className="w-full" aria-labelledby="custom-api-protocol-label">
                    <SelectValue>{t(`models.custom.protocols.${protocol}`)}</SelectValue>
                  </SelectTrigger>
                  <SettingsSelectPopup>
                    {protocols.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`models.custom.protocols.${value}`)}
                      </SelectItem>
                    ))}
                  </SettingsSelectPopup>
                </Select>
              </div>
              <label className="block space-y-2 text-xs font-medium">
                <span>{t("models.custom.apiKey")}</span>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  disabled={busy}
                  placeholder={t(
                    existing ? "models.custom.keepKey" : "models.custom.keyPlaceholder",
                  )}
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="block text-[11px] font-normal leading-relaxed text-muted-foreground">
                  {t("models.custom.keyHint")}
                </span>
              </label>
              <div className="space-y-3 border-t border-border/60 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium">{t("models.custom.models")}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!validUrl || busy}
                    onClick={() => void fetchModels()}
                  >
                    {t(fetching ? "models.custom.fetching" : "models.custom.fetch")}
                  </Button>
                </div>
                {models.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-5 py-5 text-center text-xs leading-relaxed text-muted-foreground">
                    {t(discovered ? "models.custom.noModels" : "models.custom.empty")}
                  </div>
                ) : null}
                <div className="space-y-2">
                  {models.map((model, index) => (
                    <div key={model.rowKey} className="flex items-center gap-2">
                      <Input
                        aria-label={t("models.custom.modelId")}
                        value={model.id}
                        disabled={saving}
                        placeholder={t("models.custom.modelId")}
                        onChange={(event) =>
                          setModels((current) =>
                            current.map((entry, row) =>
                              row === index ? { ...entry, id: event.target.value } : entry,
                            ),
                          )
                        }
                        spellCheck={false}
                      />
                      <Input
                        aria-label={t("models.custom.modelName")}
                        value={model.name}
                        disabled={saving}
                        placeholder={t("models.custom.modelName")}
                        onChange={(event) =>
                          setModels((current) =>
                            current.map((entry, row) =>
                              row === index ? { ...entry, name: event.target.value } : entry,
                            ),
                          )
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={saving}
                        aria-label={t("models.custom.removeModel", {
                          model: model.id || index + 1,
                        })}
                        onClick={() =>
                          setModels((current) => current.filter((_, row) => row !== index))
                        }
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || models.length >= 500}
                  onClick={() =>
                    setModels((current) => [
                      ...current,
                      { id: "", name: "", rowKey: crypto.randomUUID() },
                    ])
                  }
                >
                  {t("models.custom.addModel")}
                </Button>
              </div>
              {error ? (
                <p
                  role="alert"
                  className="rounded-lg bg-destructive/5 p-3 text-xs leading-relaxed text-destructive"
                >
                  {error}
                </p>
              ) : null}
            </form>
          </FadeContent>
        </DialogPanel>
        <DialogFooter className="border-t border-border/60">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => props.onOpenChange(false)}
          >
            {t("actions.cancel", { ns: "common" })}
          </Button>
          <Button type="submit" form="custom-model-api" disabled={!valid || busy}>
            {t(
              saving
                ? "models.custom.saving"
                : existing
                  ? "models.custom.save"
                  : "models.custom.create",
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
