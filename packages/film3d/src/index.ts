export {
  Film3DDocSchema, parseFilm3D, CHARACTERS, CHARACTER_IDS,
  type Film3DDoc, type Film3DShot, type Film3DProp, type CharacterId,
} from "./schema.js";
export { compileFilm3D, FILM3D_WIDTH, FILM3D_HEIGHT } from "./compile.js";
export { SET_LOOKS, applySet, campfire, placeProp, type SetLook } from "./sets.js";
export { generateFilm3D, reviewFilm3D } from "./generate.js";
export { narrationScript, type NarrationSpec } from "./narration.js";
export { isFilm3D, film3dToScene } from "./load.js";
export { pickReviewStills, parseReviewReply, type ReviewStill } from "./review.js";
export { CreatureDocSchema, parseCreature, creatureGeometry, type CreatureDoc } from "./creature.js";
export { generateCreature, reviewCreature } from "./generate.js";
export { SurfaceDocSchema, parseSurface, checkSurfaceHtml, SURFACE_FONT, type SurfaceDoc } from "./surface-gen.js";
export { generateSurface, reviewSurface } from "./generate.js";
