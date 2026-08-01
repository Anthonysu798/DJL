import type { ReactNode } from "react";
import "./app-window-frame.css";

// design.md terminal-card: white surface, 1px hairline, 12px radius, macOS
// traffic-light dots. Doubles as the app-screenshot frame — until the real
// screenshot is supplied via `src`, it renders a quiet placeholder well.
export function AppWindowFrame({
  alt,
  src,
  className,
  children,
}: {
  alt: string;
  src?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <figure className={`awf${className ? ` ${className}` : ""}`}>
      <div className="awf-bar" aria-hidden="true">
        <span className="awf-dot awf-dot--red" />
        <span className="awf-dot awf-dot--yellow" />
        <span className="awf-dot awf-dot--green" />
      </div>
      <div className="awf-body">
        {src ? (
          <img className="awf-shot" src={src} alt={alt} />
        ) : (
          (children ?? (
            <span className="awf-placeholder" role="img" aria-label={alt}>
              djl · desktop
            </span>
          ))
        )}
      </div>
    </figure>
  );
}
