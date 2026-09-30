import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

/**
 * VFX Position/Rotation Gizmo
 * Reuses the editor's existing TransformControls — attaches to a helper object
 * when a VFX marker is selected, returns control when deselected.
 * No second TransformControls instance = no conflicts.
 */

export class VFXPositionGizmo {
  private scene: THREE.Scene;
  private helper: THREE.Group;
  private helperSphere: THREE.Mesh;
  private helperArrow: THREE.Mesh;
  private transformControls: TransformControls;
  private parentObject: THREE.Object3D | null = null;
  private active = false;

  onChange: ((offset: [number, number, number], rotation: [number, number, number]) => void) | null = null;

  private changeHandler = () => {
    if (!this.active || !this.parentObject) return;
    // Convert helper world position to parent-local offset
    const invParent = this.parentObject.matrixWorld.clone().invert();
    const localPos = this.helper.position.clone().applyMatrix4(invParent);

    // Get relative rotation: helper rotation minus parent rotation
    const parentQuat = new THREE.Quaternion().setFromRotationMatrix(this.parentObject.matrixWorld);
    const helperQuat = this.helper.quaternion.clone();
    const relativeQuat = parentQuat.clone().invert().multiply(helperQuat);
    const relativeEuler = new THREE.Euler().setFromQuaternion(relativeQuat);

    this.onChange?.(
      [localPos.x, localPos.y, localPos.z],
      [
        THREE.MathUtils.radToDeg(relativeEuler.x),
        THREE.MathUtils.radToDeg(relativeEuler.y),
        THREE.MathUtils.radToDeg(relativeEuler.z),
      ]
    );
  };

  constructor(scene: THREE.Scene, transformControls: TransformControls) {
    this.scene = scene;
    this.transformControls = transformControls;

    // Create helper group (visible marker)
    this.helper = new THREE.Group();
    this.helper.visible = false;
    this.scene.add(this.helper);

    // Cyan sphere
    const sphereGeo = new THREE.SphereGeometry(3, 12, 12);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.85, depthTest: false });
    this.helperSphere = new THREE.Mesh(sphereGeo, sphereMat);
    this.helperSphere.renderOrder = 999;
    this.helper.add(this.helperSphere);

    // Yellow arrow showing direction (points +Z local)
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false });
    const arrowGeo = new THREE.ConeGeometry(1.5, 8, 8);
    this.helperArrow = new THREE.Mesh(arrowGeo, arrowMat);
    this.helperArrow.position.set(0, 0, 10);
    this.helperArrow.rotation.x = Math.PI / 2;
    this.helperArrow.renderOrder = 999;
    this.helper.add(this.helperArrow);
  }

  show(parentObj: THREE.Object3D, offset: [number, number, number], rotation?: [number, number, number]) {
    this.parentObject = parentObj;
    this.active = true;
    this.helper.visible = true;

    // Position helper in world space from local offset
    const localPos = new THREE.Vector3(offset[0], offset[1], offset[2]);
    const worldPos = localPos.applyMatrix4(parentObj.matrixWorld);
    this.helper.position.copy(worldPos);

    // Rotation
    const parentQuat = new THREE.Quaternion().setFromRotationMatrix(parentObj.matrixWorld);
    if (rotation) {
      const relEuler = new THREE.Euler(
        THREE.MathUtils.degToRad(rotation[0]),
        THREE.MathUtils.degToRad(rotation[1]),
        THREE.MathUtils.degToRad(rotation[2]),
      );
      const relQuat = new THREE.Quaternion().setFromEuler(relEuler);
      this.helper.quaternion.copy(parentQuat.multiply(relQuat));
    } else {
      this.helper.quaternion.copy(parentQuat);
    }

    // Attach editor's TransformControls to our helper
    this.transformControls.attach(this.helper);
    this.transformControls.addEventListener('objectChange', this.changeHandler);
  }

  hide() {
    if (!this.active) return;
    this.active = false;
    this.helper.visible = false;
    this.transformControls.removeEventListener('objectChange', this.changeHandler);
    this.transformControls.detach();
    this.parentObject = null;
  }

  isVisible(): boolean { return this.active; }

  setMode(mode: 'translate' | 'rotate') {
    this.transformControls.setMode(mode);
    // Ensure scale mode is never set on VFX gizmo (scale is meaningless for particle effects)
    if (this.transformControls.getMode() === 'scale') {
      this.transformControls.setMode('translate');
    }
  }

  getMode(): string {
    return this.transformControls.getMode();
  }

  isActive(): boolean {
    return this.active;
  }

  update() {
    // Nothing needed — TransformControls handles everything
  }

  dispose() {
    this.hide();
    this.scene.remove(this.helper);
    this.helper.traverse((child: any) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
}
