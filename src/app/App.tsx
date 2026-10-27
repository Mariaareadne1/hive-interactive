import { useEffect, useRef } from 'react';
import { Engine } from '../engine/Engine';
import { GardenScene } from '../scene/GardenScene';
import { FlowerManager } from '../flowers/FlowerManager';
import { showcaseDoc } from '../state/document';
import { ColonyDriver } from '../bees/ColonyDriver';

declare global {
  interface Window {
    __hive?: { engine: Engine; garden: GardenScene; flowers: FlowerManager; colony: ColonyDriver };
  }
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine({ canvas, quality: 'high' });
    const garden = new GardenScene(engine);
    const flowers = new FlowerManager(engine.world);
    engine.scene.add(flowers.group);
    flowers.preload();
    flowers.sync(showcaseDoc());
    engine.onFrame((dt, t) => flowers.update(dt, t));
    const colony = new ColonyDriver(engine.world, flowers, garden.hive);
    engine.scene.add(colony.renderer.group);
    colony.load(() => {});
    engine.onFrame((dt, t) => colony.update(dt, t));
    const resize = () => engine.resize(canvas.clientWidth, canvas.clientHeight);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    engine.start();
    window.__hive = { engine, garden, flowers, colony };
    return () => {
      ro.disconnect();
      engine.dispose();
    };
  }, []);
  return (
    <div className="stage">
      <canvas ref={canvasRef} />
    </div>
  );
}
