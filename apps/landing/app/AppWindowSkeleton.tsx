import "./app-window-skeleton.css";

// Abstract skeleton of the DJL desktop window — the same anatomy as the real
// app (sidebar, stage rail, exchange, composer) drawn as quiet bars, so the
// frame reads as the product before the real screenshot lands. Rows carry
// data-skel so a parent can stream them in; left static they render complete.
export function AppWindowSkeleton() {
  return (
    <div className="aws" aria-hidden="true">
      <aside className="aws-side">
        <span className="aws-bar aws-bar--tab" data-skel />
        <span className="aws-bar" data-skel style={{ width: "72%" }} />
        <span className="aws-bar" data-skel style={{ width: "58%" }} />
        <span className="aws-bar aws-bar--active" data-skel style={{ width: "80%" }} />
        <span className="aws-bar" data-skel style={{ width: "64%" }} />
      </aside>
      <div className="aws-main">
        <div className="aws-stages" data-skel>
          <span className="aws-dot aws-dot--done" />
          <span className="aws-line" />
          <span className="aws-dot" />
          <span className="aws-line" />
          <span className="aws-dot" />
          <span className="aws-line" />
          <span className="aws-dot" />
        </div>
        <span className="aws-bubble" data-skel />
        <span className="aws-bar" data-skel style={{ width: "56%" }} />
        <span className="aws-bar" data-skel style={{ width: "44%" }} />
        <span className="aws-bar" data-skel style={{ width: "38%" }} />
        <div className="aws-composer" data-skel>
          <span className="aws-chip" />
          <span className="aws-send" />
        </div>
      </div>
    </div>
  );
}
