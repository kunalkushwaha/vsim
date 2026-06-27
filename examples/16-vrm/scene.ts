// Example 16 — a VRM avatar. VRM is the popular web-3D humanoid format (glTF + a humanoid-bone
// extension). loadVrm() loads the avatar's mesh + skin + clips like any rig, and additionally exposes
// the VRM humanoid bone map and license (vrm.meta). This sample avatar is CC0, built from a MakeHuman
// human (scripts/make-vrm.mjs). Drop in any VRM 0.x/1.0 file to render your own avatar.
import { scene } from "@vsim/authoring";
import { loadVrm } from "@vsim/assets";
import { fileURLToPath } from "node:url";

export default (async () => {
  const path = fileURLToPath(new URL("../../packages/assets/library/avatar.vrm", import.meta.url));
  const avatar = await loadVrm(path, 30);
  console.log(`VRM ${avatar.meta.spec} — "${avatar.meta.title}" (${avatar.meta.license}); ${Object.keys(avatar.humanoidBones).length} humanoid bones`);

  return scene({ fps: 30, duration: 90, width: 640, height: 360, background: [0.53, 0.74, 0.96] })
    .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97])
    .material("grass", { color: [0.27, 0.55, 0.24] })
    .material("skin", { color: [0.85, 0.68, 0.56] })
    .light({ type: "hemisphere", intensity: 0.6, skyColor: [0.55, 0.72, 0.95], groundColor: [0.3, 0.45, 0.22] })
    .light({ type: "directional", intensity: 0.9, direction: [-0.4, -1, -0.3] })
    .mesh("ground", { geometry: { kind: "plane", size: [40, 40] }, material: "grass" })
    .character("avatar", avatar, { clip: "walk", loop: true, material: "skin" })
    .animate("avatar", "position.x", [{ frame: 0, value: -3 }, { frame: 90, value: 3 }])
    .group("aim", { position: [-3, 0.9, 0] })
    .animate("aim", "position.x", [{ frame: 0, value: -3 }, { frame: 90, value: 3 }])
    .camera({ position: [0, 1.4, 5.5], lookAtNodeId: "aim", fov: 42 })
    .build();
})();
