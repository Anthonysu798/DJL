import { useState } from "react";
import { IconSparkles } from "@tabler/icons-react";
import type { Campaign, CampaignPatch } from "@synara/contracts";
import { platforms } from "@synara/contracts";
import { Button } from "~/components/ui/button";
import { loadModels, generateCopy, type Stored } from "./client";
export function CreativeGenerator({
  selected,
  update,
  run,
  busy,
}: {
  selected?: Stored<Campaign> | undefined;
  update: (patch: CampaignPatch) => Promise<boolean>;
  run: (label: string, op: () => Promise<unknown>) => Promise<boolean>;
  busy: boolean;
}) {
  const [models, setModels] = useState<Awaited<ReturnType<typeof loadModels>>>([]);
  const [model, setModel] = useState("");
  const [includeImages, setIncludeImages] = useState(false);
  const [consent, setConsent] = useState(false);
  const [generated, setGenerated] = useState<Awaited<ReturnType<typeof generateCopy>> | null>(null);
  if (!selected)
    return (
      <div className="ms-empty">
        <IconSparkles size={32} />
        <h2>Select a campaign first.</h2>
        <p>Choose a campaign to write its brief and generate platform-specific drafts.</p>
      </div>
    );
  const c = selected.value;
  return (
    <div className="ms-two-column">
      <section className="ms-panel">
        <div className="ms-eyebrow">CAMPAIGN BRIEF</div>
        <h2>Tell the story behind your media.</h2>
        <p className="ms-muted">
          Include the offer, audience, and desired outcome. Brand facts and prohibited claims are
          included automatically.
        </p>
        <textarea
          key={c.id + c.revision}
          defaultValue={c.brief}
          rows={8}
          maxLength={20000}
          onBlur={(e) => {
            if (e.target.value !== c.brief) void update({ brief: e.target.value });
          }}
          placeholder="What are you promoting? Who is it for?"
        />
        <div className="ms-section-title">
          <h3>DJL Cloud model</h3>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run("Model catalog loaded", async () => {
                const list = await loadModels();
                setModels(list);
                setModel(list[0]?.id ?? "");
              })
            }
          >
            Load models
          </Button>
        </div>
        <select
          aria-label="Generation model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="">Choose a model</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
        <label className="ms-check" style={{ marginTop: 16 }}>
          <input
            type="checkbox"
            checked={includeImages}
            onChange={(e) => setIncludeImages(e.target.checked)}
          />{" "}
          Include up to four selected images
        </label>
        <div className="ms-notice">
          Generation sends the campaign brief, brand facts, and optionally image previews to your
          selected DJL Cloud model. It may consume existing credits. Originals remain local. Videos
          are not uploaded by this action.
        </div>
        <label className="ms-check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{" "}
          I approve sending this content for generation.
        </label>
        <Button
          style={{ marginTop: 20 }}
          disabled={busy || !model || !consent || !c.platforms.length}
          onClick={() =>
            void run("Draft copy generated", async () =>
              setGenerated(
                await generateCopy({
                  campaignId: c.id,
                  version: selected.version,
                  model,
                  includeImages,
                  consent,
                }),
              ),
            )
          }
        >
          <IconSparkles /> Generate platform drafts
        </Button>
        {!c.platforms.length && (
          <p className="ms-muted">Select destinations in the composer first.</p>
        )}
      </section>
      <section className="ms-panel">
        <h2>Review generated copy</h2>
        <p className="ms-muted">
          Check prices, dates, claims, language, and platform limits before accepting. Generated
          text is never approved or published automatically.
        </p>
        {generated ? (
          <>
            {Object.entries(generated.captions).map(([id, caption]) => (
              <label key={id} style={{ marginBlock: 16 }}>
                {platforms.find((p) => p.id === id)?.name}
                <textarea
                  rows={5}
                  value={caption}
                  onChange={(e) =>
                    setGenerated({
                      ...generated,
                      captions: { ...generated.captions, [id]: e.target.value },
                    })
                  }
                />
              </label>
            ))}
            <Button
              disabled={busy || generated.revision !== c.revision}
              onClick={() => void update({ captions: { ...c.captions, ...generated.captions } })}
            >
              Use these drafts
            </Button>
            {generated.revision !== c.revision && (
              <p>The campaign changed. Generate again to avoid overwriting newer work.</p>
            )}
          </>
        ) : (
          <div className="ms-empty">
            <IconSparkles size={28} />
            <p>Your generated variants will appear here.</p>
          </div>
        )}
      </section>
    </div>
  );
}
