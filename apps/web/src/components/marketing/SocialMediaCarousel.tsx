import { useState } from "react";
import { IconArrowLeft, IconArrowRight, IconTrash } from "@tabler/icons-react";
import FadeContent from "~/components/react-bits/FadeContent";
import { Button } from "~/components/ui/button";
import "./social-media-carousel.css";

export interface CarouselMedia {
  id: string;
  url: string;
  name: string;
}

export function SocialMediaCarousel({
  media,
  onLoad,
  onError,
  className = "",
}: {
  media: CarouselMedia[];
  onLoad?: ((id: string) => void) | undefined;
  onError?: ((id: string) => void) | undefined;
  className?: string;
}) {
  const [selected, setSelected] = useState(0);
  const current = Math.min(selected, Math.max(media.length - 1, 0));
  if (!media.length) return null;
  return (
    <section
      className={`social-media-carousel ${className}`}
      aria-label="Photo carousel"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setSelected(Math.max(0, current - 1));
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          setSelected(Math.min(media.length - 1, current + 1));
        }
      }}
    >
      <div className="social-carousel-stage">
        {media.map((item, index) => (
          <div key={item.id} className="social-carousel-slide" hidden={index !== current}>
            <FadeContent trigger="mount" duration={0.25} initialOpacity={1}>
              <img
                src={item.url}
                alt={item.name}
                onLoad={() => onLoad?.(item.id)}
                onError={() => onError?.(item.id)}
              />
            </FadeContent>
          </div>
        ))}
        {media.length > 1 && (
          <span className="social-carousel-count" aria-live="polite">
            {current + 1} / {media.length}
          </span>
        )}
      </div>
      {media.length > 1 && (
        <div className="social-carousel-nav">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous photo"
            disabled={current === 0}
            onClick={() => setSelected(current - 1)}
          >
            <IconArrowLeft size={16} />
          </Button>
          <div className="social-carousel-dots" role="group" aria-label="Choose photo">
            {media.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Photo ${index + 1}`}
                aria-pressed={current === index}
                onClick={() => setSelected(index)}
              />
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next photo"
            disabled={current === media.length - 1}
            onClick={() => setSelected(current + 1)}
          >
            <IconArrowRight size={16} />
          </Button>
        </div>
      )}
    </section>
  );
}

export function SocialMediaOrder({
  media,
  disabled,
  onChange,
}: {
  media: CarouselMedia[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  function move(index: number, target: number) {
    const next = media.map((item) => item.id);
    const [id] = next.splice(index, 1);
    next.splice(target, 0, id!);
    onChange(next);
  }
  return (
    <div className="social-media-order" aria-label="Photo order">
      <p className="text-xs text-muted-foreground">
        First photo is the Instagram cover. Changes need a fresh publishing review.
      </p>
      {media.map((item, index) => (
        <div className="social-media-order-row" key={item.id}>
          <img src={item.url} alt="" />
          <span className="social-media-order-number">{index + 1}</span>
          <span className="social-media-order-name">{item.name}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled || index === 0}
            aria-label={`Move photo ${index + 1} earlier`}
            onClick={() => move(index, index - 1)}
          >
            <IconArrowLeft size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled || index === media.length - 1}
            aria-label={`Move photo ${index + 1} later`}
            onClick={() => move(index, index + 1)}
          >
            <IconArrowRight size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled || media.length === 1}
            aria-label={`Remove photo ${index + 1}`}
            onClick={() => onChange(media.filter((_, i) => i !== index).map((item) => item.id))}
          >
            <IconTrash size={15} />
          </Button>
        </div>
      ))}
    </div>
  );
}
