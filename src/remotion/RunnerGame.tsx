import { useCurrentFrame } from "remotion";

/**
 * An original endless-runner animation for the bottom of split-screen videos. It's drawn from code
 * and is a pure function of the frame, so preview and render match and no game footage is involved.
 */
const WIDTH = 1080;
const HEIGHT = 960;
const HORIZON = 250;
const CENTER = WIDTH / 2;
const LANE = 270;
const SPACING = 9;
const SPEED = 0.32;
const RUNNER_AHEAD = 1.5;
const COINS_PER_GAP = 3;
const PLAN_SIZE = 1024;

type Obstacle = { kind: "crate" | "wall" | "hurdle"; lane: number; safe: number };

function hash(value: number) {
  const x = Math.sin(value * 12.9898 + 4.1414) * 43758.5453;
  return x - Math.floor(x);
}

const lanes = [-1, 0, 1];

/** Lays out the course once. Each obstacle records the lane the runner takes to get past it. */
const PLAN: Obstacle[] = (() => {
  const plan: Obstacle[] = [];
  let safe = 0;
  for (let i = 0; i < PLAN_SIZE; i++) {
    const roll = hash(i);
    const lane = lanes[Math.floor(hash(i + 0.5) * 3)];
    if (i === 0) {
      plan.push({ kind: "crate", lane: 1, safe: 0 });
    } else if (roll < 0.2) {
      plan.push({ kind: "hurdle", lane: 0, safe });
    } else if (roll < 0.5) {
      safe = lane;
      plan.push({ kind: "wall", lane, safe });
    } else {
      if (safe === lane) safe = lane === 0 ? (hash(i + 0.25) < 0.5 ? -1 : 1) : 0;
      plan.push({ kind: "crate", lane, safe });
    }
  }
  return plan;
})();

const obstacleAt = (index: number) => PLAN[((index % PLAN_SIZE) + PLAN_SIZE) % PLAN_SIZE];
const scaleAt = (z: number) => 1 / (1 + Math.max(z, -0.9) * 0.16);
const groundY = (scale: number) => HORIZON + (HEIGHT - HORIZON) * scale;
const smoothstep = (from: number, to: number, value: number) => {
  const t = Math.min(Math.max((value - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
};
const fog = (z: number) => 1 - smoothstep(30, 62, z);

function Crate({ x, y, s }: { x: number; y: number; s: number }) {
  const size = 180 * s;
  return (
    <g>
      <rect x={x - size / 2} y={y - size} width={size} height={size} rx={10 * s} fill="#F97316" stroke="#7C2D12" strokeWidth={8 * s} />
      <path d={`M${x - size / 2} ${y - size} L${x + size / 2} ${y} M${x + size / 2} ${y - size} L${x - size / 2} ${y}`} stroke="#7C2D12" strokeWidth={8 * s} />
    </g>
  );
}

function Wall({ safeLane, y, s }: { safeLane: number; y: number; s: number }) {
  return (
    <g>
      {lanes
        .filter((lane) => lane !== safeLane)
        .map((lane) => {
          const width = LANE * 0.92 * s;
          const height = 300 * s;
          const x = CENTER + lane * LANE * s;
          return (
            <g key={lane}>
              <rect x={x - width / 2} y={y - height} width={width} height={height} rx={16 * s} fill="#EC4899" stroke="#831843" strokeWidth={8 * s} />
              <rect x={x - width * 0.34} y={y - height * 0.82} width={width * 0.68} height={height * 0.16} rx={6 * s} fill="#FDE047" />
            </g>
          );
        })}
    </g>
  );
}

function Hurdle({ y, s }: { y: number; s: number }) {
  const width = LANE * 2.9 * s;
  return (
    <g>
      <rect x={CENTER - width / 2} y={y - 90 * s} width={width} height={46 * s} rx={10 * s} fill="#22D3EE" stroke="#164E63" strokeWidth={7 * s} />
      {[-1, 1].map((side) => (
        <rect key={side} x={CENTER + (side * width) / 2.3 - 9 * s} y={y - 90 * s} width={18 * s} height={90 * s} fill="#164E63" />
      ))}
    </g>
  );
}

function Runner({ x, y, s, frame, lift }: { x: number; y: number; s: number; frame: number; lift: number }) {
  const stride = lift > 0 ? 0 : Math.sin(frame * 0.75);
  const bob = lift > 0 ? 0 : Math.abs(Math.sin(frame * 0.75)) * 10;
  const top = y - lift - bob;
  return (
    <g transform={`translate(${x} ${top}) scale(${s * 1.25})`}>
      <ellipse cx={0} cy={lift + bob} rx={58} ry={14} fill="rgba(0,0,0,.45)" />
      <rect x={-34} y={-46} width={24} height={46 + stride * 16} rx={11} fill="#312E81" />
      <rect x={10} y={-46} width={24} height={46 - stride * 16} rx={11} fill="#312E81" />
      <rect x={-48} y={-140} width={96} height={104} rx={34} fill="#FDE047" stroke="#713F12" strokeWidth={6} />
      <rect x={-68} y={-124} width={22} height={60 - stride * 14} rx={11} fill="#FACC15" />
      <rect x={46} y={-124} width={22} height={60 + stride * 14} rx={11} fill="#FACC15" />
      <circle cx={0} cy={-170} r={42} fill="#A5F3FC" stroke="#164E63" strokeWidth={6} />
      <rect x={-5} y={-226} width={10} height={24} fill="#164E63" />
      <circle cx={0} cy={-232} r={10} fill="#F43F5E" />
    </g>
  );
}

export function RunnerGame({ fontFamily }: { fontFamily: string }) {
  const frame = useCurrentFrame();
  const distance = frame * SPEED;
  const runnerPos = distance + RUNNER_AHEAD;

  // Runner path: lane changes finish before the next obstacle arrives.
  const gap = Math.floor(runnerPos / SPACING);
  const within = runnerPos / SPACING - gap;
  const from = obstacleAt(gap).safe;
  const to = obstacleAt(gap + 1).safe;
  const runnerLane = from + (to - from) * smoothstep(0.42, 0.8, within);
  const hurdleDistance = Math.min(...[gap, gap + 1].filter((index) => obstacleAt(index).kind === "hurdle").map((index) => Math.abs(index * SPACING - runnerPos)), 99);
  const lift = hurdleDistance < 2.8 ? Math.cos((hurdleDistance / 2.8) * (Math.PI / 2)) * 210 : 0;

  const coinsTaken = gap * COINS_PER_GAP + [1, 2, 3].filter((step) => gap * SPACING + step * 1.05 < runnerPos).length;

  const items: { z: number; node: React.ReactNode }[] = [];
  const firstIndex = Math.floor((distance - 1) / SPACING);
  for (let index = firstIndex; index < firstIndex + 8; index++) {
    if (index < 0) continue;
    const worldZ = index * SPACING;
    const z = worldZ - distance;
    const s = scaleAt(z);
    const y = groundY(s);
    const obstacle = obstacleAt(index);
    if (z > -0.5) {
      items.push({
        z,
        node: (
          <g key={`o${index}`} opacity={fog(z)}>
            {obstacle.kind === "crate" ? <Crate x={CENTER + obstacle.lane * LANE * s} y={y} s={s} /> : null}
            {obstacle.kind === "wall" ? <Wall safeLane={obstacle.safe} y={y} s={s} /> : null}
            {obstacle.kind === "hurdle" ? <Hurdle y={y} s={s} /> : null}
          </g>
        ),
      });
    }
    for (const step of [1, 2, 3]) {
      const coinZ = worldZ + step * 1.05 - distance;
      if (coinZ <= RUNNER_AHEAD) continue;
      const coinScale = scaleAt(coinZ);
      const spin = Math.abs(Math.cos(frame * 0.22 + step));
      items.push({
        z: coinZ,
        node: (
          <ellipse
            key={`c${index}-${step}`}
            cx={CENTER + obstacle.safe * LANE * coinScale}
            cy={groundY(coinScale) - 80 * coinScale}
            rx={Math.max(38 * coinScale * spin, 3 * coinScale)}
            ry={38 * coinScale}
            fill="#FDE047"
            stroke="#B45309"
            strokeWidth={6 * coinScale}
            opacity={fog(coinZ)}
          />
        ),
      });
    }
  }

  const runnerScale = scaleAt(RUNNER_AHEAD);
  items.push({
    z: RUNNER_AHEAD,
    node: <Runner key="runner" x={CENTER + runnerLane * LANE * runnerScale} y={groundY(runnerScale)} s={runnerScale} frame={frame} lift={lift} />,
  });

  // Sleepers and buildings scroll with the same projection, far to near.
  const bands = Array.from({ length: 34 }, (_, i) => {
    const world = Math.floor(distance / 2) * 2 + i * 2;
    const z0 = Math.max(world - distance, -0.5);
    const y0 = groundY(scaleAt(z0));
    const y1 = groundY(scaleAt(z0 + 1));
    const half0 = LANE * 1.62 * scaleAt(z0);
    const half1 = LANE * 1.62 * scaleAt(z0 + 1);
    return <polygon key={world} points={`${CENTER - half0},${y0} ${CENTER + half0},${y0} ${CENTER + half1},${y1} ${CENTER - half1},${y1}`} fill="#3B3564" opacity={fog(z0)} />;
  }).reverse();

  const firstBlock = Math.floor(distance / 7);
  const buildings = Array.from({ length: 11 }, (_, i) => firstBlock + 10 - i).flatMap((block) =>
    [-1, 1].map((side) => {
      const z = block * 7 - distance;
      if (z < -0.5) return null;
      const s = scaleAt(z);
      const seed = hash(block * 3 + side);
      const width = (300 + seed * 170) * s;
      const height = (420 + seed * 700) * s;
      const x = CENTER + side * (LANE * 1.75 * s + (side > 0 ? 0 : width));
      const y = groundY(s);
      const hues = ["#4C1D95", "#1E3A8A", "#831843", "#0F766E"];
      return (
        <g key={`${block}${side}`} opacity={fog(z)}>
          <rect x={x} y={y - height} width={width} height={height} fill={hues[Math.floor(seed * 4)]} />
          {Array.from({ length: 12 }, (_, w) => (
            <rect
              key={w}
              x={x + width * (0.12 + (w % 3) * 0.29)}
              y={y - height + height * (0.07 + Math.floor(w / 3) * 0.22)}
              width={width * 0.18}
              height={height * 0.11}
              fill={hash(block + w) > 0.45 ? "#FDE68A" : "rgba(15,23,42,.55)"}
            />
          ))}
        </g>
      );
    }),
  );

  return (
    <div style={{ position: "absolute", left: 0, top: HEIGHT, width: WIDTH, height: HEIGHT, overflow: "hidden" }}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} style={{ display: "block" }}>
        <defs>
          <linearGradient id="runner-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1E1B4B" />
            <stop offset="0.7" stopColor="#DB2777" />
            <stop offset="1" stopColor="#FB923C" />
          </linearGradient>
        </defs>
        <rect width={WIDTH} height={HORIZON + 2} fill="url(#runner-sky)" />
        <circle cx={CENTER} cy={HORIZON - 16} r={118} fill="#FEF08A" opacity={0.92} />
        <rect y={HORIZON} width={WIDTH} height={HEIGHT - HORIZON} fill="#17132E" />
        <polygon points={`${CENTER},${HORIZON} ${CENTER + LANE * 1.62},${HEIGHT} ${CENTER - LANE * 1.62},${HEIGHT}`} fill="#2A2650" />
        {bands}
        {[-0.5, 0.5].map((line) => (
          <polygon key={line} points={`${CENTER},${HORIZON} ${CENTER + (line * LANE + 7)},${HEIGHT} ${CENTER + (line * LANE - 7)},${HEIGHT}`} fill="#FDE047" opacity={0.75} />
        ))}
        {buildings}
        {items.sort((a, b) => b.z - a.z).map((item) => item.node)}
      </svg>
      <div
        style={{
          position: "absolute",
          left: 40,
          top: 34,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "8px 26px 8px 12px",
          borderRadius: 44,
          backgroundColor: "rgba(10,8,30,.78)",
          fontFamily,
          fontSize: 56,
          color: "#FDE047",
        }}
      >
        <div style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#FDE047", border: "5px solid #B45309", boxSizing: "border-box" }} />
        {coinsTaken}
      </div>
    </div>
  );
}
