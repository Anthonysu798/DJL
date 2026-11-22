"use client";
/* oxlint-disable react/no-array-index-key -- Frozen snapshot targets have no public account identifiers. */
import { useEffect, useState, type FormEvent } from "react";
import type { CloudSocialPublicReview, CloudSocialReviewFeedbackInput } from "@djl/contracts/cloud";
import SpotlightCard from "@/components/react-bits/SpotlightCard";
import FadeContent from "@/components/react-bits/FadeContent";
import { API_URL } from "@/lib/config";
import "./review.css";

async function reviewRequest(token: string, path = "", init?: RequestInit) {
  return fetch(`${API_URL}/v1/social/review${path}`, {
    ...init,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    redirect: "error",
    headers: {
      "x-review-token": token,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
}
function ReviewMedia({
  token,
  index,
  mimeType,
}: {
  token: string;
  index: number;
  mimeType: string;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    reviewRequest(token, `/media/${index}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Media unavailable");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, index]);
  if (failed)
    return (
      <p role="status" className="review-media-placeholder">
        Media unavailable. This link may have expired or been revoked.
      </p>
    );
  if (!url)
    return (
      <p role="status" className="review-media-placeholder">
        Loading media…
      </p>
    );
  return mimeType === "video/mp4" ? (
    <video className="review-media" src={url} controls playsInline preload="metadata" />
  ) : (
    <img className="review-media" src={url} alt={`Draft media ${index + 1}`} />
  );
}

export function PublicSocialReview() {
  const [token, setToken] = useState("");
  const [review, setReview] = useState<CloudSocialPublicReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [decision, setDecision] = useState<CloudSocialReviewFeedbackInput["decision"]>("comment");
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    const controller = new AbortController();
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
      setError("This review link is unavailable or expired.");
      setLoading(false);
      return;
    }
    setToken(value);
    reviewRequest(value, "", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("This review link is unavailable or expired.");
        const data = (await response.json()) as CloudSocialPublicReview;
        if (!controller.signal.aborted) setReview(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("This review link is unavailable or expired.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await reviewRequest(token, "/feedback", {
        method: "POST",
        body: JSON.stringify({ reviewerName: name, comment, decision }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          setReview((value) => value && { ...value, isCurrent: false });
          throw new Error("The draft changed. Ask the owner for a new review link.");
        }
        if (response.status === 404) {
          setReview(null);
          throw new Error("This review link is unavailable or expired.");
        }
        throw new Error("Could not save feedback. Check your name and comment, then try again.");
      }
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save feedback.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="public-social-review">
      <FadeContent trigger="mount" duration={0.35}>
        <div className="review-heading">
          <span className="review-brand">DJL</span>
          <p>Shared draft review</p>
        </div>
        <SpotlightCard
          theme="light"
          intensity={0.08}
          className="review-surface"
          style={
            {
              "--spotlight-card-surface": "var(--card)",
              "--spotlight-card-border": "var(--border)",
              color: "var(--foreground)",
            } as React.CSSProperties
          }
        >
          <h1>Review this draft</h1>
          <p className="review-description">
            Your feedback applies to the saved version shown here. The owner must confirm
            publication in DJL.
          </p>
          {loading && <p role="status">Loading draft…</p>}
          {error && (
            <p role="alert" className="review-error">
              {error}
            </p>
          )}
          {review && (
            <>
              <p className="review-meta">
                Version {review.revision} · Link expires{" "}
                {new Date(review.expiresAt).toLocaleString()}
              </p>
              {!review.isCurrent && (
                <p className="review-notice">
                  The draft has changed. This is an earlier version, and its approvals no longer
                  apply. Ask the owner for a new link.
                </p>
              )}
              <div className="review-media-list">
                {review.media.map((media) => (
                  <ReviewMedia key={media.index} token={token} {...media} />
                ))}
              </div>
              {review.targets.map((target, index) => (
                <section key={`${target.provider}-${index}`} className="review-caption">
                  <h2>
                    {target.provider === "instagram"
                      ? "Instagram"
                      : target.provider === "tiktok"
                        ? "TikTok"
                        : target.provider}
                  </h2>
                  <p>{target.caption}</p>
                </section>
              ))}
              {!review.targets.length && (
                <section className="review-caption">
                  <h2>Caption</h2>
                  <p>{review.caption}</p>
                </section>
              )}
              <p className="review-meta">
                {review.publicationMode === "now"
                  ? "Intended for publication after owner confirmation"
                  : `Planned for ${new Date(review.scheduledAt).toLocaleString(undefined, { timeZone: review.timezone })} · ${review.timezone}`}
              </p>
              {sent ? (
                <div role="status" className="review-notice">
                  Feedback saved for version {review.revision}. The owner can review it in their
                  chat.
                </div>
              ) : (
                review.isCurrent && (
                  <form onSubmit={(event) => void submit(event)} className="review-form">
                    <h2>Your feedback</h2>
                    <p className="review-meta">
                      Names are self-reported and unverified. Anyone with this link can review this
                      draft.
                    </p>
                    <label htmlFor="reviewer-name">
                      Your name <span>(unverified)</span>
                    </label>
                    <input
                      id="reviewer-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={80}
                      required
                      autoComplete="off"
                    />
                    <label htmlFor="review-decision">Review decision</label>
                    <select
                      id="review-decision"
                      value={decision}
                      onChange={(event) => setDecision(event.target.value as typeof decision)}
                    >
                      <option value="comment">Leave a comment</option>
                      <option value="changes_requested">Request changes</option>
                      <option value="approved">Approve this version for review</option>
                    </select>
                    <label htmlFor="review-comment">
                      Comment {decision === "approved" && <span>(optional)</span>}
                    </label>
                    <textarea
                      id="review-comment"
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      rows={4}
                      maxLength={2000}
                      required={decision !== "approved"}
                    />
                    <p className="review-meta">
                      Approval records your review only. It does not publish or schedule a post.
                    </p>
                    <button
                      type="submit"
                      disabled={
                        busy || !name.trim() || (decision !== "approved" && !comment.trim())
                      }
                    >
                      {busy ? "Saving feedback…" : "Submit feedback"}
                    </button>
                  </form>
                )
              )}
            </>
          )}
        </SpotlightCard>
      </FadeContent>
    </main>
  );
}
