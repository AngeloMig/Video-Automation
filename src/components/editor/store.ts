import { create } from "zustand";
import type { TimelineSpec } from "@/timeline/spec";

export type Selection = { track: "visual" | "captions"; id: string } | null;

type EditorState = {
  spec: TimelineSpec | null;
  past: TimelineSpec[];
  future: TimelineSpec[];
  selection: Selection;
  frame: number;
  dirty: boolean;
  init(spec: TimelineSpec): void;
  /** Every edit goes through here, so undo and the unsaved marker can't get out of step. */
  apply(edit: (spec: TimelineSpec) => TimelineSpec): void;
  undo(): void;
  redo(): void;
  select(selection: Selection): void;
  setFrame(frame: number): void;
  markSaved(): void;
};

const HISTORY_LIMIT = 100;

export const useEditor = create<EditorState>((set) => ({
  spec: null,
  past: [],
  future: [],
  selection: null,
  frame: 0,
  dirty: false,
  init: (spec) => set({ spec, past: [], future: [], selection: null, frame: 0, dirty: false }),
  apply: (edit) =>
    set((state) => {
      if (!state.spec) return state;
      const next = edit(state.spec);
      if (next === state.spec) return state;
      return { spec: next, past: [...state.past, state.spec].slice(-HISTORY_LIMIT), future: [], dirty: true };
    }),
  undo: () =>
    set((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous || !state.spec) return state;
      return { spec: previous, past: state.past.slice(0, -1), future: [state.spec, ...state.future], dirty: true };
    }),
  redo: () =>
    set((state) => {
      const [next, ...rest] = state.future;
      if (!next || !state.spec) return state;
      return { spec: next, past: [...state.past, state.spec], future: rest, dirty: true };
    }),
  select: (selection) => set({ selection }),
  setFrame: (frame) => set({ frame }),
  markSaved: () => set({ dirty: false }),
}));
