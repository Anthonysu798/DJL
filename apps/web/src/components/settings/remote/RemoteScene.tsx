import { Easing, interpolate, useCurrentFrame } from "remotion";
import { DJL_LOGO_DOT_ROWS } from "./djlLogoDots";
import { RemoteDevices } from "./RemoteDevices";

export const REMOTE_SCENE_FRAMES = 270;
const ease = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
  easing: Easing.bezier(0.22, 1, 0.36, 1),
} as const;
const dots = DJL_LOGO_DOT_ROWS.flatMap((row, y) =>
  [...row].flatMap((value, x) =>
    value === " " ? [] : [{ x: (x - 20.5) * 6, y: (y - 16.5) * 6, tone: Number(value) }],
  ),
).map((dot, i) => ({
  x: dot.x,
  y: dot.y,
  tone: dot.tone,
  spreadX: Math.cos(i * 2.399963) * (135 + (i % 19) * 8),
  spreadY: Math.sin(i * 2.399963) * (135 + (i % 19) * 8),
}));

export function RemoteScene() {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [91, 132], [0, 1], ease);
  const assembled = interpolate(frame, [0, 64], [0, 1], ease);
  const shrink = interpolate(frame, [86, 128], [1, 0.28], ease);
  const centerX = interpolate(frame, [86, 128], [420, 330], ease);
  const reply = interpolate(frame, [163, 219], [0, 1], ease);
  return (
    <svg
      data-testid="remote-scene"
      data-phase={frame < 91 ? "logo" : "devices"}
      viewBox="0 0 840 350"
      width="100%"
      height="100%"
      aria-hidden="true"
      style={{
        background: "radial-gradient(ellipse at 52% 92%, #303540 0%, #1b1e24 32%, #111317 72%)",
      }}
    >
      <g opacity={interpolate(frame, [247, 269], [1, 0], ease)}>
        <RemoteDevices reveal={reveal} reply={reply} />
        <g opacity={reveal}>
          <path
            d="M260 170H295M365 170H405"
            stroke="#737d8d"
            strokeWidth="1"
            strokeDasharray="1 5"
          />
          {[0, 1, 2].map((i) => {
            const progress = interpolate(frame, [125 + i * 15, 166 + i * 15], [0, 1], ease);
            return (
              <circle
                key={i}
                cx={260 + 145 * progress}
                cy="170"
                r="2"
                fill="#d6e1f0"
                opacity={frame < 220 ? Math.sin(progress * Math.PI) : 0}
              />
            );
          })}
        </g>
        <g transform={`translate(${centerX} 170) scale(${shrink})`}>
          {dots.map((dot) => {
            const spread = 1 - assembled;
            return (
              <circle
                key={`${dot.x}:${dot.y}`}
                cx={dot.x + dot.spreadX * spread}
                cy={dot.y + dot.spreadY * spread}
                r={interpolate(frame, [0, 62], [0.7, 1.55 + dot.tone * 0.085], ease)}
                fill="#edf0f5"
                opacity={interpolate(frame, [0, 22], [0, 0.45 + dot.tone * 0.06], ease)}
              />
            );
          })}
        </g>
        <text
          x="330"
          y="215"
          textAnchor="middle"
          fill="#8e96a3"
          fontSize="9"
          letterSpacing="3"
          opacity={reveal}
        >
          DJL
        </text>
      </g>
    </svg>
  );
}
