// Merge static meshes by material to cut draw calls (big win on software GL / mobile).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ATTRS = ['position', 'normal', 'uv'];
function extract(geo, start, count, mat4, nmat) {
  const idx = geo.index ? geo.index.array : null;
  const total = idx ? idx.length : geo.attributes.position.count;
  const end = Math.min(total, start + (isFinite(count) ? count : total));
  const n = end - start;
  const out = new THREE.BufferGeometry();
  for (const name of ATTRS) {
    const a = geo.attributes[name];
    if (!a) return null;
    const arr = new Float32Array(n * a.itemSize);
    for (let i = 0; i < n; i++) {
      const v = idx ? idx[start + i] : start + i;
      for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.array[v * a.itemSize + k];
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  out.applyMatrix4(mat4);
  return out;
}

export function bakeGroup(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const victims = [];
  const visit = (o) => {
    for (const c of o.children.slice()) {
      if (c.userData.bakeSeparately) continue;
      if (c.isMesh && !c.isInstancedMesh && !c.userData.noBake) {
        const m4 = new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld);
        const g = c.geometry;
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        const groups = Array.isArray(c.material) && g.groups.length ? g.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
        let ok = true;
        const parts = [];
        for (const gr of groups) {
          const mat = mats[gr.materialIndex]; if (!mat) continue;
          const part = extract(g, gr.start, gr.count, m4);
          if (!part) { ok = false; break; }
          parts.push([mat, part]);
        }
        if (!ok) { visit(c); continue; }
        for (const [mat, part] of parts) {
          const key = `${mat.uuid}|${c.castShadow ? 1 : 0}${c.receiveShadow ? 1 : 0}|${c.renderOrder}`;
          if (!buckets.has(key)) buckets.set(key, { mat, cast: c.castShadow, receive: c.receiveShadow, ro: c.renderOrder, geos: [] });
          buckets.get(key).geos.push(part);
        }
        victims.push(c);
        g.dispose();
      }
      visit(c);
    }
  };
  visit(group);
  for (const v of victims) v.removeFromParent();
  // drop now-empty groups (furniture etc.)
  const prune = (o) => { for (const c of o.children.slice()) { prune(c); if (c.type === 'Group' && !c.children.length && !c.userData.bakeSeparately) c.removeFromParent(); } };
  prune(group);
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    b.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const m = new THREE.Mesh(merged, b.mat);
    m.castShadow = b.cast; m.receiveShadow = b.receive; m.renderOrder = b.ro;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  return buckets.size;
}
