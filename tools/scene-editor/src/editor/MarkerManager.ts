import * as THREE from 'three';

const ZOMBIE_COLORS: Record<string, number> = {
  zombie_small: 0x4ade80,
  zombie_big: 0xfb923c,
  zombie_bomb: 0xf87171,
  zombie_bouncing: 0xfbbf24,
  zombie_golden: 0xfcd34d,
  zombie_black: 0xa78bfa,
  zombie_boss: 0xdc2626,
};
const DEFAULT_MARKER_COLOR = 0x94a3b8;
const ITEM_ZONE_COLOR = 0x22d3ee;
const BOUNDARY_COLOR = 0xffffff;

interface MarkerUpdateOptions {
  zombieType?: string;
  itemRadius?: number;
  hasModel?: boolean;
  boundaryRadius?: number;
}

export class MarkerManager {
  private scene: THREE.Scene;
  private markers: Map<string, THREE.Object3D> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(
    id: string,
    parentObj: THREE.Object3D | null,
    tag: string | undefined,
    options: MarkerUpdateOptions = {}
  ) {
    // Remove existing marker
    this.remove(id);

    if (!tag || tag === 'none' || !parentObj) return;

    if (tag === 'spawnPoint' && !options.hasModel) {
      this.createSpawnMarker(id, parentObj, options.zombieType);
    } else if (tag === 'itemZone') {
      this.createItemZoneMarker(id, parentObj, options.itemRadius ?? 50);
    } else if (tag === 'boundary') {
      this.createBoundaryMarker(id, parentObj, options.boundaryRadius ?? 300);
    }
  }

  remove(id: string) {
    const existing = this.markers.get(id);
    if (existing) {
      existing.parent?.remove(existing);
      existing.traverse((child) => {
        if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
        if ((child as THREE.Mesh).material) {
          const mat = (child as THREE.Mesh).material;
          if (Array.isArray(mat)) mat.forEach(m => m.dispose());
          else mat.dispose();
        }
      });
      this.markers.delete(id);
    }
  }

  clear() {
    for (const id of this.markers.keys()) {
      this.remove(id);
    }
  }

  private createSpawnMarker(id: string, parent: THREE.Object3D, zombieType?: string) {
    const color = zombieType ? (ZOMBIE_COLORS[zombieType] ?? DEFAULT_MARKER_COLOR) : DEFAULT_MARKER_COLOR;
    const group = new THREE.Group();
    group.userData.isMarker = true;
    group.userData.__editorHelper = true;
    group.userData.__noPick = true;

    // Disc
    const discGeo = new THREE.CylinderGeometry(18, 18, 3, 24);
    const discMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 });
    const disc = new THREE.Mesh(discGeo, discMat);
    group.add(disc);

    // Arrow (direction indicator)
    const arrowGeo = new THREE.ConeGeometry(6, 16, 8);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.z = 14;
    arrow.position.y = 3;
    group.add(arrow);

    parent.add(group);
    this.markers.set(id, group);
  }

  private createItemZoneMarker(id: string, parent: THREE.Object3D, radius: number) {
    const group = new THREE.Group();
    group.userData.isMarker = true;
    group.userData.__editorHelper = true;
    group.userData.__noPick = true;

    // Solid fill
    const cylGeo = new THREE.CylinderGeometry(radius, radius, 5, 32);
    const cylMat = new THREE.MeshBasicMaterial({
      color: ITEM_ZONE_COLOR,
      transparent: true,
      opacity: 0.2,
    });
    const cyl = new THREE.Mesh(cylGeo, cylMat);
    group.add(cyl);

    // Wireframe
    const wireGeo = new THREE.CylinderGeometry(radius, radius, 5, 32);
    const wireMat = new THREE.MeshBasicMaterial({
      color: ITEM_ZONE_COLOR,
      transparent: true,
      opacity: 0.6,
      wireframe: true,
    });
    const wire = new THREE.Mesh(wireGeo, wireMat);
    group.add(wire);

    parent.add(group);
    this.markers.set(id, group);
  }

  private createBoundaryMarker(id: string, parent: THREE.Object3D, radius: number) {
    const group = new THREE.Group();
    group.userData.isMarker = true;
    group.userData.__editorHelper = true;
    group.userData.__noPick = true;

    // Outer ring
    const points: THREE.Vector3[] = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineDashedMaterial({
      color: BOUNDARY_COLOR,
      transparent: true,
      opacity: 0.5,
      dashSize: 10,
      gapSize: 5,
    });
    const line = new THREE.Line(lineGeo, lineMat);
    line.computeLineDistances();
    group.add(line);

    parent.add(group);
    this.markers.set(id, group);
  }
}
