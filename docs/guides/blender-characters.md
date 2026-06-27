# Creating characters with Blender → vsim

You don't have to hand-code characters. **Blender** (free, open-source, Linux/macOS/Windows) can
model, rig, animate, and export glTF — and vsim's `loadGltfRig()` reads that glTF directly. This
guide shows the headless workflow we use to generate `library/figure.glb`.

## 1. Install Blender (no root needed)

Blender ships a portable tarball — no `apt`/`sudo` required:

```bash
curl -L https://download.blender.org/release/Blender4.5/blender-4.5.9-linux-x64.tar.xz | tar xJ
./blender-4.5.9-linux-x64/blender --background --version   # verify it runs headless
```

(Or `apt install blender` / `snap install blender` / `flatpak install flathub org.blender.Blender`
if you have the rights.)

## 2. Generate a rigged, animated character

[`scripts/blender/make-character.py`](../../scripts/blender/make-character.py) builds a humanoid
(armature + skinned mesh + a walk clip) and exports glTF — run it headless:

```bash
blender --background --python scripts/blender/make-character.py -- character.glb
```

It exports with TRS joints, float skin weights, and a `walk` animation — exactly what vsim's loader
supports. Edit the script (bones, proportions, keyframes) to change the character.

## 3. Use it in a scene

```ts
import { loadGltfRig } from "@vsim/assets";
const rig = await loadGltfRig("character.glb", 30);
// then .character("hero", rig, { clip: "walk", ... })  — see examples/11-blender
```

Drop the `.glb` in `packages/assets/library/` and add a `manifest.json` entry to load it by name
with `loadCharacter("id")`.

## Realistic humans

For photoreal/realistic humans (skin, clothing, full body), install a Blender character-generator
add-on and export glTF the same way — all free/open-source:

- **MPFB 2** (MakeHuman Plugin For Blender) — parametric humans with age/build/ethnicity, skin, clothing.
- **CharMorph** — successor to MB-Lab; rigged characters with hair/clothing.
- **MakeHuman** (standalone) — generates a rigged human base mesh, export to glTF/Blender.

Generate + rig + animate in Blender, export `.glb`, and load it exactly as above. vsim now also
samples the model's base-color texture, so textured exports render with their real surface detail.

**vsim ships a working example of this:** [`scripts/blender/make-human.py`](../../scripts/blender/make-human.py)
drives **MakeHuman (MPFB 2)** headlessly — it generates a realistic ~22k-vertex human with a
53-bone rig, applies a **real skin texture**, adds a walk, and exports glTF. The result is bundled as
`library/human.glb` (CC0) and shown in `examples/12-makehuman` (`loadCharacter("human")`). Run it yourself:

```bash
# 1. the add-on
curl -L https://files.makehumancommunity.org/plugins/mpfb2-latest.zip -o mpfb2.zip
# 2. a real skin (CC0 system-assets pack — skins/eyes/teeth/clothes, 267 MB)
curl -L https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip -o skins.zip
unzip skins.zip 'skins/*' -d assets
# 3. generate (pass a skin .mhmat for a textured human; omit it for a plain mesh)
blender --background --python scripts/blender/make-human.py -- \
  mpfb2.zip human.glb assets/skins/young_caucasian_female_special_suit/young_caucasian_female_special_suit.mhmat
```

The skin is baked to a single base-color map (`skin_type="GAMEENGINE"`) and downscaled to 1024² so the
GLB stays small (~5.7 MB); glTF exports it as a `baseColorTexture` over the mesh's UVs, which vsim's
software renderer samples per pixel. The pack has 21 skins (age × ethnicity × sex, plus painted-suit
variants) — pass any of them.

> Note: vsim's glTF loader currently supports TRS joints, float weights, and PNG/JPEG base-color
> textures (no matrix-transform joints / normalized-integer weights yet).
