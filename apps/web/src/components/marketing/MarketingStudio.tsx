import { useBlocker } from "@tanstack/react-router";
import { UnsavedContext } from "./unsaved";
import { MediaGrid } from "./MediaGrid";
import { CreativeGenerator } from "./CreativeGenerator";
import { VideoStudio } from "./VideoStudio";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconLayoutDashboard,
  IconPhoto,
  IconAdjustments,
  IconMovie,
  IconSparkles,
  IconSend,
  IconCalendar,
  IconLink,
  IconChartBar,
  IconPalette,
  IconPlus,
  IconArrowRight,
  IconUpload,
  IconCheck,
  IconChevronLeft,
  IconActivity,
  IconX,
} from "@tabler/icons-react";
import { type Campaign, type CampaignPatch, type MediaAsset } from "@synara/contracts";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import { Button } from "~/components/ui/button";
import {
  command,
  loadMarketing,
  importMedia,
  mediaUrl,
  exportUrl,
  cancelJob,
  type Stored,
} from "./client";
import { ImageStudio, BrandSettings, Composer, AccountCatalog, Analytics } from "./panels";
import "./marketing.css";

const sections = [
  ["overview", "Overview", IconLayoutDashboard],
  ["media", "Media library", IconPhoto],
  ["image", "Image editor", IconAdjustments],
  ["video", "Video editor", IconMovie],
  ["generate", "Creative generator", IconSparkles],
  ["compose", "Content composer", IconSend],
  ["calendar", "Publishing calendar", IconCalendar],
  ["accounts", "Connected accounts", IconLink],
  ["analytics", "Campaign analytics", IconChartBar],
  ["brand", "Brand settings", IconPalette],
] as const;
type Section = (typeof sections)[number][0];
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ms-empty">
      <IconPhoto size={36} />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function AssetPreview({ asset, className = "" }: { asset: MediaAsset; className?: string }) {
  return asset.mime.startsWith("video/") ? (
    <video
      className={className}
      src={mediaUrl(asset.id)}
      preload="metadata"
      muted
      aria-label={asset.name}
    />
  ) : (
    <img className={className} src={mediaUrl(asset.id)} alt={asset.name} loading="lazy" />
  );
}
export function MarketingStudio() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["marketing"],
    queryFn: loadMarketing,
    refetchInterval: (q) =>
      q.state.data?.jobs?.some((j) => j.value.status === "rendering") ? 1500 : false,
  });
  const [unsaved, setUnsaved] = useState(false);
  const [section, setSection] = useState<Section>("overview");
  const [campaignId, setCampaignId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activities, setActivities] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  useBlocker({
    shouldBlockFn: () => unsaved && !window.confirm("Discard unsaved changes?"),
    enableBeforeUnload: unsaved,
  });
  const data = query.data;
  const selected = data?.campaigns.find((c) => c.value.id === campaignId);
  const campaign = selected?.value;
  const assets = data?.assets.map((a) => a.value) ?? [];
  const selectedAsset = assets.find((a) => a.id === assetId);
  useEffect(() => () => uploadAbort.current?.abort(), []);
  async function run(label: string, operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      await client.invalidateQueries({ queryKey: ["marketing"] });
      if (label.includes("export")) setActivityOpen(true);
      setActivities((a) => [`${new Date().toLocaleTimeString()} · ${label}`, ...a].slice(0, 50));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The operation failed. Try again.");
      return false;
    } finally {
      await client.invalidateQueries({ queryKey: ["marketing"] });
      setBusy(false);
    }
  }
  async function update(patch: CampaignPatch, version?: number) {
    if (!selected) return false;
    return run("Campaign saved", () =>
      command({ action: "update", id: campaignId, version: version ?? selected.version, patch }),
    );
  }
  async function upload(files: FileList | File[]) {
    const controller = new AbortController();
    uploadAbort.current = controller;
    await run("Media imported", async () => {
      for (const file of Array.from(files)) {
        if (file.size > 256 * 1024 * 1024)
          throw new Error(`${file.name} exceeds the 256 MB import limit.`);
        const result = await importMedia(file, controller.signal);
        setAssetId(result.value.id);
      }
    });
    uploadAbort.current = null;
  }
  const go = (next: Section) => {
    if (unsaved && !window.confirm("Discard unsaved changes?")) return;
    setSection(next);
    mainRef.current?.scrollTo({ top: 0 });
    setError("");
  };
  return (
    <RouteInsetSurface>
      <UnsavedContext value={setUnsaved}>
        <div className="ms-root">
          <header className="ms-topbar">
            <SidebarHeaderNavigationControls />
            <IconPalette size={19} />
            <strong>Marketing Studio</strong>
            <span className="ms-divider" />
            <span className="ms-muted">Your ideas, ready for the world.</span>
            <div className="ms-spacer" />
            <span className="ms-local">
              <span /> Local workspace
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActivityOpen(!activityOpen)}
              aria-label="Background activity"
            >
              <IconActivity />
            </Button>
          </header>
          <div className="ms-body">
            <aside className={`ms-nav ${collapsed ? "ms-nav-collapsed" : ""}`}>
              <div className="ms-nav-heading">
                {!collapsed && <span>WORKSPACE</span>}
                <button
                  aria-label={collapsed ? "Expand sections" : "Collapse sections"}
                  onClick={() => setCollapsed(!collapsed)}
                >
                  <IconChevronLeft size={15} />
                </button>
              </div>
              <nav aria-label="Marketing Studio sections">
                {sections.map(([id, label, Icon]) => (
                  <button
                    key={id}
                    title={label}
                    aria-current={section === id ? "page" : undefined}
                    className={section === id ? "active" : ""}
                    onClick={() => go(id)}
                  >
                    <Icon size={17} />
                    {!collapsed && <span>{label}</span>}
                  </button>
                ))}
              </nav>
              {!collapsed && (
                <div className="ms-nav-foot">
                  <IconCheck size={16} />
                  <p>
                    Originals stay on this device.
                    <br />
                    <span>You're in control of what leaves.</span>
                  </p>
                </div>
              )}
            </aside>
            <main ref={mainRef} className="ms-main">
              <div className="ms-page-heading">
                <div>
                  <div className="ms-eyebrow">
                    MARKETING / {sections.find((s) => s[0] === section)?.[1].toUpperCase()}
                  </div>
                  <h1>
                    {section === "overview"
                      ? "Make something worth sharing."
                      : sections.find((s) => s[0] === section)?.[1]}
                  </h1>
                </div>
                <div className="ms-actions">
                  <Button variant="outline" onClick={() => input.current?.click()} disabled={busy}>
                    <IconUpload /> Import media
                  </Button>
                  <Button onClick={() => setCreating(true)} disabled={busy}>
                    <IconPlus /> New campaign
                  </Button>
                </div>
              </div>
              <input
                ref={input}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/tiff,image/heic,image/avif,video/mp4,video/quicktime,video/webm"
                hidden
                onChange={(e) => {
                  if (e.target.files) void upload(e.target.files);
                  e.target.value = "";
                }}
              />
              {creating && (
                <form
                  className="ms-create"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("Campaign created", async () => {
                      const result = (await command({
                        action: "create",
                        name,
                      })) as Stored<Campaign>;
                      setCampaignId(result.value.id);
                      setCreating(false);
                      setName("");
                    });
                  }}
                >
                  <label>
                    Campaign name
                    <input
                      autoFocus
                      required
                      maxLength={200}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Summer collection, room launch, new menu…"
                    />
                  </label>
                  <Button type="submit" disabled={busy}>
                    Create campaign
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                    Cancel
                  </Button>
                </form>
              )}
              {(error || query.error) && (
                <div role="alert" className="ms-error">
                  {error || query.error?.message}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setError("");
                      void query.refetch();
                    }}
                  >
                    Reload
                  </Button>
                </div>
              )}
              {busy && (
                <div role="status" className="ms-notice">
                  Saving or processing…{" "}
                  {uploadAbort.current && (
                    <button onClick={() => uploadAbort.current?.abort()}>Cancel import</button>
                  )}
                </div>
              )}
              {query.isLoading ? (
                <div className="ms-empty" role="status">
                  Opening your workspace…
                </div>
              ) : (
                data && (
                  <>
                    {section !== "brand" && section !== "accounts" && (
                      <div className="ms-campaign-bar">
                        <label>
                          Campaign
                          <select
                            value={campaignId}
                            onChange={(e) => {
                              if (!unsaved || window.confirm("Discard unsaved changes?"))
                                setCampaignId(e.target.value);
                            }}
                          >
                            <option value="">All campaigns</option>
                            {data.campaigns.map((c) => (
                              <option key={c.value.id} value={c.value.id}>
                                {c.value.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {campaign && (
                          <>
                            <span className="ms-pill">
                              {campaign.approvedRevision === campaign.revision
                                ? "Approved"
                                : "Draft"}{" "}
                              · v{campaign.revision}
                            </span>
                            <span className="ms-muted">
                              Saved {new Date(campaign.updatedAt).toLocaleDateString()}
                            </span>
                          </>
                        )}
                        <div className="ms-spacer" />
                        {campaign && (
                          <Button variant="ghost" size="sm" onClick={() => go("compose")}>
                            Review campaign <IconArrowRight />
                          </Button>
                        )}
                      </div>
                    )}
                    {section === "overview" && (
                      <>
                        <div className="ms-workflow">
                          {[
                            ["Import", "Bring your media", "media"],
                            ["Edit", "Find the right look", "image"],
                            ["Generate", "Shape your story", "generate"],
                            ["Review", "Tailor every post", "compose"],
                            ["Publish", "Choose your channels", "compose"],
                            ["Measure", "Learn what works", "analytics"],
                          ].map(([label, detail, target], i) => (
                            <button key={label} onClick={() => go(target as Section)}>
                              <span className="ms-step">{i + 1}</span>
                              <strong>{label}</strong>
                              <small>{detail}</small>
                            </button>
                          ))}
                        </div>
                        <div className="ms-section-title">
                          <h2>Your campaigns</h2>
                          <span>{data.campaigns.length} campaigns</span>
                        </div>
                        {!data.campaigns.length ? (
                          <Empty
                            title="Every campaign starts with an idea."
                            action={
                              <Button onClick={() => setCreating(true)}>
                                <IconPlus /> Create your first campaign
                              </Button>
                            }
                          >
                            Bring a few photos, a video, or a brief. Keep the creative work and
                            every platform version together.
                          </Empty>
                        ) : (
                          <div className="ms-campaign-grid">
                            {data.campaigns.map(({ value: c }) => {
                              const cover = assets.find((a) => c.assetIds.includes(a.id));
                              return (
                                <button
                                  key={c.id}
                                  className="ms-campaign-card"
                                  onClick={() => {
                                    setCampaignId(c.id);
                                    go("compose");
                                  }}
                                >
                                  <div className="ms-card-media">
                                    {cover ? (
                                      <AssetPreview asset={cover} />
                                    ) : (
                                      <IconPhoto size={36} />
                                    )}
                                    <span className="ms-card-status">
                                      {c.approvedRevision === c.revision ? "Approved" : "Draft"}
                                    </span>
                                  </div>
                                  <div className="ms-card-copy">
                                    <h3>{c.name}</h3>
                                    <p>
                                      {c.assetIds.length} assets <span>·</span> {c.platforms.length}{" "}
                                      destinations
                                    </p>
                                    <div className="ms-card-bottom">
                                      <span>{new Date(c.updatedAt).toLocaleDateString()}</span>
                                      <IconArrowRight size={17} />
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                    {section === "media" && (
                      <>
                        <div className="ms-library-toolbar">
                          <input
                            aria-label="Search media"
                            placeholder="Search your media…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                          <span>{assets.length} original assets</span>
                        </div>
                        <div
                          className="ms-dropzone"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (!busy) void upload(e.dataTransfer.files);
                          }}
                        >
                          <IconUpload />
                          <span>Drop images and videos here</span>
                          <small>Originals are preserved · Up to 256 MB per file</small>
                        </div>
                        <MediaGrid
                          assets={assets.filter((a) =>
                            a.name.toLowerCase().includes(search.toLowerCase()),
                          )}
                          render={(asset) => (
                            <article key={asset.id} className="ms-asset">
                              <button
                                onClick={() => {
                                  setAssetId(asset.id);
                                  go(asset.mime.startsWith("image/") ? "image" : "video");
                                }}
                              >
                                <AssetPreview asset={asset} />
                              </button>
                              <div>
                                <strong title={asset.name}>{asset.name}</strong>
                                <small>
                                  {asset.width} × {asset.height} ·{" "}
                                  {(asset.bytes / 1024 / 1024).toFixed(1)} MB
                                </small>
                                {campaign && (
                                  <label className="ms-check">
                                    <input
                                      type="checkbox"
                                      disabled={busy}
                                      checked={campaign.assetIds.includes(asset.id)}
                                      onChange={(e) =>
                                        void update({
                                          assetIds: e.target.checked
                                            ? [...campaign.assetIds, asset.id]
                                            : campaign.assetIds.filter((id) => id !== asset.id),
                                        })
                                      }
                                    />{" "}
                                    In campaign
                                  </label>
                                )}
                              </div>
                            </article>
                          )}
                        />
                      </>
                    )}
                    {section === "image" && (
                      <>
                        <div className="ms-filmstrip">
                          {assets
                            .filter((a) =>
                              a.mime.startsWith(section === "image" ? "image/" : "video/"),
                            )
                            .map((a) => (
                              <button
                                aria-label={a.name}
                                className={assetId === a.id ? "selected" : ""}
                                key={a.id}
                                onClick={() => {
                                  if (!unsaved || window.confirm("Discard unsaved changes?"))
                                    setAssetId(a.id);
                                }}
                              >
                                <AssetPreview asset={a} />
                              </button>
                            ))}
                        </div>
                        {selectedAsset && selectedAsset.mime.startsWith("image/") ? (
                          <ImageStudio
                            key={selectedAsset.id}
                            asset={selectedAsset}
                            saved={data.recipes.find((r) => r.value.id === selectedAsset.id)}
                            run={run}
                            busy={busy}
                          />
                        ) : (
                          <Empty
                            title="Choose an image to get started."
                            action={
                              <Button variant="outline" onClick={() => input.current?.click()}>
                                Import media
                              </Button>
                            }
                          >
                            Select an asset from the filmstrip or import something new.
                          </Empty>
                        )}
                      </>
                    )}
                    {section === "video" && (
                      <VideoStudio
                        key={campaignId}
                        campaignId={campaignId}
                        assets={assets}
                        saved={data.timelines?.find((r) => r.value.campaignId === campaignId)}
                        run={run}
                        busy={busy}
                      />
                    )}
                    {section === "compose" && (
                      <Composer
                        key={campaignId}
                        selected={selected}
                        assets={assets}
                        update={update}
                        run={run}
                        busy={busy}
                        onSelectMedia={() => go("media")}
                      />
                    )}
                    {section === "brand" && (
                      <BrandSettings saved={data.brand} run={run} busy={busy} />
                    )}
                    {section === "accounts" && <AccountCatalog />}
                    {section === "analytics" && (
                      <Analytics campaigns={data.campaigns.map((c) => c.value)} />
                    )}
                    {section === "generate" && (
                      <CreativeGenerator
                        key={campaignId}
                        selected={selected}
                        update={update}
                        run={run}
                        busy={busy}
                      />
                    )}
                    {section === "calendar" && (
                      <div className="ms-panel">
                        <div className="ms-section-title">
                          <h2>
                            {new Date().toLocaleDateString(undefined, {
                              month: "long",
                              year: "numeric",
                            })}
                          </h2>
                          <span>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
                        </div>
                        <div className="ms-notice">
                          Cloud scheduling is not connected. No posts will publish automatically.
                          Approved campaigns can be exported from the composer.
                        </div>
                        <div className="ms-calendar">
                          {Array.from(
                            {
                              length: new Date(
                                new Date().getFullYear(),
                                new Date().getMonth() + 1,
                                0,
                              ).getDate(),
                            },
                            (_, i) => (
                              <div
                                key={i}
                                className={i + 1 === new Date().getDate() ? "today" : ""}
                              >
                                <span>{i + 1}</span>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )
              )}
            </main>
            {activityOpen && (
              <aside className="ms-activity">
                <div className="ms-section-title">
                  <h2>Activity</h2>
                  <button onClick={() => setActivityOpen(false)} aria-label="Close activity">
                    <IconX size={18} />
                  </button>
                </div>
                {data?.jobs?.map(({ value: j }) => (
                  <div className="ms-job" key={j.id}>
                    <strong>Video export</strong>
                    <p>{j.status}</p>
                    {j.error && <p role="alert">{j.error}</p>}
                    {j.status === "complete" && (
                      <a href={exportUrl(j.id)} download>
                        Download MP4
                      </a>
                    )}
                    {j.status === "rendering" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void run("Export canceled", () => cancelJob(j.id))}
                      >
                        Cancel export
                      </Button>
                    )}
                  </div>
                ))}
                <p className="ms-muted">This session</p>
                {activities.length ? (
                  activities.map((a) => <p key={a}>{a}</p>)
                ) : (
                  <p>No activity yet.</p>
                )}
              </aside>
            )}
          </div>
          <footer className="ms-status">
            <span>Local-first creative workspace</span>
            <span>
              {busy ? "Working…" : "Ready"} · {assets.length} assets
            </span>
          </footer>
        </div>
      </UnsavedContext>
    </RouteInsetSurface>
  );
}
