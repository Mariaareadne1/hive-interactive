import { useEffect, useRef, useState } from 'react';
import type { HiveApp } from '../HiveApp';
import { useAppState } from '../../state/store';
import { canRedo, canUndo } from '../../state/history';
import { showcaseDoc } from '../../state/document';
import { exportDocFile, importDocFile } from '../../state/persistence';
import { KINDS, PLANT_CHOICES, type PlantChoice } from '../../flowers/kinds';
import { Icon } from './icons';

interface ChromeProps {
  app: HiveApp;
  onCapture: () => void;
  onRecord: () => void;
}

const SHORTCUTS: [string, string][] = [
  ['Draw · Move', 'D · V'],
  ['Plant: Auto · Sunflower · Rose · Daisy · Lavender · Poppy', '0 – 5'],
  ['Water · Bloom/Close · Recolour', 'W · B · C'],
  ['Turn', 'Q · E  or scroll'],
  ['Duplicate', 'Shift D'],
  ['Remove', 'Delete'],
  ['Select next', 'Tab'],
  ['Undo · Redo', '⌘Z · ⇧⌘Z'],
  ['Deselect / cancel', 'Esc'],
  ['Hide interface', 'H'],
];

const plantLabel = (c: PlantChoice) => (c === 'auto' ? 'Auto' : KINDS[c].label);

export function Chrome({ app, onCapture, onRecord }: ChromeProps) {
  const { store } = app;
  const tool = useAppState(store, (s) => s.tool);
  const plant = useAppState(store, (s) => s.plant);
  const history = useAppState(store, (s) => s.history);
  const hasDrawn = useAppState(store, (s) => s.hasDrawn);
  const flowerCount = useAppState(store, (s) => s.history.present.flowers.length);
  const toast = useAppState(store, (s) => s.toast);
  const suggestion = useAppState(store, (s) => s.suggestion);
  const loading = useAppState(store, (s) => s.loading);
  const recording = useAppState(store, (s) => s.recording);
  const golden = useAppState(store, (s) => s.golden);
  const raining = useAppState(store, (s) => s.raining);
  const selection = useAppState(store, (s) => s.selection);
  const [panel, setPanel] = useState<'none' | 'help' | 'menu'>('none');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (panel === 'none') return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.panel, .top-actions')) setPanel('none');
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [panel]);

  const quiet = hasDrawn || selection !== null || flowerCount > 3;
  const hint = quiet ? null : tool === 'draw' ? 'Draw a flower.' : null;

  const runMenu = (action: string) => {
    setPanel('none');
    if (action === 'reset') app.reset();
    if (action === 'showcase') app.loadDoc(showcaseDoc());
    if (action === 'export') exportDocFile(store.doc);
    if (action === 'import') fileRef.current?.click();
    if (action === 'hide') store.set({ uiHidden: true });
    if (action === 'record') onRecord();
  };

  return (
    <>
      <header className="wordmark">
        <h1>HIVE</h1>
        <p>a place to grow a garden</p>
      </header>

      <div className="top-actions">
        <button className="icon-btn ghost" aria-label="Help" aria-expanded={panel === 'help'} title="Help" onClick={() => setPanel(panel === 'help' ? 'none' : 'help')}>
          <Icon name="help" />
        </button>
        <button className="icon-btn ghost" aria-label="Garden menu" aria-expanded={panel === 'menu'} title="More" onClick={() => setPanel(panel === 'menu' ? 'none' : 'menu')}>
          <Icon name="menu" />
        </button>
      </div>

      {panel === 'help' && (
        <section className="panel help" aria-label="How to play">
          <p className="lede">Draw on a bed or the lawn and a flower grows along your line. A tall line makes a sunflower, a spiral a rose, a star a daisy, a string of little loops lavender, one round loop a poppy. Bees will find it.</p>
          <dl>
            {SHORTCUTS.map(([what, key]) => (
              <div key={what}><dt>{what}</dt><dd>{key}</dd></div>
            ))}
          </dl>
        </section>
      )}
      {panel === 'menu' && (
        <section className="panel menu" aria-label="Garden menu">
          <button onClick={() => runMenu('showcase')}>Showcase arrangement</button>
          <button onClick={() => runMenu('record')} disabled={recording}>Record 12-second clip</button>
          <button onClick={() => runMenu('hide')}>Hide interface <kbd>H</kbd></button>
          <hr />
          <button onClick={() => runMenu('export')}>Export garden…</button>
          <button onClick={() => runMenu('import')}>Import garden…</button>
          <hr />
          <button className="danger" onClick={() => runMenu('reset')} disabled={flowerCount === 0}>Clear the garden</button>
        </section>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            app.loadDoc(await importDocFile(file));
            store.toast('Garden imported.');
          } catch (err) {
            store.toast(err instanceof Error ? err.message : 'Could not import that file.');
          }
        }}
      />

      {hint && <p className="hint" aria-live="polite">{hint}</p>}
      {loading && <p className="loading" aria-live="polite">Unfurling petals…</p>}

      <nav className="toolbar" aria-label="Tools">
        <button className={tool === 'draw' ? 'tool on' : 'tool'} aria-pressed={tool === 'draw'} title="Draw (D)" onClick={() => store.set({ tool: 'draw' })}>
          <Icon name="draw" /><span>Draw</span>
        </button>
        <button className={tool === 'move' ? 'tool on' : 'tool'} aria-pressed={tool === 'move'} title="Move (V)" onClick={() => store.set({ tool: 'move' })}>
          <Icon name="move" /><span>Move</span>
        </button>
        <span className="sep" />
        <div className="segmented" role="radiogroup" aria-label="Plant">
          <span className="seg-label">Plant</span>
          {PLANT_CHOICES.map((c, i) => (
            <button key={c} role="radio" aria-checked={plant === c} className={plant === c ? 'seg on' : 'seg'} title={`${plantLabel(c)} (${i})`} onClick={() => store.set({ plant: c })}>
              {plantLabel(c)}
            </button>
          ))}
        </div>
        <span className="sep" />
        <button className="icon-btn" aria-label="Breeze" title="Breeze" onClick={() => app.bees.breeze()}><Icon name="wind" /></button>
        <button className={raining ? 'icon-btn on' : 'icon-btn'} aria-label="Rain shower" title="Rain shower" onClick={() => app.bees.rain()} disabled={raining}><Icon name="rain" /></button>
        <label className="golden" title="Day ↔ golden hour">
          <Icon name="sun" />
          <input type="range" min={0} max={1} step={0.01} value={golden} aria-label="Time of day: noon to golden hour" onChange={(e) => app.bees.setGolden(Number(e.target.value))} />
        </label>
        <span className="sep" />
        <button className="icon-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo(history)} onClick={() => app.undo()}><Icon name="undo" /></button>
        <button className="icon-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo(history)} onClick={() => app.redo()}><Icon name="redo" /></button>
        <span className="sep" />
        <button className="icon-btn" aria-label="Save image" title="Save image" onClick={onCapture}><Icon name="camera" /></button>
      </nav>

      {suggestion && (
        <button key={suggestion.id} className="suggest" onClick={() => app.acceptSuggestion()}>
          Make it a <b>{KINDS[suggestion.alternative].label.toLowerCase()}</b> instead
        </button>
      )}
      {recording && <p className="rec" aria-live="polite"><i />Recording</p>}
      {toast && <Toast key={toast.id} text={toast.text} />}
    </>
  );
}

function Toast({ text }: { text: string }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGone(true), 3200);
    return () => window.clearTimeout(t);
  }, []);
  if (gone) return null;
  return <p className="toast" role="status">{text}</p>;
}
