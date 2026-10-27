import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { HiveApp } from '../HiveApp';
import { useAppState, type Selection } from '../../state/store';
import { findFlower } from '../../state/document';
import { KINDS } from '../../flowers/kinds';
import { BEE_SIZE } from '../../bees/BeeRenderer';
import { Icon } from './icons';

/**
 * A thin blue box around what is selected with a world-unit readout (size
 * and distance), plus its own small contextual bar. Positions are written
 * straight to the DOM every frame — no React renders.
 */

/** The garden is a miniature: labels read in garden centimetres (1 world m = 40 cm). */
const CM_PER_M = 40;

function boundsOf(app: HiveApp, sel: NonNullable<Selection>, box: THREE.Box3): boolean {
  if (sel.kind === 'flower') {
    const f = app.living.flowers.get(sel.id);
    if (!f) return false;
    f.bounds(box);
    return true;
  }
  if (sel.kind === 'hive') {
    app.living.garden.hive.bounds(box);
    return true;
  }
  const p = app.living.colony.renderer.drawn.get(sel.id);
  if (!p) return false;
  const r = BEE_SIZE * 0.6;
  box.set(p.clone().addScalar(-r), p.clone().addScalar(r));
  return true;
}

export function SelectionOverlay({ app }: { app: HiveApp }) {
  const selection = useAppState(app.store, (s) => s.selection);
  const boxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selection) return;
    const box3 = new THREE.Box3();
    const corner = new THREE.Vector3();
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    const update = () => {
      const box = boxRef.current;
      const bar = barRef.current;
      if (!box || !bar || !boundsOf(app, selection, box3)) return;
      const cam = app.engine.camera;
      const rect = app.rect;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? box3.max.x : box3.min.x, i & 2 ? box3.max.y : box3.min.y, i & 4 ? box3.max.z : box3.min.z).project(cam);
        const sx = ((corner.x + 1) / 2) * rect.width;
        const sy = ((1 - corner.y) / 2) * rect.height;
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
      }
      const pad = 6;
      box.style.transform = `translate(${(minX - pad).toFixed(1)}px, ${(minY - pad).toFixed(1)}px)`;
      box.style.width = `${(maxX - minX + pad * 2).toFixed(1)}px`;
      box.style.height = `${(maxY - minY + pad * 2).toFixed(1)}px`;
      box3.getSize(size);
      box3.getCenter(centre);
      const dist = cam.position.distanceTo(centre);
      if (labelRef.current) {
        const w = Math.max(size.x, size.z) * CM_PER_M, h = size.y * CM_PER_M;
        labelRef.current.textContent = `${w.toFixed(0)} × ${h.toFixed(0)} cm  ·  ${(dist * CM_PER_M / 100).toFixed(1)} m away`;
      }
      // the bar sits under the box, or above it near the bottom edge
      const barW = bar.offsetWidth;
      const barH = bar.offsetHeight;
      const cx = Math.min(rect.width - barW / 2 - 12, Math.max(barW / 2 + 12, (minX + maxX) / 2));
      const below = maxY + pad + 34 + barH < rect.height - 84;
      const y = below ? maxY + pad + 30 : minY - pad - barH - 12;
      bar.style.transform = `translate(${(cx - barW / 2).toFixed(1)}px, ${Math.max(8, y).toFixed(1)}px)`;
    };
    update();
    return app.engine.onBeforeRender(update);
  }, [app, selection]);

  if (!selection) return null;
  return (
    <>
      <div className="select-box" ref={boxRef} aria-hidden="true">
        <i className="h tl" /><i className="h tr" /><i className="h bl" /><i className="h br" />
        <span className="select-label" ref={labelRef} />
      </div>
      <div className="action-bar" ref={barRef} role="toolbar" aria-label={`Selected ${selection.kind}`} data-kind={selection.kind}>
        {selection.kind === 'flower' && <FlowerBar app={app} id={selection.id} />}
        {selection.kind === 'bee' && <BeeBar app={app} id={selection.id} />}
        {selection.kind === 'hive' && <HiveBar app={app} />}
      </div>
    </>
  );
}

function Chip({ label, title, on, onClick, icon }: { label: string; title?: string; on?: boolean; onClick: () => void; icon?: Parameters<typeof Icon>[0]['name'] }) {
  return (
    <button className={on ? 'chip on' : 'chip'} title={title ?? label} aria-pressed={on} onClick={onClick}>
      {icon && <Icon name={icon} />}
      <span>{label}</span>
    </button>
  );
}

function FlowerBar({ app, id }: { app: HiveApp; id: string }) {
  const record = useAppState(app.store, (s) => findFlower(s.history.present, id));
  if (!record) return null;
  const a = app.flower;
  return (
    <>
      <span className="bar-title">{KINDS[record.kind].label}</span>
      <Chip label="Water" icon="water" title="Water (W)" onClick={() => a.water()} />
      <Chip label={record.open ? 'Close' : 'Bloom'} icon="bloom" title="Bloom / Close (B)" onClick={() => a.toggleBloom()} />
      <Chip label="Sway" icon="wind" onClick={() => a.sway()} />
      <Chip label="Seed" icon="seed" onClick={() => a.seed()} />
      <Chip label="Recolour" icon="palette" title="Recolour (C)" onClick={() => a.recolour()} />
      <Chip label="Call a bee" icon="bee" onClick={() => a.callBee()} />
      <span className="sep" />
      <button className="icon-btn" title="Turn left (Q)" aria-label="Turn left" onClick={() => app.rotate(0.4)}><Icon name="rotateL" /></button>
      <button className="icon-btn" title="Turn right (E)" aria-label="Turn right" onClick={() => app.rotate(-0.4)}><Icon name="rotateR" /></button>
      <span className="sep" />
      <button className="icon-btn" title="Duplicate (Shift+D)" aria-label="Duplicate flower" onClick={() => app.duplicate()}><Icon name="duplicate" /></button>
      <button className="icon-btn" title="Remove (Delete)" aria-label="Remove flower" onClick={() => app.remove()}><Icon name="trash" /></button>
    </>
  );
}

function BeeBar({ app, id }: { app: HiveApp; id: number }) {
  const following = useAppState(app.store, (s) => s.following === id);
  const visiting = useAppState(app.store, (s) => s.visiting === id);
  const b = app.bees;
  return (
    <>
      <span className="bar-title">Bee</span>
      <Chip label="Follow" on={following} onClick={() => b.follow(id)} />
      <Chip label="Visit…" on={visiting} onClick={() => b.beginVisit(id)} />
      <Chip label="Dance" onClick={() => b.dance(id)} />
      <Chip label="Rest" onClick={() => b.rest(id)} />
      <Chip label="Home" onClick={() => b.home(id)} />
    </>
  );
}

function HiveBar({ app }: { app: HiveApp }) {
  const honey = useAppState(app.store, (s) => s.honey);
  // re-render on store changes so Wake/Sleep reflects the colony
  useAppState(app.store, (s) => s.toast);
  const awake = app.living.colony.colony.awake;
  const b = app.bees;
  return (
    <>
      <span className="bar-title">Hive</span>
      <Chip label={awake ? 'Sleep' : 'Wake'} onClick={() => b.toggleAwake()} />
      <Chip label="Swarm" onClick={() => b.swarm()} />
      <Chip label="Calm" title="A puff of smoke: the bees drift lazily for 10 s" onClick={() => b.calm()} />
      <span className="sep" />
      <HoneyJar level={honey} />
      <span className="sep" />
      <button className="icon-btn" title="Turn left (Q)" aria-label="Turn hive left" onClick={() => app.rotate(0.4)}><Icon name="rotateL" /></button>
      <button className="icon-btn" title="Turn right (E)" aria-label="Turn hive right" onClick={() => app.rotate(-0.4)}><Icon name="rotateR" /></button>
    </>
  );
}

/** A little jar that fills with the honey collected so far. */
export function HoneyJar({ level }: { level: number }) {
  const fill = Math.min(1, level / 1.5);
  const grams = Math.round(level * 400);
  return (
    <span className="honey" title="Honey collected" aria-label={`Honey: ${grams} grams`}>
      <svg viewBox="0 0 20 22" width="18" height="20" aria-hidden="true">
        <defs>
          <clipPath id="jar"><path d="M4.5 7h11v11a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2z" /></clipPath>
        </defs>
        <rect x="4" y={20 - 13 * fill} width="12" height={13 * fill} fill="#e3a234" clipPath="url(#jar)" style={{ transition: 'y 0.6s, height 0.6s' }} />
        <path d="M4.5 7h11v11a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2zM5.5 4h9v3h-9z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      <b>{grams} g</b>
    </span>
  );
}
