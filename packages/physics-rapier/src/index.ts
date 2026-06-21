import RAPIER from "@dimforge/rapier3d-compat";
import {
  quatFromEuler,
  type PhysicsAdapter, type SceneDocument, type Quat, type Vec3,
} from "@vsim/core";

/**
 * Deterministic physics via Rapier (Rust/WASM). Stepped at a fixed sub-timestep by the
 * runtime, so the same scene + seed produces the same simulation every run — the property
 * that lets "preview == server render == N variants" hold for dynamic scenes.
 */
export class RapierPhysics implements PhysicsAdapter {
  private world?: RAPIER.World;
  private bodies = new Map<string, RAPIER.RigidBody>();
  private doc?: SceneDocument;

  async init(doc: SceneDocument): Promise<void> {
    await RAPIER.init();
    this.doc = doc;
    this.build();
  }

  private build(): void {
    const doc = this.doc!;
    const g = doc.physics?.gravity ?? [0, -9.81, 0];
    this.world = new RAPIER.World({ x: g[0], y: g[1], z: g[2] });
    this.bodies.clear();
    const nodeMap = new Map(doc.nodes.map((n) => [n.id, n]));

    for (const b of doc.physics?.bodies ?? []) {
      const node = nodeMap.get(b.nodeId);
      if (!node) continue;
      const p = node.position;
      const q = quatFromEuler(node.rotation[0], node.rotation[1], node.rotation[2]);

      const desc =
        b.type === "fixed"
          ? RAPIER.RigidBodyDesc.fixed()
          : b.type === "kinematic"
            ? RAPIER.RigidBodyDesc.kinematicPositionBased()
            : RAPIER.RigidBodyDesc.dynamic();
      desc.setTranslation(p[0], p[1], p[2]).setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
      if (b.linvel) desc.setLinvel(b.linvel[0], b.linvel[1], b.linvel[2]);
      if (b.angvel) desc.setAngvel({ x: b.angvel[0], y: b.angvel[1], z: b.angvel[2] });
      const rb = this.world.createRigidBody(desc);

      let cdesc: RAPIER.ColliderDesc;
      switch (b.collider.shape) {
        case "box": {
          const he = b.collider.halfExtents;
          cdesc = RAPIER.ColliderDesc.cuboid(he[0], he[1], he[2]);
          break;
        }
        case "sphere":
          cdesc = RAPIER.ColliderDesc.ball(b.collider.radius);
          break;
        case "plane":
          cdesc = RAPIER.ColliderDesc.cuboid(1000, 0.05, 1000); // thin slab as ground
          break;
      }
      cdesc.setRestitution(b.restitution).setFriction(b.friction);
      if (b.mass) cdesc.setMass(b.mass);
      this.world.createCollider(cdesc, rb);
      this.bodies.set(b.nodeId, rb);
    }
  }

  step(dt: number): void {
    if (!this.world) return;
    this.world.timestep = dt;
    this.world.step();
  }

  getTransforms(): Map<string, { position: Vec3; quaternion: Quat }> {
    const out = new Map<string, { position: Vec3; quaternion: Quat }>();
    for (const [id, rb] of this.bodies) {
      const t = rb.translation();
      const r = rb.rotation();
      out.set(id, { position: [t.x, t.y, t.z], quaternion: [r.x, r.y, r.z, r.w] });
    }
    return out;
  }

  reset(): void {
    this.build(); // rebuild the world from the document's initial state
  }

  dispose(): void {
    this.world?.free();
    this.bodies.clear();
  }
}
