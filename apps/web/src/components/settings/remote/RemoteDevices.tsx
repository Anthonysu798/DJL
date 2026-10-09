import { memo, useId } from "react";

// Vector hardware stays sharp at every Settings width; screen contents are illustrative.
export const RemoteDevices = memo(function RemoteDevices({
  reveal = 1,
  reply = 1,
}: {
  reveal?: number;
  reply?: number;
}) {
  const id = useId().replaceAll(":", "");
  const fill = (name: string) => `url(#${id}-${name})`;
  return (
    <g opacity={reveal}>
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#f5f5f7" />
          <stop offset=".22" stopColor="#93979e" />
          <stop offset=".5" stopColor="#e1e3e7" />
          <stop offset="1" stopColor="#5f636b" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#272a30" />
          <stop offset="1" stopColor="#111316" />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#e8e9ec" />
          <stop offset=".5" stopColor="#a8acb2" />
          <stop offset="1" stopColor="#4b4f55" />
        </linearGradient>
      </defs>
      <ellipse cx="565" cy="305" rx="205" ry="8" fill="#000" opacity=".22" />
      <ellipse cx="196" cy="310" rx="64" ry="9" fill="#000" opacity=".3" />
      <g transform={`translate(${(1 - reveal) * 65} 0)`}>
        <rect
          x="405"
          y="61"
          width="344"
          height="221"
          rx="13"
          fill={fill("metal")}
          stroke="#b4b7bd"
          strokeWidth=".6"
        />
        <rect x="409" y="65" width="336" height="213" rx="10" fill="#08090b" />
        <rect x="417" y="76" width="320" height="192" rx="3" fill={fill("glass")} />
        <rect x="551" y="65" width="51" height="10" rx="5" fill="#08090b" />
        <circle cx="577" cy="70" r="1.3" fill="#282c35" />
        <rect x="417" y="76" width="77" height="192" fill="#202328" />
        <circle cx="427" cy="84" r="2" fill="#ed7770" />
        <circle cx="434" cy="84" r="2" fill="#d8bd6b" />
        <circle cx="441" cy="84" r="2" fill="#8ac298" />
        <text x="427" y="106" fontSize="9" fill="#f1f2f4" fontWeight="600">
          DJL
        </text>
        {[119, 130, 141].map((y, i) => (
          <rect
            key={y}
            x="427"
            y={y}
            width={i === 0 ? 45 : 34}
            height="3"
            rx="1.5"
            fill="#767d89"
            opacity={i === 0 ? 0.8 : 0.32}
          />
        ))}
        <rect x="423" y="159" width="65" height="14" rx="4" fill="#373c44" />
        <rect x="428" y="164" width="44" height="3" rx="1.5" fill="#c9cdd4" />
        <text x="508" y="101" fontSize="8" fill="#cdd1d8" fontWeight="500">
          DJL
        </text>
        <rect x="557" y="116" width="162" height="28" rx="8" fill="#3b424c" />
        <rect x="568" y="124" width="130" height="3" rx="1.5" fill="#d3d7df" />
        <rect x="568" y="132" width="91" height="3" rx="1.5" fill="#969fac" />
        <g opacity={reply}>
          <circle cx="513" cy="161" r="6" fill="#e0e4ea" />
          <path d="m510 161 2 2 4-4" fill="none" stroke="#303640" strokeWidth="1.2" />
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x="508"
              y={178 + i * 10}
              width={(i === 3 ? 124 : 194) * reply}
              height="3"
              rx="1.5"
              fill={i === 0 ? "#d7dce4" : "#687382"}
            />
          ))}
        </g>
        <rect
          x="507"
          y="231"
          width="213"
          height="23"
          rx="7"
          fill="#292f37"
          stroke="#424954"
          strokeWidth=".6"
        />
        <rect x="517" y="241" width="100" height="3" rx="1.5" fill="#707a89" />
        <circle cx="707" cy="242" r="6" fill="#e1e4e9" />
        <path d="m704 242 3-3 3 3m-3-3v6" fill="none" stroke="#282d36" strokeWidth="1" />
        <path
          d="M378 282H773L757 296Q753 300 740 300H408Q395 300 391 296Z"
          fill={fill("edge")}
          stroke="#a4a8ae"
          strokeWidth=".5"
        />
        <path d="M378 282H773L765 286H386Z" fill="#d8dbe0" />
        <path d="M546 282H607L602 287H551Z" fill="#8e939c" />
      </g>
      <g transform={`translate(${(1 - reveal) * -45} 0) rotate(-7 195 179)`}>
        <rect
          x="136"
          y="55"
          width="122"
          height="248"
          rx="24"
          fill={fill("metal")}
          stroke="#dce0e6"
          strokeWidth=".8"
        />
        <rect x="140" y="59" width="114" height="240" rx="21" fill="#080a0d" />
        <rect x="145" y="64" width="104" height="230" rx="18" fill={fill("glass")} />
        <rect x="177" y="70" width="40" height="10" rx="5" fill="#06080a" />
        <rect x="134" y="111" width="2" height="16" rx="1" fill="#8d929a" />
        <rect x="134" y="133" width="2" height="23" rx="1" fill="#8d929a" />
        <text x="197" y="106" textAnchor="middle" fill="#e7e9ed" fontSize="11" fontWeight="600">
          DJL
        </text>
        <circle cx="187" cy="118" r="2" fill="#a4c6b2" />
        <rect x="192" y="116" width="17" height="3" rx="1.5" fill="#91a39b" />
        <rect x="163" y="139" width="77" height="41" rx="10" fill="#404854" />
        {[0, 1, 2].map((i) => (
          <rect
            key={i}
            x="171"
            y={150 + i * 7}
            width={i === 2 ? 35 : 58}
            height="2.5"
            rx="1.2"
            fill="#d4dae2"
            opacity=".8"
          />
        ))}
        <g opacity={reply}>
          <circle cx="159" cy="196" r="5" fill="#dae0e8" />
          <path d="m157 196 1.5 1.5 3-3" stroke="#38414a" fill="none" strokeWidth="1" />
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x="155"
              y={209 + i * 7}
              width={(i === 3 ? 45 : 78) * reply}
              height="2.5"
              rx="1.2"
              fill="#a1acbc"
              opacity={i === 0 ? 1 : 0.55}
            />
          ))}
        </g>
        <rect
          x="152"
          y="253"
          width="90"
          height="21"
          rx="10"
          fill="#303740"
          stroke="#4c5562"
          strokeWidth=".5"
        />
        <path d="M160 264h6m-3-3v6" stroke="#919cab" />
        <circle cx="231" cy="264" r="6" fill="#dce1e8" />
        <path d="m229 264 2-2 2 2m-2-2v4" stroke="#333b45" fill="none" />
        <rect x="178" y="286" width="38" height="2.5" rx="1.25" fill="#c5cbd4" />
        <path d="M151 77Q151 65 166 65H227" stroke="white" opacity=".24" fill="none" />
      </g>
    </g>
  );
});
