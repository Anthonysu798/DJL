import { useDraft } from "./draft";
import { useUnsaved } from "./unsaved";
import { useEffect, useState } from "react";
import {
  IconAdjustments,
  IconArrowBackUp,
  IconDownload,
  IconExternalLink,
  IconCheck,
  IconLock,
  IconPhoto,
} from "@tabler/icons-react";
import {
  defaultImageRecipe,
  platforms,
  type ImageRecipe,
  type MediaAsset,
  type BrandProfile,
  type Campaign,
  type CampaignPatch,
} from "@synara/contracts";
import { Button } from "~/components/ui/button";
import { command, mediaUrl, type Stored } from "./client";

type Run = (label: string, operation: () => Promise<unknown>) => Promise<boolean>;
export function ImageStudio({
  asset,
  saved,
  run,
  busy,
}: {
  asset: MediaAsset;
  saved?: Stored<{ id: string; recipe: ImageRecipe; history?: ImageRecipe[] }> | undefined;
  run: Run;
  busy: boolean;
}) {
  const draftState = useDraft({
    value: saved?.value.recipe ?? defaultImageRecipe,
    version: saved?.version ?? 0,
  });
  const { value: recipe, setValue: setRecipe, dirty } = draftState;
  const [history, setHistory] = useState<ImageRecipe[]>(saved?.value.history ?? []);
  const [before, setBefore] = useState(false);
  useUnsaved(dirty);
  function edit(patch: Partial<ImageRecipe>) {
    if (busy) return;
    setHistory((h) => [...h.slice(-99), recipe]);
    setRecipe((r) => ({ ...r, ...patch }));
  }
  return (
    <div className="ms-editor">
      <div className="ms-preview-area">
        <div className="ms-preview-toolbar">
          <span>{asset.name}</span>
          <Button variant="outline" size="sm" onClick={() => setBefore(!before)}>
            {before ? "Show edited" : "Show original"}
          </Button>
        </div>
        <div className="ms-canvas">
          <img
            alt={before ? "Original image" : "Saved image adjustments"}
            src={
              before
                ? mediaUrl(asset.id)
                : `${mediaUrl(asset.id, true)}${mediaUrl(asset.id, true).includes("?") ? "&" : "?"}v=${saved?.version ?? 0}`
            }
          />
        </div>
        <div className="ms-preview-toolbar">
          <span>
            {asset.width} × {asset.height} · sRGB export
          </span>
          <span>
            {dirty ? "Unsaved adjustments · Save to update preview" : "Showing saved adjustments"}
          </span>
        </div>
      </div>
      <aside className="ms-inspector">
        <div className="ms-section-title">
          <h2>Adjustments</h2>
          <IconAdjustments size={18} />
        </div>
        {(
          [
            ["exposure", "Exposure", -3, 3, 0.1],
            ["contrast", "Contrast", 0, 3, 0.05],
            ["saturation", "Saturation", 0, 3, 0.05],
            ["temperature", "Temperature", -1, 1, 0.05],
          ] as const
        ).map(([key, label, min, max, step]) => (
          <label className="ms-range" key={key}>
            <span>
              {label}
              <output>{recipe[key].toFixed(2)}</output>
            </span>
            <input
              type="range"
              disabled={busy}
              min={min}
              max={max}
              step={step}
              value={recipe[key]}
              onChange={(e) => edit({ [key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <div className="ms-inspector-section">
          <h3>Geometry</h3>
          <label>
            Rotation
            <select
              value={recipe.rotation}
              onChange={(e) => edit({ rotation: Number(e.target.value) })}
            >
              {[0, 90, 180, 270].map((n) => (
                <option key={n} value={n}>
                  {n}°
                </option>
              ))}
            </select>
          </label>
          <label className="ms-check">
            <input
              type="checkbox"
              checked={recipe.flip}
              onChange={(e) => edit({ flip: e.target.checked })}
            />{" "}
            Flip horizontally
          </label>
          <label>
            Maximum width
            <input
              type="number"
              min={1}
              max={8192}
              placeholder="Original"
              value={recipe.width ?? ""}
              onChange={(e) => edit({ width: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
        </div>
        <div className="ms-actions">
          <Button
            variant="outline"
            disabled={!history.length}
            onClick={() => {
              const previous = history.at(-1);
              if (previous) {
                setRecipe(previous);
                setHistory((h) => h.slice(0, -1));
              }
            }}
          >
            <IconArrowBackUp /> Undo
          </Button>
          <Button
            disabled={busy || !dirty}
            onClick={() =>
              void run("Image adjustments saved", async () => {
                const result = await command({
                  action: "recipe",
                  id: asset.id,
                  version: draftState.version,
                  value: recipe,
                });
                draftState.accept({ value: result.value.recipe, version: result.version });
              })
            }
          >
            Save adjustments
          </Button>
        </div>
        <a
          className={`ms-download ${dirty ? "ms-disabled" : ""}`}
          aria-disabled={dirty}
          href={dirty ? undefined : mediaUrl(asset.id, true, true)}
          download
        >
          <IconDownload size={16} /> Export PNG
        </a>
        <p className="ms-muted">Your original stays untouched. Export removes source metadata.</p>
      </aside>
    </div>
  );
}
export function BrandSettings({
  saved,
  run,
  busy,
}: {
  saved: Stored<BrandProfile>;
  run: Run;
  busy: boolean;
}) {
  const brandDraft = useDraft(saved);
  const { value: brand, setValue: setBrand, dirty } = brandDraft;
  useUnsaved(dirty);
  const fields = [
    ["name", "Business name"],
    ["description", "Business description"],
    ["audience", "Target audience"],
    ["tone", "Brand voice"],
    ["colors", "Brand colors"],
    ["website", "Website"],
    ["facts", "Verified products, prices, addresses, and campaign dates"],
    ["prohibitedClaims", "Claims to avoid"],
    ["language", "Preferred language"],
  ] as const;
  return (
    <form
      className="ms-brand-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run("Brand profile saved", async () => {
          brandDraft.accept(
            await command({ action: "brand", version: brandDraft.version, value: brand }),
          );
        });
      }}
    >
      <div className="ms-panel">
        <div className="ms-eyebrow">YOUR BRAND, CONSISTENT EVERYWHERE</div>
        <h2>Give every campaign a clear voice.</h2>
        <p className="ms-muted">
          Keep the facts and creative direction together. Generation must preserve these details.
        </p>
        <fieldset disabled={busy} className="ms-form-grid">
          {fields.map(([key, label]) => (
            <label
              key={key}
              className={["facts", "prohibitedClaims", "description"].includes(key) ? "wide" : ""}
            >
              {label}
              {["facts", "prohibitedClaims", "description"].includes(key) ? (
                <textarea
                  rows={3}
                  maxLength={20000}
                  value={brand[key]}
                  onChange={(e) => setBrand((b) => ({ ...b, [key]: e.target.value }))}
                />
              ) : (
                <input
                  maxLength={20000}
                  value={brand[key]}
                  onChange={(e) => setBrand((b) => ({ ...b, [key]: e.target.value }))}
                />
              )}
            </label>
          ))}
        </fieldset>
        <Button type="submit" disabled={busy || !dirty}>
          Save brand profile
        </Button>
      </div>
    </form>
  );
}
export function Composer({
  selected,
  assets,
  update,
  run,
  busy,
  onSelectMedia,
}: {
  selected?: Stored<Campaign> | undefined;
  assets: MediaAsset[];
  update: (patch: CampaignPatch, version?: number) => Promise<boolean>;
  run: Run;
  busy: boolean;
  onSelectMedia: () => void;
}) {
  const campaign = selected?.value;
  const [platform, setPlatform] = useState("instagram");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [captionVersion, setCaptionVersion] = useState(selected?.version ?? 0);
  useUnsaved(dirty);
  useEffect(() => {
    if (!dirty) {
      setDraft(campaign?.captions[platform] ?? "");
      setCaptionVersion(selected?.version ?? 0);
      setConfirm(false);
    }
  }, [campaign?.id, campaign?.revision, campaign?.captions, selected?.version, platform, dirty]);
  if (!campaign)
    return (
      <div className="ms-empty">
        <IconPhoto size={36} />
        <h2>Select a campaign to compose.</h2>
        <p>Keep media and platform-specific copy together in one reviewable revision.</p>
      </div>
    );
  const chosen = assets.filter((a) => campaign.assetIds.includes(a.id));
  const provider = platforms.find((p) => p.id === platform)!;
  const approved = campaign.approvedRevision === campaign.revision;
  const posted = campaign.publications[platform]?.revision === campaign.revision;
  return (
    <div className="ms-composer">
      <section className="ms-panel">
        <div className="ms-section-title">
          <h2>Destinations</h2>
          <span>{campaign.platforms.length} selected</span>
        </div>
        <div className="ms-destinations">
          {platforms.map((p) => (
            <label key={p.id} className={campaign.platforms.includes(p.id) ? "selected" : ""}>
              <input
                type="checkbox"
                checked={campaign.platforms.includes(p.id)}
                disabled={busy || dirty}
                onChange={(e) =>
                  void update({
                    platforms: e.target.checked
                      ? [...campaign.platforms, p.id]
                      : campaign.platforms.filter((id) => id !== p.id),
                  })
                }
              />
              {p.name}
            </label>
          ))}
        </div>
        <div className="ms-section-title">
          <h2>Campaign media</h2>
          <Button variant="ghost" size="sm" onClick={onSelectMedia}>
            Choose media
          </Button>
        </div>
        <div className="ms-filmstrip">
          {chosen.map((a) => (
            <a
              key={a.id}
              href={mediaUrl(a.id, a.mime.startsWith("image/"), true)}
              download
              title={`Download ${a.name}`}
            >
              {a.mime.startsWith("image/") ? (
                <img src={mediaUrl(a.id, a.mime.startsWith("image/"))} alt={a.name} />
              ) : (
                <video src={mediaUrl(a.id, a.mime.startsWith("image/"))} muted />
              )}
            </a>
          ))}
        </div>
        <label>
          Platform version
          <select disabled={dirty} value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Caption
          <textarea
            disabled={busy}
            rows={7}
            maxLength={20000}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
            placeholder={`Write your ${provider.name} copy…`}
          />
        </label>
        <div className="ms-section-title">
          <span className="ms-muted">
            {draft.length} characters · Check current platform limits before posting
          </span>
          <Button
            disabled={!dirty || busy}
            onClick={() =>
              void update(
                { captions: { ...campaign.captions, [platform]: draft } },
                captionVersion,
              ).then((ok) => {
                if (ok) setDirty(false);
              })
            }
          >
            Save copy
          </Button>
        </div>
        <div className="ms-notice">
          {provider.kind === "business-messaging"
            ? "WhatsApp is business messaging. Use only consented recipients and approved templates where required; this is not Status publishing."
            : "Assisted publishing: download the assets and copy, then complete publication on the platform."}
        </div>
        <div className="ms-actions">
          <Button
            disabled={busy || dirty || approved}
            onClick={() =>
              void run("Campaign revision approved", () =>
                command({ action: "approve", id: campaign.id, version: selected!.version }),
              )
            }
          >
            <IconCheck /> {approved ? "Revision approved" : "Approve this revision"}
          </Button>
          <Button
            variant="outline"
            disabled={!draft}
            onClick={() => void run("Caption copied", () => navigator.clipboard.writeText(draft))}
          >
            Copy caption
          </Button>
        </div>
        {approved && (
          <div className="ms-assisted">
            <a href={provider.url} target="_blank" rel="noreferrer">
              Open {provider.name} <IconExternalLink size={14} />
            </a>
            {!posted && campaign.platforms.includes(platform) && (
              <Button variant="outline" disabled={busy} onClick={() => setConfirm(true)}>
                I published this version
              </Button>
            )}
            {posted && <span className="ms-pill">User-confirmed · not API verified</span>}
            {confirm && (
              <div role="alertdialog" aria-label="Confirm manual publication">
                <p>
                  Confirm you published revision {campaign.revision} on {provider.name}. DJL cannot
                  verify this post automatically.
                </p>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run("Manual publication confirmed", async () => {
                      await command({
                        action: "confirm",
                        id: campaign.id,
                        version: selected!.version,
                        platform,
                      });
                      setConfirm(false);
                    })
                  }
                >
                  Confirm publication
                </Button>
                <Button variant="ghost" onClick={() => setConfirm(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
      <aside className="ms-post-preview">
        <div className="ms-eyebrow">CONTENT PREVIEW / {provider.name.toUpperCase()}</div>
        <div className="ms-social-card">
          <div className="ms-social-header">
            <span className="ms-avatar">{campaign.name.slice(0, 1)}</span>
            <div>
              <strong>{campaign.name}</strong>
              <small>Account selected on platform</small>
            </div>
          </div>
          <div className="ms-social-media">
            {chosen[0] ? (
              chosen[0].mime.startsWith("image/") ? (
                <img
                  src={mediaUrl(chosen[0].id, chosen[0].mime.startsWith("image/"))}
                  alt={chosen[0].name}
                />
              ) : (
                <video controls src={mediaUrl(chosen[0].id, chosen[0].mime.startsWith("image/"))} />
              )
            ) : (
              <IconPhoto size={48} />
            )}
          </div>
          <div className="ms-social-copy">{draft || "Your caption appears here."}</div>
        </div>
        <p className="ms-muted">
          Content preview only. Final appearance depends on the destination and post format.
        </p>
      </aside>
    </div>
  );
}
export function AccountCatalog() {
  return (
    <>
      <div className="ms-notice">
        <IconLock size={17} /> Direct publishing requires configured official integrations and
        approved account permissions. No social account is currently connected.
      </div>
      <div className="ms-account-grid">
        {platforms.map((p) => (
          <section className="ms-panel" key={p.id}>
            <div className="ms-section-title">
              <h2>{p.name}</h2>
              <span className="ms-pill">Assisted</span>
            </div>
            <p className="ms-muted">
              {p.kind === "business-messaging"
                ? "Consent-based business messaging. No general Status publishing."
                : "Prepare media and copy in the composer, then publish through your own account."}
            </p>
            <a href={p.url} target="_blank" rel="noreferrer">
              Open platform <IconExternalLink size={14} />
            </a>
            <p className="ms-muted">Direct connection is not configured.</p>
          </section>
        ))}
      </div>
    </>
  );
}
export function Analytics({ campaigns }: { campaigns: Campaign[] }) {
  const records = campaigns.flatMap((c) =>
    Object.entries(c.publications).map(([platform, p]) => ({ campaign: c.name, platform, ...p })),
  );
  return (
    <>
      <div className="ms-metrics">
        <div>
          <span>Campaigns</span>
          <strong>{campaigns.length}</strong>
          <small>Local workspace</small>
        </div>
        <div>
          <span>Manual confirmations</span>
          <strong>{records.length}</strong>
          <small>Reported by you</small>
        </div>
        <div>
          <span>Reach & engagement</span>
          <strong>—</strong>
          <small>No authorized analytics source</small>
        </div>
      </div>
      <section className="ms-panel">
        <h2>Publication history</h2>
        <p className="ms-muted">Manual confirmations are not API-verified publication metrics.</p>
        {records.length ? (
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Platform</th>
                <th>Revision</th>
                <th>Confirmed</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={`${r.campaign}:${r.platform}:${r.confirmedAt}`}>
                  <td>{r.campaign}</td>
                  <td>{platforms.find((p) => p.id === r.platform)?.name}</td>
                  <td>{r.revision}</td>
                  <td>{new Date(r.confirmedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No publications recorded yet.</p>
        )}
      </section>
    </>
  );
}
