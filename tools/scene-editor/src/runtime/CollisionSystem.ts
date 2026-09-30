import * as THREE from 'three';
import { RuntimeObject } from './SceneLoader';

export interface ColliderBody {
  id: string;
  type: 'box' | 'sphere' | 'capsule' | 'none';
  isStatic: boolean;
  isTrigger: boolean;
  centerX: number;
  centerZ: number;
  halfExtents?: { x: number; z: number }; // box (world space)
  rotation?: number;                       // box Y rotation in radians
  radius?: number;                         // sphere/capsule (world space XZ radius)
  object: RuntimeObject;
}

export class CollisionSystem {
  private bodies: ColliderBody[] = [];
  private triggerCallbacks: Map<string, (a: ColliderBody, b: ColliderBody) => void> = new Map();
  // Bodies that are phase-through (only collide with static objects)
  private phaseThroughBodies: Set<string> = new Set();

  /**
   * Register a collider body.
   * bounds = local-space bounding box size (without scale).
   */
  addBody(obj: RuntimeObject, colliderData: any, bounds: THREE.Vector3): ColliderBody | undefined {
    if (!colliderData || colliderData.type === 'none' || colliderData.type === 'mesh') return undefined;

    const scale = obj.object3D.scale;
    const sx = Math.abs(scale.x) || 1;
    const sz = Math.abs(scale.z) || 1;
    const sxz = (sx + sz) / 2;

    const offset = colliderData.offset || [0, 0, 0];
    const posX = obj.object3D.position.x + offset[0] * sx;
    const posZ = obj.object3D.position.z + offset[2] * sz;

    const body: ColliderBody = {
      id: obj.id,
      type: colliderData.type,
      isStatic: colliderData.isStatic ?? true,
      isTrigger: colliderData.isTrigger ?? false,
      centerX: posX,
      centerZ: posZ,
      object: obj,
    };

    switch (colliderData.type) {
      case 'box': {
        const hx = (colliderData.sizeOverride?.[0] ?? bounds.x / 2) * sx;
        const hz = (colliderData.sizeOverride?.[2] ?? bounds.z / 2) * sz;
        body.halfExtents = { x: hx, z: hz };
        body.rotation = obj.object3D.rotation.y;
        break;
      }
      case 'sphere': {
        body.radius = (colliderData.radiusOverride ?? Math.max(bounds.x, bounds.z) / 2) * sxz;
        break;
      }
      case 'capsule': {
        body.radius = (colliderData.radiusOverride ?? Math.max(bounds.x, bounds.z) / 2) * sxz;
        break;
      }
    }

    this.bodies.push(body);
    return body;
  }

  onTrigger(callback: (a: ColliderBody, b: ColliderBody) => void) {
    const id = `cb_${Date.now()}`;
    this.triggerCallbacks.set(id, callback);
    return id;
  }

  update() {
    // Update dynamic body positions
    for (const body of this.bodies) {
      if (!body.isStatic) {
        body.centerX = body.object.object3D.position.x;
        body.centerZ = body.object.object3D.position.z;
      }
    }

    // Trigger collisions
    for (let i = 0; i < this.bodies.length; i++) {
      for (let j = i + 1; j < this.bodies.length; j++) {
        const a = this.bodies[i];
        const b = this.bodies[j];
        if (a.isTrigger || b.isTrigger) {
          if (this.testOverlap(a, b)) {
            this.triggerCallbacks.forEach((cb) => cb(a, b));
          }
        }
      }
    }
  }

  /**
   * Resolve player movement against all colliders (pure 2D XZ).
   */
  resolveMovement(movingBody: ColliderBody, newPos: THREE.Vector3): THREE.Vector3 {
    const result = newPos.clone();
    const playerRadius = movingBody.radius ?? 5;
    const isPhaseThrough = this.phaseThroughBodies.has(movingBody.id);

    for (const other of this.bodies) {
      if (other.id === movingBody.id) continue;
      if (other.isTrigger) continue;

      // Phase-through mode: skip non-static bodies (other characters)
      if (isPhaseThrough && !other.isStatic) continue;

      // Get live position for non-static bodies
      let ox = other.centerX;
      let oz = other.centerZ;
      if (!other.isStatic) {
        ox = other.object.object3D.position.x;
        oz = other.object.object3D.position.z;
      }

      if (other.type === 'box' && other.halfExtents) {
        this.pushCircleOutOfOBB(result, playerRadius, ox, oz, other.halfExtents.x, other.halfExtents.z, other.rotation || 0);
      } else {
        const otherR = other.radius ?? 10;
        this.pushCircleOutOfCircle(result, playerRadius, ox, oz, otherR);
      }
    }

    return result;
  }

  /** Set a body to phase-through mode (only collides with static objects) */
  setPhaseThrough(id: string, enabled: boolean) {
    if (enabled) {
      this.phaseThroughBodies.add(id);
    } else {
      this.phaseThroughBodies.delete(id);
    }
  }

  isPhaseThrough(id: string): boolean {
    return this.phaseThroughBodies.has(id);
  }

  removeBody(body: ColliderBody) {
    const idx = this.bodies.indexOf(body);
    if (idx >= 0) this.bodies.splice(idx, 1);
  }

  removeBodyById(id: string) {
    this.bodies = this.bodies.filter(b => b.id !== id);
  }

  removeTriggerCallback(callbackId: string) {
    this.triggerCallbacks.delete(callbackId);
  }

  getBodyById(id: string): ColliderBody | undefined {
    return this.bodies.find((b) => b.id === id);
  }

  
  // --- Debug Visualization ---
  private debugScene: THREE.Scene | null = null;
  private debugHelpers: Map<string, THREE.Object3D> = new Map();
  private debugVisible = false;

  enableDebug(scene: THREE.Scene) {
    this.debugScene = scene;
  }

  buildDebugVisuals() {
    if (!this.debugScene) return;
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.6, depthTest: false });

    for (const body of this.bodies) {
      if (this.debugHelpers.has(body.id)) continue;
      let helper: THREE.Object3D | null = null;

      switch (body.type) {
        case 'box': {
          if (!body.halfExtents) break;
          const geo = new THREE.EdgesGeometry(
            new THREE.BoxGeometry(body.halfExtents.x * 2, 100, body.halfExtents.z * 2)
          );
          helper = new THREE.LineSegments(geo, lineMat.clone());
          helper.position.set(body.centerX, 50, body.centerZ);
          if (body.rotation) helper.rotation.y = body.rotation;
          break;
        }
        case 'sphere':
        case 'capsule': {
          if (!body.radius) break;
          const segments = 32;
          const points: THREE.Vector3[] = [];
          for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            points.push(new THREE.Vector3(
              Math.cos(angle) * body.radius,
              0,
              Math.sin(angle) * body.radius
            ));
          }
          const geo = new THREE.BufferGeometry().setFromPoints(points);
          helper = new THREE.Line(geo, lineMat.clone());
          helper.position.set(body.centerX, 5, body.centerZ);
          break;
        }
      }

      if (helper) {
        helper.visible = this.debugVisible;
        helper.renderOrder = 998;
        this.debugScene.add(helper);
        this.debugHelpers.set(body.id, helper);
      }
    }
  }

  setDebugVisible(visible: boolean) {
    this.debugVisible = visible;
    for (const [, helper] of this.debugHelpers) {
      helper.visible = visible;
    }
  }

  /** Sync debug helper positions to current body positions (call each frame when debug is on) */
  updateDebugVisuals() {
    if (!this.debugVisible) return;

    // Build any new helpers for bodies added since last build
    this.buildDebugVisuals();

    // Update positions
    for (const body of this.bodies) {
      const helper = this.debugHelpers.get(body.id);
      if (!helper) continue;

      // Use live position for non-static bodies
      const x = body.isStatic ? body.centerX : body.object.object3D.position.x;
      const z = body.isStatic ? body.centerZ : body.object.object3D.position.z;
      helper.position.x = x;
      helper.position.z = z;
    }

    // Remove helpers for bodies that no longer exist
    for (const [id, helper] of this.debugHelpers) {
      if (!this.bodies.find(b => b.id === id)) {
        if (this.debugScene) this.debugScene.remove(helper);
        this.debugHelpers.delete(id);
      }
    }
  }

  isDebugVisible(): boolean {
    return this.debugVisible;
  }

  // --- Private helpers ---

  private pushCircleOutOfOBB(pos: THREE.Vector3, radius: number, boxX: number, boxZ: number, hx: number, hz: number, rot: number) {
    // Transform player into box's rotated local space
    const c = Math.cos(-rot);
    const s = Math.sin(-rot);
    const dx = pos.x - boxX;
    const dz = pos.z - boxZ;
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;

    // Closest point on AABB
    const cx = Math.max(-hx, Math.min(lx, hx));
    const cz = Math.max(-hz, Math.min(lz, hz));

    const diffX = lx - cx;
    const diffZ = lz - cz;
    const distSq = diffX * diffX + diffZ * diffZ;

    if (distSq >= radius * radius) return; // No collision

    const dist = Math.sqrt(distSq);
    let pushLX: number, pushLZ: number;

    if (dist > 0.001) {
      // Player center is outside box but within radius
      const pen = radius - dist;
      pushLX = (diffX / dist) * pen;
      pushLZ = (diffZ / dist) * pen;
    } else {
      // Player center is inside box — push to nearest edge
      const toNegX = lx + hx;
      const toPosX = hx - lx;
      const toNegZ = lz + hz;
      const toPosZ = hz - lz;
      const min = Math.min(toNegX, toPosX, toNegZ, toPosZ);

      pushLX = 0;
      pushLZ = 0;
      if (min === toNegX) pushLX = -(toNegX + radius);
      else if (min === toPosX) pushLX = toPosX + radius;
      else if (min === toNegZ) pushLZ = -(toNegZ + radius);
      else pushLZ = toPosZ + radius;
    }

    // Rotate push back to world
    const cw = Math.cos(rot);
    const sw = Math.sin(rot);
    pos.x += pushLX * cw - pushLZ * sw;
    pos.z += pushLX * sw + pushLZ * cw;
  }

  private pushCircleOutOfCircle(pos: THREE.Vector3, radius: number, otherX: number, otherZ: number, otherR: number) {
    const dx = pos.x - otherX;
    const dz = pos.z - otherZ;
    const distSq = dx * dx + dz * dz;
    const minDist = radius + otherR;

    if (distSq >= minDist * minDist || distSq < 0.0001) return;

    const dist = Math.sqrt(distSq);
    const pen = minDist - dist;
    pos.x += (dx / dist) * pen;
    pos.z += (dz / dist) * pen;
  }

  private testOverlap(a: ColliderBody, b: ColliderBody): boolean {
    const ra = this.getRadius(a);
    const rb = this.getRadius(b);
    const dx = a.centerX - b.centerX;
    const dz = a.centerZ - b.centerZ;
    return (dx * dx + dz * dz) < (ra + rb) * (ra + rb);
  }

  private getRadius(body: ColliderBody): number {
    if (body.radius) return body.radius;
    if (body.halfExtents) return Math.max(body.halfExtents.x, body.halfExtents.z);
    return 10;
  }
}
