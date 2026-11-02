"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";

export type AgentActivity = Record<string, { running: number; queued: number; failed: number }>;

const NODES: Record<string, { x: number; y: number; label: string }> = {
  discovery: { x: 40, y: 80, label: "Discovery" },
  research: { x: 160, y: 30, label: "Research" },
  script: { x: 280, y: 30, label: "Script" },
  voice: { x: 400, y: 30, label: "Voice" },
  visual: { x: 520, y: 30, label: "Visual" },
  clipping: { x: 280, y: 130, label: "Clipping" },
  editing: { x: 640, y: 80, label: "Editing" },
  qa: { x: 760, y: 80, label: "QA" },
  publishing: { x: 880, y: 80, label: "Publishing" },
  analytics: { x: 1000, y: 80, label: "Analytics" },
};

const EDGES: [string, string][] = [
  ["discovery", "research"],
  ["research", "script"],
  ["script", "voice"],
  ["voice", "visual"],
  ["visual", "editing"],
  ["discovery", "clipping"],
  ["clipping", "editing"],
  ["editing", "qa"],
  ["qa", "publishing"],
  ["publishing", "analytics"],
];

function edgePath(from: string, to: string) {
  const a = NODES[from];
  const b = NODES[to];
  const mid = (a.x + b.x) / 2;
  return `M${a.x} ${a.y} C${mid} ${a.y} ${mid} ${b.y} ${b.x} ${b.y}`;
}

/**
 * The production line as a network. It's still unless a real job is running: a signal only
 * travels into an agent with work in progress, and nothing here animates for show.
 */
export function AgentGraph({ activity }: { activity: AgentActivity }) {
  const reduced = useReducedMotion();
  const anyRunning = Object.values(activity).some((agent) => agent.running > 0);
  return (
    <figure className="overflow-x-auto" aria-label={anyRunning ? "Agents are working" : "All agents are idle"}>
      <svg viewBox="0 0 1040 170" className="block h-auto w-full min-w-[720px]" role="img">
        <title>Production pipeline from discovery to analytics, showing which agents are working now</title>
        {EDGES.map(([from, to]) => {
          const path = edgePath(from, to);
          const live = (activity[to]?.running ?? 0) > 0;
          return (
            <g key={`${from}-${to}`}>
              <path d={path} fill="none" stroke={live ? "#58D5C9" : "#283647"} strokeOpacity={live ? 0.5 : 1} strokeWidth={1.5} />
              {live && !reduced ? (
                <motion.circle
                  r={3}
                  fill="#58D5C9"
                  style={{ offsetPath: `path("${path}")` }}
                  initial={{ offsetDistance: "0%" }}
                  animate={{ offsetDistance: "100%" }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                />
              ) : null}
            </g>
          );
        })}
        {Object.entries(NODES).map(([id, node]) => {
          const state = activity[id];
          const running = (state?.running ?? 0) > 0;
          const queued = (state?.queued ?? 0) > 0;
          const failed = (state?.failed ?? 0) > 0;
          const color = failed ? "#F87171" : running ? "#58D5C9" : queued ? "#77A9FF" : "#3A4A5E";
          const summary = [running && `${state.running} running`, queued && `${state.queued} queued`, failed && `${state.failed} failed`].filter(Boolean).join(", ") || "idle";
          return (
            <Link key={id} href="/agents" aria-label={`${node.label}: ${summary}`}>
              <g>
                <title>{`${node.label}: ${summary}`}</title>
                {running && !reduced ? (
                  <motion.circle cx={node.x} cy={node.y} r={9} fill="none" stroke={color} initial={{ r: 9, opacity: 0.7 }} animate={{ r: 19, opacity: 0 }} transition={{ duration: 1.6, repeat: Infinity }} />
                ) : null}
                <circle cx={node.x} cy={node.y} r={8} fill="#101927" stroke={color} strokeWidth={2} />
                <circle cx={node.x} cy={node.y} r={3} fill={color} />
                <text x={node.x} y={node.y + 26} textAnchor="middle" fill={running ? "#F5F7FA" : "#94A3B8"} fontSize={12} fontFamily="var(--font-geist-sans)">
                  {node.label}
                </text>
              </g>
            </Link>
          );
        })}
      </svg>
    </figure>
  );
}
