import { useReducer } from "react";

// Snapshot-based undo/redo. Every edit in the app already produces a new
// immutable object instead of mutating, so remembering earlier versions only
// costs references — unchanged features are shared between snapshots.

const HISTORY_LIMIT = 50;

interface HistoryEntry<T> {
  label: string;
  state: T;
}

interface HistoryState<T> {
  past: HistoryEntry<T>[];
  present: T;
  future: HistoryEntry<T>[];
  // Bumps on every change (commit, undo, redo, reset), for consumers that
  // need to know "the data changed" without comparing it.
  revision: number;
}

type HistoryAction<T> =
  | { type: "commit"; label: string; update: (present: T) => T }
  | { type: "reset"; present: T }
  | { type: "undo" }
  | { type: "redo" };

function historyReducer<T>(state: HistoryState<T>, action: HistoryAction<T>): HistoryState<T> {
  switch (action.type) {
    case "commit": {
      const next = action.update(state.present);
      if (next === state.present) return state;
      return {
        past: [...state.past, { label: action.label, state: state.present }].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
        revision: state.revision + 1,
      };
    }
    case "reset":
      return { past: [], present: action.present, future: [], revision: state.revision + 1 };
    case "undo": {
      const entry = state.past.at(-1);
      if (!entry) return state;
      return {
        past: state.past.slice(0, -1),
        present: entry.state,
        future: [{ label: entry.label, state: state.present }, ...state.future],
        revision: state.revision + 1,
      };
    }
    case "redo": {
      const [entry, ...rest] = state.future;
      if (!entry) return state;
      return {
        past: [...state.past, { label: entry.label, state: state.present }],
        present: entry.state,
        future: rest,
        revision: state.revision + 1,
      };
    }
  }
}

export function useUndoHistory<T>(initial: T) {
  const [state, dispatch] = useReducer(historyReducer<T>, {
    past: [],
    present: initial,
    future: [],
    revision: 0,
  });

  return {
    present: state.present,
    revision: state.revision,
    undoLabel: state.past.at(-1)?.label ?? null,
    redoLabel: state.future[0]?.label ?? null,
    // `update` should return its input unchanged when there's nothing to do,
    // so no empty history step gets recorded.
    commit: (label: string, update: (present: T) => T) =>
      dispatch({ type: "commit", label, update }),
    // Replaces the state and forgets all history (e.g. a fresh conversion).
    reset: (present: T) => dispatch({ type: "reset", present }),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
  };
}
