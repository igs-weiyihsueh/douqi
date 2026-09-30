import { Component } from './Component';

let nextId = 0;

/** Entity: a lightweight container of components */
export class Entity {
  readonly id = nextId++;
  private components = new Map<string, Component>();

  addComponent<T extends Component>(component: T): T {
    this.components.set(component.constructor.name, component);
    return component;
  }

  getComponent<T extends Component>(type: new (...args: unknown[]) => T): T | undefined {
    return this.components.get(type.name) as T | undefined;
  }

  removeComponent<T extends Component>(type: new (...args: unknown[]) => T) {
    this.components.delete(type.name);
  }
}
