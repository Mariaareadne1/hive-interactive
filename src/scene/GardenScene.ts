import type { Engine } from '../engine/Engine';
import { createTerrain } from './terrain';
import { createDetails } from './details';
import { createProps, type Props } from './props';
import { Hive } from './hive';
import { HIVE_HOME } from './garden';

/** The garden's fixed furniture: painted ground, little details, hedge and props, and the hive. */
export class GardenScene {
  readonly props: Props;
  readonly hive: Hive;

  constructor(engine: Engine) {
    const { world, scene } = engine;
    scene.add(createTerrain(world));
    scene.add(createDetails(world, engine.quality === 'high' ? 1 : 0.5));
    this.props = createProps(world);
    scene.add(this.props.group);
    this.hive = new Hive(world);
    this.hive.place(HIVE_HOME.x, HIVE_HOME.z, 0.55);
    world.uHive.value.set(HIVE_HOME.x, HIVE_HOME.z);
    scene.add(this.hive.group);
    engine.onFrame((dt, t) => this.props.update(dt, t));
  }
}
