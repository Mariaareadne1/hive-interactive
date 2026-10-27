import { useSyncExternalStore } from 'react';
import { amend, commit, createHistory, redo, undo, type History } from './history';
import type { GardenDoc } from './document';
import type { FlowerKind, PlantChoice } from '../flowers/kinds';

/** Minimal external store: React reads it through useSyncExternalStore. */

export type Tool = 'draw' | 'move';

/** What is selected: a flower or the hive (document things), or a bee (simulation). */
export type Selection = { kind: 'flower'; id: string } | { kind: 'hive' } | { kind: 'bee'; id: number } | null;

export interface Suggestion {
  id: number;
  flowerId: string;
  alternative: FlowerKind;
}

export interface AppState {
  readonly history: History;
  readonly selection: Selection;
  readonly tool: Tool;
  readonly plant: PlantChoice;
  readonly hasDrawn: boolean;
  readonly uiHidden: boolean;
  readonly toast: { id: number; text: string } | null;
  readonly suggestion: Suggestion | null;
  readonly loading: boolean;
  readonly recording: boolean;
  readonly fatal: string | null;
  /** 0 noon .. 1 golden hour. */
  readonly golden: number;
  readonly raining: boolean;
  /** A bee waiting for "Visit…": the next flower tapped is its destination. */
  readonly visiting: number | null;
  /** Bees whose flight trail is drawn. */
  readonly following: number | null;
  readonly honey: number;
}

type Listener = () => void;

export class Store {
  private state: AppState;
  private readonly listeners = new Set<Listener>();
  private toastId = 0;

  constructor(doc: GardenDoc) {
    this.state = {
      history: createHistory(doc),
      selection: null,
      tool: 'draw',
      plant: 'auto',
      hasDrawn: false,
      uiHidden: false,
      toast: null,
      suggestion: null,
      loading: true,
      recording: false,
      fatal: null,
      golden: 0,
      raining: false,
      visiting: null,
      following: null,
      honey: 0,
    };
  }

  get = (): AppState => this.state;

  get doc(): GardenDoc {
    return this.state.history.present;
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  commit(doc: GardenDoc, patch: Partial<AppState> = {}): void {
    this.set({ ...patch, history: commit(this.state.history, doc) });
  }

  amend(doc: GardenDoc): void {
    this.set({ history: amend(this.state.history, doc) });
  }

  undo(): void {
    this.set({ history: undo(this.state.history), suggestion: null });
    this.dropMissingSelection();
  }

  redo(): void {
    this.set({ history: redo(this.state.history), suggestion: null });
    this.dropMissingSelection();
  }

  toast(text: string): void {
    this.set({ toast: { id: ++this.toastId, text } });
  }

  private dropMissingSelection(): void {
    const s = this.state.selection;
    if (s?.kind === 'flower' && !this.doc.flowers.some((f) => f.id === s.id)) this.set({ selection: null });
  }
}

export function useAppState<T>(store: Store, select: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
