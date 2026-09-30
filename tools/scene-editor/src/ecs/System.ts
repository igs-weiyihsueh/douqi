import { Entity } from './Entity';

/** Base class for ECS systems */
export abstract class System {
  abstract update(entities: Entity[], delta: number): void;
}
