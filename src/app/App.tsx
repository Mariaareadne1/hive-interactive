import { useEffect, useRef, useState } from 'react';
import { Engine } from '../engine/Engine';
import { Store, useAppState, type Selection } from '../state/store';
import { defaultDoc, emptyDoc, showcaseDoc, type GardenDoc } from '../state/document';
import { downloadBlob, loadDoc } from '../state/persistence';
import { HiveApp } from './HiveApp';
import { PointerInput } from '../interaction/PointerInput';
import { recordCanvas } from '../capture/recorder';
import { PLANT_CHOICES } from '../flowers/kinds';
import { Chrome } from './ui/Chrome';
import { SelectionOverlay } from './ui/SelectionOverlay';

interface Running {
  engine: Engine;
  app: HiveApp;
  input: PointerInput;
}

declare global {
  interface Window {
    __hive?: Running & { store: Store };
  }
}

function initialDoc(params: URLSearchParams): GardenDoc {
  if (params.has('showcase')) return showcaseDoc();
  if (params.has('empty')) return emptyDoc();
  return loadDoc() ?? defaultDoc();
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && (el as HTMLInputElement).type !== 'range');
}

/** Everything selectable, in a stable order, for Tab. */
function selectables(app: HiveApp): NonNullable<Selection>[] {
  return [
    ...app.store.doc.flowers.map((f) => ({ kind: 'flower' as const, id: f.id })),
    { kind: 'hive' as const },
    ...[...app.living.colony.renderer.drawn.keys()].map((id) => ({ kind: 'bee' as const, id })),
  ];
}

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [store] = useState(() => new Store(initialDoc(new URLSearchParams(location.search))));
  const [running, setRunning] = useState<Running | null>(null);
  const fatal = useAppState(store, (s) => s.fatal);
  const uiHidden = useAppState(store, (s) => s.uiHidden);
  const tool = useAppState(store, (s) => s.tool);
  const visiting = useAppState(store, (s) => s.visiting !== null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const params = new URLSearchParams(location.search);
    let engine: Engine;
    try {
      engine = new Engine({ canvas, quality: params.get('quality') === 'low' ? 'low' : 'high' });
    } catch (error) {
      store.set({ fatal: `HIVE needs WebGL 2, which this browser could not start. (${error instanceof Error ? error.message : String(error)})` });
      return;
    }
    const app = new HiveApp(engine, store);
    const input = new PointerInput(stage, app);
    input.onMessage = (text) => store.toast(text);
    const resize = () => engine.resize(canvas.clientWidth, canvas.clientHeight);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    app.start();
    engine.start();

    const lost = (e: Event) => {
      e.preventDefault();
      engine.stop();
      store.toast('The graphics context was lost. Restoring…');
    };
    const restored = () => engine.start();
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    const visibility = () => (document.hidden ? engine.stop() : engine.start());
    document.addEventListener('visibilitychange', visibility);

    const r: Running = { engine, app, input };
    window.__hive = { ...r, store };
    setRunning(r);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      ro.disconnect();
      input.dispose();
      app.dispose();
      engine.dispose();
      delete window.__hive;
    };
  }, [store]);

  const capture = async () => {
    if (!running) return;
    try {
      const { engine } = running;
      const dpr = engine.renderer.getPixelRatio();
      const scale = Math.max(1, Math.min(2.5, 3840 / (engine.canvas.clientWidth * dpr)));
      downloadBlob(await engine.capturePNG(scale), `hive-${stamp()}.png`);
    } catch (error) {
      store.toast(error instanceof Error ? error.message : 'Could not save the image.');
    }
  };

  const record = async () => {
    if (!running || store.get().recording) return;
    store.set({ recording: true, uiHidden: true, selection: null });
    try {
      const rec = await recordCanvas(running.engine.canvas, { seconds: 12, ink: running.input.ink });
      downloadBlob(rec.blob, `hive-${stamp()}.${rec.extension}`);
      store.toast(`Saved a ${(rec.durationMs / 1000).toFixed(0)}-second ${rec.extension.toUpperCase()} clip.`);
    } catch (error) {
      store.toast(error instanceof Error ? error.message : 'Recording failed.');
    } finally {
      store.set({ recording: false, uiHidden: false });
    }
  };

  useEffect(() => {
    if (!running) return;
    const { app, input } = running;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) app.redo();
        else app.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        app.redo();
        return;
      }
      if (mod) return;
      const sel = store.get().selection;
      switch (key) {
        case 'escape':
          if (input.isDrawing) input.abort();
          else if (store.get().visiting !== null) store.set({ visiting: null });
          else if (store.get().uiHidden) store.set({ uiHidden: false });
          else store.set({ selection: null });
          break;
        case 'd':
          if (e.shiftKey && sel?.kind === 'flower') app.duplicate();
          else store.set({ tool: 'draw' });
          break;
        case 'v': store.set({ tool: 'move' }); break;
        case 'h': if (!store.get().recording) store.set({ uiHidden: !store.get().uiHidden }); break;
        case 'w': if (sel?.kind === 'flower') app.flower.water(); break;
        case 'b': if (sel?.kind === 'flower') app.flower.toggleBloom(); break;
        case 'c': if (sel?.kind === 'flower') app.flower.recolour(); break;
        case 'q': case '[': app.rotate(0.3); break;
        case 'e': case ']': app.rotate(-0.3); break;
        case '0': case '1': case '2': case '3': case '4': case '5':
          store.set({ plant: PLANT_CHOICES[Number(key)] });
          break;
        case 'delete': case 'backspace':
          if (sel?.kind === 'flower') {
            e.preventDefault();
            app.remove();
          }
          break;
        case 'tab': {
          // keyboard selection: flowers, then the hive, then any bees that are out
          const all = selectables(app);
          if (!all.length) break;
          e.preventDefault();
          const i = sel ? all.findIndex((s) => s.kind === sel.kind && (s as { id?: unknown }).id === (sel as { id?: unknown }).id) : -1;
          store.set({ selection: all[(i + (e.shiftKey ? all.length - 1 : 1) + all.length) % all.length] });
          break;
        }
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, store]);

  return (
    <div className={`stage tool-${tool}${uiHidden ? ' ui-hidden' : ''}${visiting ? ' visiting' : ''}`} ref={stageRef}>
      <canvas ref={canvasRef} aria-label="A cottage garden with a beehive. Draw on a bed or the lawn to grow a flower." role="img" />
      {running && (
        <div className="chrome">
          <SelectionOverlay app={running.app} />
          <Chrome app={running.app} onCapture={capture} onRecord={record} />
        </div>
      )}
      {fatal && (
        <div className="fatal" role="alert">
          <h2>The garden could not open</h2>
          <p>{fatal}</p>
        </div>
      )}
    </div>
  );
}
