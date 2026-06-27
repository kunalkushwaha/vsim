import { mat4, type Mat4 } from "./math.js";

/**
 * Linear-blend skinning matrix for one vertex: blend its (up to) 4 joint matrices by their weights.
 * Shared by every engine so CPU skinning is computed one way everywhere.
 */
export function skinningMatrix(jointMatrices: Mat4[], joints: number[], weights: number[], vertexIndex: number): Mat4 {
  const o = vertexIndex * 4;
  return mat4.blend(
    [
      jointMatrices[joints[o]!]!,
      jointMatrices[joints[o + 1]!]!,
      jointMatrices[joints[o + 2]!]!,
      jointMatrices[joints[o + 3]!]!,
    ],
    [weights[o]!, weights[o + 1]!, weights[o + 2]!, weights[o + 3]!],
  );
}
