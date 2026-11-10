// Procedural house generator: plan (normalised) -> THREE scene graph + collision/floor data.
import * as THREE from 'three';
import { M, wallMaterial, floorMaterial, featureMaterial, roofMaterial } from './materials.js';
import { bakeGroup } from './bake.js';
import { ensureCCW, offsetPolygon, pointInPolygon, bbox, centroid, distToSegment, orientedRect, polygonArea, convexOverlap } from './geom.js';

export const W = (x, y, h = 0) => new THREE.Vector3(x, h, -y); // plan -> world

// Box-project world-space UVs (1 uv unit = 1 m) so textures tile at real scale.
function worldUV(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    if (ny >= nx && ny >= nz) { uv[i * 2] = x; uv[i * 2 + 1] = -z; }
    else if (nx >= nz) { uv[i * 2] = -z * Math.sign(nor.getX(i) || 1); uv[i * 2 + 1] = y; }
    else { uv[i * 2] = x * Math.sign(nor.getZ(i) || 1); uv[i * 2 + 1] = y; }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

// Axis box along a wall line. a0..a1 along the wall (m from start), z0..z1 height (world), thickness t,
// lateral offset (plan, along left normal). mats: [end,end,top,bottom,right,left]
function wallBox(w, a0, a1, z0, z1, t, mats, lateral = 0) {
  const len = a1 - a0, h = z1 - z0;
  if (len <= 0.001 || h <= 0.001) return null;
  const geo = new THREE.BoxGeometry(len, h, t);
  const ang = Math.atan2(w.uy, w.ux);
  const mid = (a0 + a1) / 2;
  const cx = w.start[0] + w.ux * mid + -w.uy * lateral, cy = w.start[1] + w.uy * mid + w.ux * lateral;
  const m4 = new THREE.Matrix4().makeRotationY(ang).setPosition(cx, z0 + h / 2, -cy);
  geo.applyMatrix4(m4);
  worldUV(geo);
  return mesh(geo, mats);
}

function shapeFrom(poly, holes = []) {
  const s = new THREE.Shape(ensureCCW(poly).map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) {
    const hp = ensureCCW(h).reverse();
    s.holes.push(new THREE.Path(hp.map(([x, y]) => new THREE.Vector2(x, y))));
  }
  return s;
}
// Horizontal slab: top at `top`, thickness `t`. Shape is in plan XY -> world XZ.
function slab(poly, top, t, mat, holes = [], sideMat = null) {
  const geo = new THREE.ExtrudeGeometry(shapeFrom(poly, holes), { depth: t, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2); // plan y -> world -z, extrude goes +y
  geo.translate(0, top - t, 0);
  geo.computeVertexNormals();
  worldUV(geo);
  return mesh(geo, sideMat ? [mat, sideMat] : mat);
}
// Flat horizontal surface (one-sided), facing up or down.
function flat(poly, h, mat, holes = [], down = false) {
  const geo = new THREE.ShapeGeometry(shapeFrom(poly, holes), 1);
  geo.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  if (down) geo.scale(1, 1, -1), geo.index && reverseIndex(geo);
  geo.translate(0, h, 0);
  geo.computeVertexNormals();
  worldUV(geo);
  return mesh(geo, mat, { cast: false });
}
function reverseIndex(geo) {
  const idx = geo.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
  geo.index.needsUpdate = true;
}
function boxAt(cx, cy, z0, w, d, h, mat, rot = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.applyMatrix4(new THREE.Matrix4().makeRotationY(rot).setPosition(cx, z0 + h / 2, -cy));
  worldUV(geo);
  return mesh(geo, mat);
}

function stairRect(s) {
  const a = (s.direction * Math.PI) / 180;
  const dx = Math.sin(a), dy = Math.cos(a);
  const c = [s.start[0] + dx * s.run / 2, s.start[1] + dy * s.run / 2];
  return { poly: orientedRect(c[0], c[1], dx, dy, s.run / 2, s.width / 2), dx, dy, c };
}

function polyInside(inner, outer) { return inner.every((p) => pointInPolygon(p, outer)); }

export function buildHouse(plan) {
  const root = new THREE.Group(); root.name = 'house';
  const levelGroups = new Map();
  const ceilingGroups = new Map();
  const labelAnchors = [];
  const colliders = []; // {a:[x,y], b:[x,y], r, z0, z1}
  const floors = []; // {poly, holes, h, kind}
  const ramps = []; // stairs
  const levelById = new Map(plan.levels.map((l) => [l.id, l]));
  const roomsByLevel = new Map(plan.levels.map((l) => [l.id, plan.rooms.filter((r) => r.level === l.id)]));
  const addSeg = (a, b, r, z0, z1, tag) => colliders.push({ a, b, r, z0, z1, tag });
  const addPolyCollider = (poly, z0, z1, tag) => { for (let i = 0; i < poly.length; i++) addSeg(poly[i], poly[(i + 1) % poly.length], 0.0, z0, z1, tag); };

  for (const l of plan.levels) {
    const g = new THREE.Group(); g.name = `level:${l.id}`; g.userData.level = l; root.add(g); levelGroups.set(l.id, g);
    const cg = new THREE.Group(); cg.name = `ceilings:${l.id}`; cg.userData.bakeSeparately = true; g.add(cg); ceilingGroups.set(l.id, cg);
  }

  // ---------- stairs (holes first so floors can use them)
  const stairHoles = []; // {level, poly}
  for (const s of plan.stairs) {
    const from = levelById.get(s.fromLevel), to = levelById.get(s.toLevel);
    const R = stairRect(s);
    stairHoles.push({ level: to.id, poly: offsetPolygon(R.poly, 0.03), stair: s });
    stairHoles.push({ level: from.id, poly: offsetPolygon(R.poly, 0.03), stair: s, ceiling: true });
    const g = levelGroups.get(from.id);
    const tread = s.run / s.steps, riser = s.rise / s.steps;
    const ang = Math.atan2(R.dx, R.dy); // rotation about world Y so local -z points along climb
    const stepMat = M.woodFloor(), sideMat = M.interior();
    for (let i = 0; i < s.steps; i++) {
      const d0 = i * tread, top = from.elevation + riser * (i + 1);
      const cx = s.start[0] + R.dx * (d0 + tread / 2), cy = s.start[1] + R.dy * (d0 + tread / 2);
      const h = Math.max(0.05, Math.min(top - from.elevation, riser * 2 + 0.05)); // open-ish stringer look
      const m = boxAt(cx, cy, top - h, s.width, tread + 0.02, h, [sideMat, sideMat, stepMat, sideMat, sideMat, sideMat], -ang + Math.PI);
      g.add(m);
    }
    // stringers / side panels (solid wedge approximated by tall thin boxes per step)
    for (const side of [-1, 1]) {
      const ox = -R.dy * side * (s.width / 2 + 0.03), oy = R.dx * side * (s.width / 2 + 0.03);
      for (let i = 0; i < s.steps; i++) {
        const top = from.elevation + riser * (i + 1) + 0.05;
        const cx = s.start[0] + R.dx * (i * tread + tread / 2) + ox, cy = s.start[1] + R.dy * (i * tread + tread / 2) + oy;
        g.add(boxAt(cx, cy, Math.max(from.elevation, top - 0.45), 0.05, tread + 0.005, Math.min(0.45, top - from.elevation), M.whiteFrame(), -ang));
      }
      // handrail
      const hr = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, Math.hypot(s.run, s.rise), 8), M.aluminium());
      const mid = [s.start[0] + R.dx * s.run / 2 + ox, s.start[1] + R.dy * s.run / 2 + oy];
      hr.position.copy(W(mid[0], mid[1], from.elevation + s.rise / 2 + 0.9));
      const dir = W(R.dx * s.run, R.dy * s.run, s.rise).normalize();
      hr.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      hr.castShadow = true; g.add(hr);
      // collider along the side (keeps you on the stairs and out from under them)
      const a = [s.start[0] + ox, s.start[1] + oy], b = [s.start[0] + R.dx * s.run + ox, s.start[1] + R.dy * s.run + oy];
      addSeg(a, b, 0.04, from.elevation - 1, to.elevation + 1.2, 'stair-side');
    }
    // balustrade around the stairwell on the upper floor (open at the top of the flight)
    const tg = levelGroups.get(to.id);
    const P4 = R.poly;
    for (const [i, j] of [[0, 1], [2, 3], [3, 0]]) {
      const a = P4[i], b = P4[j];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (plan.walls.some((w) => w.level === to.id && distToSegment(mid, w.start, w.end).d < w.thickness / 2 + 0.3)) continue;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const line = { start: a, ux: (b[0] - a[0]) / L, uy: (b[1] - a[1]) / L };
      const gp = wallBox(line, 0, L, to.elevation + 0.05, to.elevation + 0.95, 0.012, M.glass());
      gp.castShadow = false; gp.renderOrder = 2; tg.add(gp);
      tg.add(wallBox(line, -0.02, L + 0.02, to.elevation + 0.95, to.elevation + 1.0, 0.05, M.aluminium()));
      tg.add(wallBox(line, -0.02, L + 0.02, to.elevation, to.elevation + 0.05, 0.05, M.aluminium()));
      addSeg(a, b, 0.03, to.elevation, to.elevation + 1.0, 'balustrade');
    }
    ramps.push({ s, from, to, R });
  }
  const holesFor = (levelId, poly, ceiling = false) =>
    stairHoles.filter((h) => h.level === levelId && !!h.ceiling === ceiling && polyInside(h.poly, poly)).map((h) => h.poly);
  // warn about stair holes not fully inside a single room of the target level
  for (const h of stairHoles.filter((x) => !x.ceiling)) {
    const rooms = roomsByLevel.get(h.level) || [];
    if (rooms.length && !rooms.some((r) => polyInside(h.poly, r.polygon))) plan.warnings.push(`stairs ${h.stair.id}: stairwell not fully inside one room on ${h.level}; hole only cut in the base slab`);
  }

  // ---------- walls
  const nextLevel = (l) => plan.levels[l.index + 1];
  const roomAt = (levelId, p, indoorOnly = true) => (roomsByLevel.get(levelId) || []).find((r) => (!indoorOnly || !r.outdoor) && pointInPolygon(p, r.polygon));
  const furnFoot = plan.furniture.map((f) => ({ level: f.level, poly: orientedRect(f.position[0], f.position[1], Math.cos(f.rotationRad || 0), Math.sin(f.rotationRad || 0), f.size[0] / 2, f.size[1] / 2) }));
  const openingsByWall = new Map();
  for (const o of plan.openings) { if (!openingsByWall.has(o.wall)) openingsByWall.set(o.wall, []); openingsByWall.get(o.wall).push(o); }
  for (const w of plan.walls) {
    const lvl = levelById.get(w.level);
    const g = levelGroups.get(w.level);
    w.ux = (w.end[0] - w.start[0]) / w.length; w.uy = (w.end[1] - w.start[1]) / w.length;
    let H = w.height;
    const nl = nextLevel(lvl);
    if (w.exterior && nl && H >= lvl.height - 0.01) H = nl.elevation - lvl.elevation; // run up through the floor slab above
    const z0 = lvl.elevation, z1 = lvl.elevation + H;
    // which side is inside?
    const mid = [w.start[0] + w.ux * w.length / 2, w.start[1] + w.uy * w.length / 2];
    const leftN = [-w.uy, w.ux];
    const probe = (sgn) => roomAt(w.level, [mid[0] + leftN[0] * sgn * (w.thickness / 2 + 0.15), mid[1] + leftN[1] * sgn * (w.thickness / 2 + 0.15)]);
    const leftRoom = probe(1), rightRoom = probe(-1);
    const extMat = wallMaterial(w.material || (w.exterior ? 'plaster' : 'interior'), w.exterior ? 'plaster' : 'interior');
    const intMat = M.interior();
    let leftMat, rightMat;
    if (!w.exterior) { leftMat = rightMat = w.material && /brick/i.test(w.material) ? extMat : intMat; }
    else if (leftRoom && !rightRoom) { leftMat = intMat; rightMat = extMat; }
    else if (rightRoom && !leftRoom) { leftMat = extMat; rightMat = intMat; }
    else { leftMat = rightMat = extMat; }
    w.inside = leftRoom && !rightRoom ? 1 : rightRoom && !leftRoom ? -1 : 0;
    const endMat = w.exterior ? extMat : intMat;
    const mats = [endMat, endMat, intMat, intMat, rightMat, leftMat];
    const ops = (openingsByWall.get(w.id) || []).slice().sort((a, b) => a.offset - b.offset);
    // Short stand-alone wall sections (e.g. 150 x 150 patio posts) render as true columns.
    if (w.length <= 0.6 && w.length <= w.thickness * 2.5 && !ops.length) {
      const pm = wallBox(w, 0, w.length, z0, z1, w.thickness, extMat);
      pm.userData.wall = w.id; pm.userData.post = true; g.add(pm);
      addSeg(w.start, w.end, w.thickness / 2, z0, z1, 'post');
      w.isPost = true;
      continue;
    }
    // Extend ends to close corners, except where the wall simply continues in a collinear
    // wall (e.g. W3a -> W3b) so the two faces don't overlap and z-fight.
    const continues = (pt) => plan.walls.some((o) => o !== w && o.level === w.level && o.length > 0.6 &&
      [o.start, o.end].some((q) => Math.hypot(q[0] - pt[0], q[1] - pt[1]) < 0.01) &&
      Math.abs(((o.end[0] - o.start[0]) * w.uy - (o.end[1] - o.start[1]) * w.ux) / o.length) < 0.01);
    const ext0 = continues(w.start) ? 0 : w.thickness / 2 - 0.003;
    const ext1 = continues(w.end) ? 0 : w.thickness / 2 - 0.003;
    let cursor = -ext0;
    const solid = (a0, a1, zb, zt, ghost = false) => {
      const m = wallBox(w, a0, a1, zb, zt, w.thickness, mats);
      if (m) { m.userData.wall = w.id; g.add(m); }
      if (!ghost && a1 - a0 > 0.001 && zt - zb > 0.001) addSeg([w.start[0] + w.ux * a0, w.start[1] + w.uy * a0], [w.start[0] + w.ux * a1, w.start[1] + w.uy * a1], w.thickness / 2, zb, zt, 'wall');
    };
    for (const o of ops) {
      const a0 = o.offset, a1 = o.offset + o.width;
      solid(cursor, a0, z0, z1);
      const sb = z0 + o.sill, st = Math.min(z1, z0 + o.sill + o.height);
      if (o.sill > 0.001) solid(a0, a1, z0, sb);
      solid(a0, a1, st, z1);
      buildOpening(g, w, o, a0, a1, sb, st, addSeg, leftRoom, rightRoom, furnFoot.filter((f) => f.level === w.level));
      cursor = a1;
    }
    solid(cursor, w.length + ext1, z0, z1);
  }

  // ---------- floors, base slabs, ceilings
  for (const l of plan.levels) {
    const g = levelGroups.get(l.id), cg = ceilingGroups.get(l.id);
    const rooms = roomsByLevel.get(l.id) || [];
    const isGround = l.index === 0 || l.elevation <= 0.05;
    const slabT = isGround ? l.slabThickness + 0.1 : Math.max(0.05, l.slabThickness - 0.03);
    // Base slab under each room, grown by ~half an external wall, fills gaps under walls/doors.
    for (const r of rooms) {
      if (r.outdoor) continue;
      const grow = offsetPolygon(r.polygon, 0.12);
      const holes = stairHoles.filter((h) => h.level === l.id && !h.ceiling && polyInside(h.poly, grow)).map((h) => h.poly);
      const m = slab(grow, l.elevation - 0.004, slabT, M.concrete(), holes);
      m.castShadow = false; g.add(m);
      floors.push({ poly: grow, holes, h: l.elevation, level: l.id, kind: 'slab' });
    }
    for (const r of rooms) {
      const holes = holesFor(l.id, r.polygon);
      const m = slab(r.polygon, l.elevation, isGround ? 0.05 : Math.max(0.05, l.slabThickness - 0.02), [floorMaterial(r.floorMaterial, r.type), M.concrete()], holes);
      m.castShadow = !isGround; m.userData.room = r.id; g.add(m);
      floors.push({ poly: r.polygon, holes, h: l.elevation, level: l.id, kind: 'room', room: r });
      if (!r.outdoor) {
        const ch = holesFor(l.id, r.polygon, true);
        const c = flat(r.polygon, l.elevation + l.height - 0.005, M.ceiling(), ch, true);
        c.receiveShadow = false; cg.add(c);
      }
      const c2 = centroid(r.polygon);
      labelAnchors.push({ text: r.name, level: l.id, pos: W(c2[0], c2[1], l.elevation + 0.3), room: r });
    }
  }

  // ---------- furniture
  for (const f of plan.furniture) {
    const l = levelById.get(f.level);
    const grp = makeFurniture(f);
    grp.position.copy(W(f.position[0], f.position[1], l.elevation));
    grp.rotation.y = f.rotationRad || 0;
    levelGroups.get(l.id).add(grp);
    if (!['shower', 'rug', 'plant'].includes(f.type)) {
      const ux = Math.cos(f.rotationRad || 0), uy = Math.sin(f.rotationRad || 0);
      addPolyCollider(orientedRect(f.position[0], f.position[1], ux, uy, f.size[0] / 2, f.size[1] / 2), l.elevation, l.elevation + f.size[2], 'furniture');
    }
  }

  // ---------- roof
  const roofGroup = new THREE.Group(); roofGroup.name = 'roof'; root.add(roofGroup);
  const topLevel = plan.levels[plan.levels.length - 1];
  const topWalls = plan.walls.filter((w) => w.level === topLevel.id);
  const extWalls = topWalls.filter((w) => w.exterior);
  const eave = topLevel.elevation + Math.max(topLevel.height, ...topWalls.map((w) => w.height));
  let outline = plan.roof.outline;
  if (!outline) outline = outlineFromWalls(extWalls.length ? extWalls : topWalls) || null;
  if (!outline && topWalls.length) {
    const b = bbox(topWalls.flatMap((w) => [w.start, w.end]));
    const t = 0.115; outline = [[b.minX - t, b.minY - t], [b.maxX + t, b.minY - t], [b.maxX + t, b.maxY + t], [b.minX - t, b.maxY + t]];
    plan.warnings.push('roof outline guessed from the bounding box of the top-level walls');
  }
  if (outline && plan.roof.type !== 'none') buildRoof(roofGroup, plan.roof, outline, eave, plan, addSeg);

  // ---------- site
  const siteGroup = new THREE.Group(); siteGroup.name = 'site'; root.add(siteGroup);
  const siteInfo = buildSite(siteGroup, plan, floors, addSeg, addPolyCollider);

  // ---------- bounds
  const pts = [...plan.walls.flatMap((w) => [w.start, w.end]), ...plan.rooms.flatMap((r) => r.polygon)];
  const houseB = bbox(pts.length ? pts : [[0, 0], [10, 10]]);
  const allPts = [...pts, ...(plan.site.boundary || []), ...plan.site.features.flatMap((f) => f.polygon)];
  const siteB = bbox(allPts.length ? allPts : [[0, 0], [10, 10]]);

  for (const g of [...levelGroups.values(), ...ceilingGroups.values(), roofGroup, siteGroup]) bakeGroup(g);
  return { root, levelGroups, ceilingGroups, roofGroup, siteGroup, colliders, floors, ramps, labelAnchors, houseB, siteB, eave, siteInfo, outline };
}

// Try to chain exterior wall centrelines into a closed loop and push it out by half a wall.
function outlineFromWalls(walls) {
  if (walls.length < 3) return null;
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const adj = new Map();
  for (const w of walls) for (const [a, b] of [[w.start, w.end], [w.end, w.start]]) { if (!adj.has(key(a))) adj.set(key(a), []); adj.get(key(a)).push({ p: b, w }); }
  const start = walls[0].start; const loop = [start]; const used = new Set(); let cur = start;
  for (let i = 0; i < walls.length + 1; i++) {
    const nxt = (adj.get(key(cur)) || []).find((e) => !used.has(e.w));
    if (!nxt) return null;
    used.add(nxt.w);
    if (key(nxt.p) === key(start)) { if (loop.length < 3) return null; return offsetPolygon(loop, (walls[0].thickness || 0.23) / 2); }
    loop.push(nxt.p); cur = nxt.p;
  }
  return null;
}

// ---------- openings: frames, glass, doors
function buildOpening(g, w, o, a0, a1, sb, st, addSeg, leftRoom, rightRoom, furn = []) {
  const t = w.thickness;
  const exteriorish = w.exterior;
  const frameMat = exteriorish || o.type !== 'door' ? M.aluminium() : M.whiteFrame();
  const ft = 0.05; // frame bar size
  const fd = Math.min(t * 0.7, 0.09); // frame depth
  const P = (a) => [w.start[0] + w.ux * a, w.start[1] + w.uy * a];
  const add = (m) => m && g.add(m);
  const glassPane = (b0, b1, z0, z1, lateral = 0) => {
    const m = wallBox(w, b0, b1, z0, z1, 0.012, M.glass(), lateral);
    if (m) { m.castShadow = false; m.receiveShadow = false; m.renderOrder = 2; g.add(m); }
  };
  if (o.type === 'opening') return;
  // jambs + head
  add(wallBox(w, a0, a0 + ft, sb, st, fd, frameMat));
  add(wallBox(w, a1 - ft, a1, sb, st, fd, frameMat));
  add(wallBox(w, a0, a1, st - ft, st, fd, frameMat));
  if (o.type === 'window') {
    add(wallBox(w, a0, a1, sb, sb + ft, fd, frameMat));
    // mullions every ~1 m
    const n = Math.max(1, Math.round((a1 - a0) / 1.0));
    for (let i = 1; i < n; i++) { const a = a0 + ((a1 - a0) * i) / n; add(wallBox(w, a - ft / 2, a + ft / 2, sb, st, fd * 0.8, frameMat)); }
    glassPane(a0 + ft, a1 - ft, sb + ft, st - ft);
    // external sill
    if (w.exterior && w.inside) add(wallBox(w, a0 - 0.03, a1 + 0.03, sb - 0.04, sb, 0.08, M.charcoal(), -w.inside * (t / 2 + 0.02)));
    addSeg(P(a0), P(a1), t / 2, sb, st, 'glass');
  } else if (o.type === 'sliding_door') {
    const n = Math.max(2, Math.ceil((a1 - a0) / 1.6));
    const pw = (a1 - a0 - 2 * ft) / n;
    // open the end panel (first or last) whose doorway is not blocked by furniture
    const blockedAt = (i) => {
      const b0 = a0 + ft + i * pw, c = P(b0 + pw / 2);
      const zone = orientedRect(c[0], c[1], w.ux, w.uy, pw / 2 - 0.05, t / 2 + 0.7);
      return furn.filter((f) => convexOverlap(zone, f.poly)).length;
    };
    const openIdx = blockedAt(n - 1) <= blockedAt(0) ? n - 1 : 0;
    for (let i = 0; i < n; i++) {
      let b0 = a0 + ft + i * pw, b1 = b0 + pw;
      const lateral = (i % 2 ? 1 : -1) * 0.025;
      if (i === openIdx) { const sh = (openIdx ? -1 : 1) * pw * 0.92; b0 += sh; b1 += sh; }
      add(wallBox(w, b0, b0 + 0.04, sb, st - ft, 0.04, frameMat, lateral));
      add(wallBox(w, b1 - 0.04, b1, sb, st - ft, 0.04, frameMat, lateral));
      add(wallBox(w, b0, b1, sb, sb + 0.06, 0.04, frameMat, lateral));
      add(wallBox(w, b0, b1, st - ft - 0.04, st - ft, 0.04, frameMat, lateral));
      glassPane(b0 + 0.04, b1 - 0.04, sb + 0.06, st - ft - 0.04, lateral);
    }
    add(wallBox(w, a0, a1, sb, sb + 0.015, fd, frameMat)); // track
    if (openIdx) addSeg(P(a0), P(a1 - pw - ft), t / 2, sb, st, 'glass');
    else addSeg(P(a0 + ft + pw), P(a1), t / 2, sb, st, 'glass');
  } else if (o.type === 'garage_door') {
    const m = wallBox(w, a0 + ft, a1 - ft, sb, st - ft, 0.05, M.garageDoor(), w.inside ? w.inside * 0.0 : 0);
    add(m);
    addSeg(P(a0), P(a1), t / 2, sb, st, 'garage-door');
  } else {
    // hinged door: leaf opened 90 degrees into the room it serves
    let side = w.inside || 0; // +1 = left normal side
    if (!side) {
      const pref = (r) => (r ? (/(passage|hall|entrance|corridor)/.test(r.type + r.name.toLowerCase()) ? 1 : 2) : 0);
      side = pref(leftRoom) >= pref(rightRoom) ? 1 : -1;
    }
    const n = [-w.uy * side, w.ux * side]; // into the room
    // viewer in room faces -n; their left is rot90(-n) = (n[1], -n[0])
    const leftDir = [n[1], -n[0]];
    const along = leftDir[0] * w.ux + leftDir[1] * w.uy; // +1 => left is toward wall end
    const hingeAtEnd = o.swing === 'right' ? along < 0 : along > 0;
    const hingeA = hingeAtEnd ? a1 - ft : a0 + ft;
    const leafW = a1 - a0 - 2 * ft, leafT = 0.04;
    const hp = P(hingeA);
    const face = [hp[0] + n[0] * (t / 2), hp[1] + n[1] * (t / 2)];
    const lc = [face[0] + n[0] * leafW / 2, face[1] + n[1] * leafW / 2];
    const off = hingeAtEnd ? -1 : 1;
    const c = [lc[0] + w.ux * off * leafT / 2, lc[1] + w.uy * off * leafT / 2];
    const leafMat = w.exterior ? M.frontDoor() : M.doorLeaf();
    const leaf = boxAt(c[0], c[1], sb, leafT, leafW, st - sb - ft - 0.01, leafMat, Math.atan2(w.uy, w.ux));
    g.add(leaf);
    const h1 = [c[0] - n[0] * leafW / 2, c[1] - n[1] * leafW / 2], h2 = [c[0] + n[0] * leafW / 2, c[1] + n[1] * leafW / 2];
    addSeg(h1, h2, leafT / 2, sb, st, 'door-leaf');
    // handle
    const hc = [h2[0] - n[0] * 0.07 + w.ux * off * 0.05, h2[1] - n[1] * 0.07 + w.uy * off * 0.05];
    g.add(boxAt(hc[0], hc[1], sb + 1.0, 0.02, 0.14, 0.02, M.aluminium()));
  }
}

// ---------- roof
function buildRoof(g, roof, outline, eave, plan, addSeg) {
  const rmat = roofMaterial(roof.material, roof.type);
  const ov = roof.overhang || 0;
  if (roof.type === 'flat') {
    const poly = ov > 0.001 ? offsetPolygon(outline, ov) : outline;
    const T = 0.25;
    const top = eave + T;
    const s = slab(poly, top, T, [rmat, M.charcoal()]);
    s.userData.roof = true; g.add(s);
    const sof = flat(poly, eave - 0.003, M.soffit(), [], true); g.add(sof);
    const ph = roof.parapetHeight || 0;
    if (ph > 0) {
      const tPar = 0.2;
      const inner = offsetPolygon(poly, -tPar);
      const par = slab(poly, top + ph, ph, [M.plaster(), M.plaster()], [inner]);
      g.add(par);
      const cap = slab(offsetPolygon(poly, 0.02), top + ph + 0.03, 0.03, [M.charcoal(), M.charcoal()], [offsetPolygon(poly, -tPar - 0.02)]);
      g.add(cap);
    } else {
      // thin fascia band
      g.add(slab(offsetPolygon(poly, 0.01), top + 0.05, T + 0.08, [M.charcoal(), M.charcoal()], [offsetPolygon(poly, -0.04)]));
    }
    // posts under roof corners that have no wall below (e.g. covered patio)
    const topLevel = plan.levels[plan.levels.length - 1];
    const walls = plan.walls.filter((w) => w.level === topLevel.id);
    for (const p of outline) {
      const near = walls.some((w) => distToSegment(p, w.start, w.end).d < w.thickness / 2 + 0.35);
      if (near) continue;
      const inset = offsetPolygon(outline, -0.12);
      const q = inset[outline.indexOf(p)];
      g.add(boxAt(q[0], q[1], topLevel.elevation, 0.12, 0.12, eave - topLevel.elevation, M.aluminium()));
      addSeg([q[0] - 0.06, q[1]], [q[0] + 0.06, q[1]], 0.06, topLevel.elevation, eave, 'post');
    }
    return;
  }
  // pitched: work on the bounding box of the outline
  const b = bbox(outline);
  const x0 = b.minX - ov, x1 = b.maxX + ov, y0 = b.minY - ov, y1 = b.maxY + ov;
  const ridgeX = roof.ridgeDirection ? roof.ridgeDirection.includes('x') : b.w >= b.h;
  const span = ridgeX ? b.h : b.w;
  const tan = Math.tan((roof.pitchDeg * Math.PI) / 180);
  const eaveDrop = ov * tan;
  const ez = eave - eaveDrop; // eave height at the overhang edge
  const rise = (span / 2 + ov) * tan;
  const rz = ez + rise;
  const tris = [];
  const V = (x, y, z) => [x, z, -y];
  const quad = (a, b2, c, d) => { tris.push(a, b2, c, a, c, d); };
  const gableTris = [];
  if (roof.type === 'gable' || roof.type === 'skillion') {
    if (roof.type === 'gable') {
      if (ridgeX) {
        const ym = (y0 + y1) / 2;
        quad(V(x0, y0, ez), V(x1, y0, ez), V(x1, ym, rz), V(x0, ym, rz));
        quad(V(x1, y1, ez), V(x0, y1, ez), V(x0, ym, rz), V(x1, ym, rz));
        for (const x of [b.minX, b.maxX]) gableTris.push([[x, b.minY, eave], [x, b.maxY, eave], [x, (b.minY + b.maxY) / 2, eave + (b.h / 2) * tan]]);
      } else {
        const xm = (x0 + x1) / 2;
        quad(V(x0, y1, ez), V(x0, y0, ez), V(xm, y0, rz), V(xm, y1, rz));
        quad(V(x1, y0, ez), V(x1, y1, ez), V(xm, y1, rz), V(xm, y0, rz));
        for (const y of [b.minY, b.maxY]) gableTris.push([[b.minX, y, eave], [b.maxX, y, eave], [(b.minX + b.maxX) / 2, y, eave + (b.w / 2) * tan]]);
      }
    } else {
      const sRise = (span + 2 * ov) * tan;
      if (ridgeX) {
        quad(V(x0, y0, ez), V(x1, y0, ez), V(x1, y1, ez + sRise), V(x0, y1, ez + sRise));
        for (const x of [b.minX, b.maxX]) gableTris.push([[x, b.minY, eave], [x, b.maxY, eave], [x, b.maxY, eave + b.h * tan]]);
        gableTris.push([[b.minX, b.maxY, eave], [b.maxX, b.maxY, eave], [b.maxX, b.maxY, eave + b.h * tan]], [[b.minX, b.maxY, eave], [b.maxX, b.maxY, eave + b.h * tan], [b.minX, b.maxY, eave + b.h * tan]]);
      } else {
        quad(V(x1, y0, ez), V(x1, y1, ez), V(x0, y1, ez + sRise), V(x0, y0, ez + sRise));
        for (const y of [b.minY, b.maxY]) gableTris.push([[b.maxX, y, eave], [b.minX, y, eave], [b.minX, y, eave + b.w * tan]]);
        gableTris.push([[b.minX, b.minY, eave], [b.minX, b.maxY, eave], [b.minX, b.maxY, eave + b.w * tan]], [[b.minX, b.minY, eave], [b.minX, b.maxY, eave + b.w * tan], [b.minX, b.minY, eave + b.w * tan]]);
      }
    }
  } else { // hip
    if (ridgeX) {
      const ym = (y0 + y1) / 2, half = (y1 - y0) / 2;
      const rx0 = Math.min(x0 + half, (x0 + x1) / 2), rx1 = Math.max(x1 - half, (x0 + x1) / 2);
      quad(V(x0, y0, ez), V(x1, y0, ez), V(rx1, ym, rz), V(rx0, ym, rz));
      quad(V(x1, y1, ez), V(x0, y1, ez), V(rx0, ym, rz), V(rx1, ym, rz));
      tris.push(V(x1, y0, ez), V(x1, y1, ez), V(rx1, ym, rz));
      tris.push(V(x0, y1, ez), V(x0, y0, ez), V(rx0, ym, rz));
    } else {
      const xm = (x0 + x1) / 2, half = (x1 - x0) / 2;
      const ry0 = Math.min(y0 + half, (y0 + y1) / 2), ry1 = Math.max(y1 - half, (y0 + y1) / 2);
      quad(V(x0, y1, ez), V(x0, y0, ez), V(xm, ry0, rz), V(xm, ry1, rz));
      quad(V(x1, y0, ez), V(x1, y1, ez), V(xm, ry1, rz), V(xm, ry0, rz));
      tris.push(V(x0, y0, ez), V(x1, y0, ez), V(xm, ry0, rz));
      tris.push(V(x1, y1, ez), V(x0, y1, ez), V(xm, ry1, rz));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  geo.computeVertexNormals();
  worldUV(geo);
  const top = mesh(geo, rmat); g.add(top);
  const under = mesh(geo.clone(), M.soffit(), { cast: false }); under.material = M.soffit().clone(); under.material.side = THREE.BackSide;
  under.position.y = -0.02; g.add(under);
  // fascia along eaves
  if (roof.type === 'hip') {
    g.add(slab([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], ez + 0.02, 0.2, [M.charcoal(), M.charcoal()], [[[x0 + 0.03, y0 + 0.03], [x1 - 0.03, y0 + 0.03], [x1 - 0.03, y1 - 0.03], [x0 + 0.03, y1 - 0.03]]]));
  } else {
    // fascia boards along the eave edges only (gable ends stay clean)
    const eaves = roof.type === 'gable' ? (ridgeX ? [y0, y1] : [x0, x1]) : (ridgeX ? [y0] : [x1]);
    for (const e of eaves) {
      const poly = ridgeX ? [[x0, e - 0.015], [x1, e - 0.015], [x1, e + 0.015], [x0, e + 0.015]] : [[e - 0.015, y0], [e + 0.015, y0], [e + 0.015, y1], [e - 0.015, y1]];
      g.add(slab(poly, ez + 0.02, 0.2, [M.charcoal(), M.charcoal()]));
    }
    // barge boards along the sloped gable edges
    const tanP = Math.tan((roof.pitchDeg * Math.PI) / 180);
    if (roof.type === 'gable') for (const ge of ridgeX ? [x0, x1] : [y0, y1]) for (const half of [0, 1]) {
      const a = ridgeX ? [ge, half ? y1 : y0, ez] : [half ? x1 : x0, ge, ez];
      const b2 = ridgeX ? [ge, (y0 + y1) / 2, rz] : [(x0 + x1) / 2, ge, rz];
      const len = Math.hypot(b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]);
      const bm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, len), M.charcoal());
      bm.position.set((a[0] + b2[0]) / 2, (a[2] + b2[2]) / 2 + 0.02, -(a[1] + b2[1]) / 2);
      bm.lookAt(b2[0], b2[2] + 0.02, -b2[1]); bm.castShadow = true; g.add(bm);
    }
  }
  if (gableTris.length) {
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gableTris.flat().map(([x, y, z]) => [x, z, -y]).flat(), 3));
    gg.computeVertexNormals(); worldUV(gg);
    const gm = mesh(gg, M.plaster().clone()); gm.material.side = THREE.DoubleSide; g.add(gm);
  }
  // ceiling slab at eave so the roof void is closed from above when cut away? (ceilings handle the inside)
}

// ---------- site
function buildSite(g, plan, floors, addSeg, addPolyCollider) {
  const feats = plan.site.features;
  const pools = feats.filter((f) => f.type === 'pool');
  const poolHolesIn = (poly) => pools.filter((p) => polyInside(p.polygon, poly)).map((p) => p.polygon);
  const B = plan.site.boundary;
  const allPts = [...plan.walls.flatMap((w) => [w.start, w.end]), ...(B || []), ...feats.flatMap((f) => f.polygon)];
  const bb = bbox(allPts.length ? allPts : [[0, 0], [10, 10]]);
  const R = Math.max(bb.w, bb.h) * 2 + 80;
  const outer = [[bb.cx - R, bb.cy - R], [bb.cx + R, bb.cy - R], [bb.cx + R, bb.cy + R], [bb.cx - R, bb.cy + R]];
  // surrounding land
  const groundHoles = B ? [B] : poolHolesIn(outer);
  g.add(flat(outer, -0.07, M.veld(), groundHoles));
  if (B) g.add(flat(B, -0.06, M.gravel(), poolHolesIn(B)));
  floors.push({ poly: outer, holes: [], h: -0.06, kind: 'ground' });

  const rand = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const hard = feats.filter((f) => ['pool', 'deck', 'patio', 'paving', 'driveway', 'planter'].includes(f.type));
  const roomsPolys = plan.rooms.map((r) => offsetPolygon(r.polygon, 0.4));
  const blocked = (p) => hard.some((f) => pointInPolygon(p, f.type === 'pool' ? offsetPolygon(f.polygon, 0.6) : f.polygon)) || roomsPolys.some((rp) => pointInPolygon(p, rp));
  const shrub = (x, y, base, s) => {
    const col = [0x4f7a3a, 0x5d8a44, 0x6b8f4a, 0x41683a, 0x7d9a5a][Math.floor(rand() * 5)];
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), M.leaf(col));
    m.position.copy(W(x, y, base + s * 0.6)); m.scale.y = 0.75; m.rotation.y = rand() * 6; m.castShadow = true; g.add(m);
  };
  const grass = (x, y, base) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 5), M.leaf([0xb5a76a, 0x9aa25e, 0xc2b47a][Math.floor(rand() * 3)]));
    m.position.copy(W(x, y, base + 0.27)); m.castShadow = true; g.add(m);
  };
  const tree = (x, y, base) => {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 2.4, 6), M.solid(0x5a4632, 0.9));
    trunk.position.copy(W(x, y, base + 1.2)); trunk.castShadow = true; g.add(trunk);
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 + rand() * 0.6, 1), M.leaf([0x46703a, 0x55803f, 0x3d6634][i % 3]));
      c.position.copy(W(x + (rand() - 0.5) * 1.4, y + (rand() - 0.5) * 1.4, base + 3 + rand() * 0.9)); c.castShadow = true; g.add(c);
    }
  };

  for (const f of feats) {
    const e = f.elevation || 0;
    switch (f.type) {
      case 'lawn': case 'garden': {
        g.add(flat(f.polygon, e - 0.03, M.grass(), poolHolesIn(f.polygon)));
        floors.push({ poly: f.polygon, holes: [], h: e - 0.03, kind: 'feature', f });
        if (f.type === 'garden') {
          // shrubs scattered along the edges, a couple of trees in far corners
          for (let i = 0; i < f.polygon.length; i++) {
            const a = f.polygon[i], b = f.polygon[(i + 1) % f.polygon.length];
            const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const inward = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
            for (let s = 0.6; s < L - 0.4; s += 0.9 + rand() * 0.8) {
              const d = 0.45 + rand() * 0.5;
              const p = [a[0] + ((b[0] - a[0]) * s) / L + inward[0] * d, a[1] + ((b[1] - a[1]) * s) / L + inward[1] * d];
              if (!pointInPolygon(p, f.polygon) || blocked(p)) continue;
              rand() > 0.45 ? shrub(p[0], p[1], e, 0.3 + rand() * 0.35) : grass(p[0], p[1], e);
            }
          }
          const fb = bbox(f.polygon);
          const corners = [[fb.minX + 1.6, fb.maxY - 1.6], [fb.maxX - 1.6, fb.maxY - 1.6]];
          for (const c of corners) if (pointInPolygon(c, f.polygon) && !blocked(c)) { tree(c[0], c[1], e); addSeg([c[0] - 0.1, c[1]], [c[0] + 0.1, c[1]], 0.12, e, e + 3, 'tree'); }
        }
        break;
      }
      case 'patio': case 'paving': case 'driveway': {
        const top = f.type === 'patio' ? e - 0.008 : e - 0.015;
        g.add(slab(f.polygon, top, 0.06, [featureMaterial(f), M.concrete()], poolHolesIn(f.polygon)));
        floors.push({ poly: f.polygon, holes: [], h: top, kind: 'feature', f });
        break;
      }
      case 'deck': {
        const top = e > 0 ? e : 0.04;
        const m = slab(f.polygon, top, top + 0.06, [M.timberDeck(), M.solid(0x4a3a2c, 0.9)], poolHolesIn(f.polygon));
        g.add(m);
        floors.push({ poly: f.polygon, holes: [], h: top, kind: 'feature', f });
        break;
      }
      case 'planter': {
        const h = f.height || 0.4;
        const inner = offsetPolygon(f.polygon, -0.1);
        g.add(slab(f.polygon, e + h, h + 0.05, [M.plaster(), M.plaster()], [inner]));
        g.add(flat(inner, e + h - 0.08, M.soil()));
        floors.push({ poly: f.polygon, holes: [], h: e + h, kind: 'feature', f });
        const fb = bbox(inner);
        const along = fb.w >= fb.h;
        const L = along ? fb.w : fb.h;
        for (let s = 0.4; s < L - 0.2; s += 0.7 + rand() * 0.5) {
          const p = along ? [fb.minX + s, fb.cy + (rand() - 0.5) * fb.h * 0.5] : [fb.cx + (rand() - 0.5) * fb.w * 0.5, fb.minY + s];
          if (!pointInPolygon(p, inner)) continue;
          rand() > 0.5 ? shrub(p[0], p[1], e + h - 0.08, 0.3 + rand() * 0.3) : grass(p[0], p[1], e + h - 0.08);
        }
        break;
      }
      case 'pool': {
        const depth = f.depth || 1.5;
        const water = e - 0.12;
        // walls + floor
        const P = f.polygon;
        for (let i = 0; i < P.length; i++) {
          const a = P[i], b = P[(i + 1) % P.length];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
          const wall = { start: a, ux, uy };
          // pool polygon is CCW, so its outside is to the right; put the tile skin just outside the edge
          const m = wallBox(wall, -0.1, L + 0.1, e - depth - 0.1, e + 0.0, 0.1, M.poolTile(), -0.05);
          m.receiveShadow = true; g.add(m);
          addSeg(a, b, 0.05, e - depth, e + 0.6, 'pool-edge');
        }
        g.add(flat(P, e - depth, M.poolTile()));
        const wm = flat(P, water, M.water()); wm.renderOrder = 3; g.add(wm);
        // coping
        const copeW = 0.3;
        g.add(slab(offsetPolygon(P, copeW), e + 0.03, 0.08, [M.coping(), M.coping()], [P]));
        floors.push({ poly: offsetPolygon(P, copeW), holes: [P], h: e + 0.03, kind: 'feature', f: { ...f, name: f.name } });
        floors.push({ poly: P, holes: [], h: e - depth, kind: 'pool', f });
        break;
      }
      case 'boundary_wall': case 'fence': {
        const pts = f.polygon;
        // Two encodings: a thin footprint rectangle (Rev B style: the wall's plan outline) or a
        // centreline polyline/loop (fallback: auto gate gaps where a driveway/path crosses it).
        const segs = [];
        const edgeL = pts.map((p, i) => Math.hypot(pts[(i + 1) % pts.length][0] - p[0], pts[(i + 1) % pts.length][1] - p[1]));
        const footprint = f.closed && pts.length === 4 && Math.min(...edgeL) <= 0.6 && Math.abs(polygonArea(pts)) / Math.max(...edgeL) <= 0.6;
        if (footprint) {
          const k = edgeL[0] <= edgeL[1] ? 0 : 1; // edges k and k+2 are the short ends
          const m = (i) => [(pts[i][0] + pts[(i + 1) % 4][0]) / 2, (pts[i][1] + pts[(i + 1) % 4][1]) / 2];
          segs.push({ a: m(k), b: m(k + 2), t: edgeL[k], footprint: true });
        } else {
          const n = f.closed ? pts.length : pts.length - 1;
          for (let i = 0; i < n; i++) segs.push({ a: pts[i], b: pts[(i + 1) % pts.length], t: f.thickness || 0.23 });
        }
        const gates = feats.filter((x) => ['driveway', 'paving', 'patio'].includes(x.type));
        for (const sg of segs) {
          const a = sg.a, b = sg.b;
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (L < 0.05) continue;
          const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
          // gaps where a driveway/path meets this boundary line (centreline encoding only)
          const cuts = [];
          if (!sg.footprint) for (const gf of gates) {
            const near = gf.polygon.filter((p) => Math.abs((p[0] - a[0]) * -uy + (p[1] - a[1]) * ux) < 0.3);
            if (near.length < 2) continue;
            const ts = near.map((p) => (p[0] - a[0]) * ux + (p[1] - a[1]) * uy);
            const lo = Math.max(0, Math.min(...ts)), hi = Math.min(L, Math.max(...ts));
            if (hi - lo > 0.3) cuts.push([lo, hi]);
          }
          cuts.sort((p, q) => p[0] - q[0]);
          const pieces = []; let c = 0;
          for (const [lo, hi] of cuts) { if (lo > c) pieces.push([c, lo]); c = Math.max(c, hi); }
          if (c < L) pieces.push([c, L]);
          if (cuts.length && !f._gateWarned) { f._gateWarned = true; plan.warnings.push(`${f.type} ${f.id}: left open where ${cuts.length} driveway/path crossing(s) meet it`); }
          const wall = { start: a, ux, uy };
          for (const [p0, p1] of pieces) {
            if (f.type === 'boundary_wall') {
              const t = sg.t;
              const eA = sg.footprint ? 0 : t / 2; // footprints are already the full outline
              g.add(wallBox(wall, p0 - (p0 === 0 ? eA : 0), p1 + (p1 === L ? eA : 0), e - 0.07, e + f.height, t, [M.plaster(), M.plaster(), M.plaster(), M.plaster(), M.plaster(), M.plaster()]));
              g.add(wallBox(wall, p0 - (p0 === 0 ? eA : 0) - 0.02, p1 + (p1 === L ? eA : 0) + 0.02, e + f.height, e + f.height + 0.04, t + 0.04, M.charcoal()));
              // piers every ~3 m
              for (let s = p0; s <= p1 + 0.01; s += Math.max(0.5, (p1 - p0) / Math.max(1, Math.round((p1 - p0) / 3)))) { const sc = Math.min(Math.max(s, p0 + 0.17), p1 - 0.17); if (p1 - p0 >= 0.34) g.add(wallBox(wall, sc - 0.17, sc + 0.17, e - 0.07, e + f.height + 0.06, t + 0.1, M.plaster())); }
              addSeg([a[0] + ux * p0, a[1] + uy * p0], [a[0] + ux * p1, a[1] + uy * p1], t / 2, e - 1, e + f.height, 'boundary');
            } else {
              const hgt = f.height;
              for (let s = p0; s <= p1 + 0.01; s += 2) g.add(wallBox(wall, s - 0.04, s + 0.04, e - 0.07, e + hgt, 0.08, M.solid(0x4a3a2c, 0.9)));
              for (let k = 0; k < 5; k++) { const z = e + 0.15 + (k * (hgt - 0.25)) / 4; g.add(wallBox(wall, p0, p1, z, z + 0.12, 0.03, M.timberDeck())); }
              addSeg([a[0] + ux * p0, a[1] + uy * p0], [a[0] + ux * p1, a[1] + uy * p1], 0.05, e - 1, e + hgt, 'fence');
            }
          }
        }
        break;
      }
    }
  }
  return { bb };
}

// ---------- furniture placeholders (local frame: x = width, front faces -z, back at +z)
export function makeFurniture(f) {
  const g = new THREE.Group(); g.userData.furniture = f;
  const [w, d, h] = f.size;
  const B = (x, y, z, sx, sy, sz, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y + sy / 2, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const legs = (top, inset, lw = 0.04, mat = M.solid(0x3a3a3a, 0.5, 0.4)) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(sx * (w / 2 - inset), 0, sz * (d / 2 - inset), lw, top, lw, mat); };
  const wood = M.solid(0xa47c55, 0.6), white = M.solid(0xf4f4f2, 0.35), dark = M.solid(0x2f3033, 0.5);
  const t = f.type;
  if (t.startsWith('bed')) {
    // everything stays inside the footprint so a bed placed flush against a wall doesn't clip into it
    const hb = 0.08, bd = d - hb, bz = -hb / 2;
    B(0, 0, bz, w, 0.28, bd, M.solid(0x8b7b6b, 0.8));
    B(0, 0.28, bz + 0.02, w - 0.04, 0.2, bd - 0.06, white);
    B(0, 0.48, bz - bd * 0.12, w - 0.02, 0.06, bd * 0.7, M.fabric(0x7b8fa6));
    const np = w > 1.2 ? 2 : 1;
    for (let i = 0; i < np; i++) B(np === 1 ? 0 : (i ? 1 : -1) * w / 4, 0.48, d / 2 - hb - 0.22, np === 1 ? w * 0.7 : w / 2 - 0.08, 0.12, 0.35, M.fabric(0xeeeae2));
    B(0, 0, d / 2 - hb / 2, w, 1.05, hb, M.solid(0x5b4636, 0.7));
  } else if (t === 'sofa' || t === 'armchair') {
    const fab = M.fabric(0x8c8f93);
    B(0, 0.08, 0, w, 0.36, d, fab);
    B(0, 0.44, d / 2 - 0.1, w, 0.4, 0.2, fab);
    for (const s of [-1, 1]) B(s * (w / 2 - 0.09), 0.08, 0, 0.18, 0.52, d, fab);
    const n = Math.max(1, Math.round((w - 0.36) / 0.7));
    for (let i = 0; i < n; i++) B(-w / 2 + 0.18 + (i + 0.5) * ((w - 0.36) / n), 0.44, -0.05, (w - 0.36) / n - 0.03, 0.1, d - 0.3, M.fabric(0x9a9da1));
    legs(0.08, 0.08, 0.05);
  } else if (t === 'dining_table' || t === 'table' || t === 'coffee_table' || t === 'desk') {
    B(0, h - 0.04, 0, w, 0.04, d, wood);
    legs(h - 0.04, 0.06, 0.05);
    const chair = (x, z, rot) => {
      const c = new THREE.Group();
      const add = (px, py, pz, sx, sy, sz, m) => { const mm = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); mm.position.set(px, py + sy / 2, pz); mm.castShadow = true; c.add(mm); };
      add(0, 0.43, 0, 0.44, 0.04, 0.44, M.solid(0x4a4a4a, 0.6)); add(0, 0.47, 0.2, 0.44, 0.42, 0.04, M.solid(0x4a4a4a, 0.6));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(sx * 0.19, 0, sz * 0.19, 0.03, 0.43, 0.03, dark);
      c.position.set(x, 0, z); c.rotation.y = rot; g.add(c);
    };
    if (t === 'dining_table') {
      const per = Math.max(1, Math.floor(w / 0.65));
      for (let i = 0; i < per; i++) { const x = -w / 2 + (i + 0.5) * (w / per); chair(x, -d / 2 - 0.15, Math.PI); chair(x, d / 2 + 0.15, 0); }
    } else if (t === 'desk') chair(0, -d / 2 - 0.3, Math.PI);
  } else if (t === 'kitchen_counter' || t === 'counter' || t === 'island') {
    B(0, 0, 0.0, w - 0.02, 0.1, d - 0.08, dark);
    B(0, 0.1, 0, w, h - 0.14, d, white);
    B(0, h - 0.04, 0, w + 0.02, 0.04, d + 0.03, M.solid(0x3b3d40, 0.25));
    const n = Math.max(1, Math.round(w / 0.6));
    for (let i = 1; i < n; i++) B(-w / 2 + (i * w) / n, 0.12, -d / 2 - 0.002, 0.006, h - 0.2, 0.004, M.solid(0xcfcfcf, 0.5));
    if (t === 'island') for (let i = 0; i < Math.max(1, Math.floor(w / 0.7)); i++) { const x = -w / 2 + (i + 0.5) * (w / Math.max(1, Math.floor(w / 0.7))); B(x, 0, d / 2 + 0.35, 0.36, 0.65, 0.36, M.solid(0x6d5a48, 0.7)); }
    else if (w > 1.6) { B(w * 0.15, h - 0.02, -0.02, 0.5, 0.025, 0.38, M.solid(0x9aa0a6, 0.2, 0.8)); }
  } else if (t === 'toilet') {
    B(0, 0, -0.05, 0.36, 0.4, 0.5, white);
    B(0, 0.4, -0.05, 0.38, 0.04, 0.48, white);
    B(0, 0, d / 2 - 0.1, 0.38, 0.8, 0.18, white);
  } else if (t === 'basin' || t === 'vanity') {
    B(0, 0, 0, w, h - 0.08, d, wood);
    B(0, h - 0.08, 0, w + 0.02, 0.08, d + 0.02, white);
    B(0, 0.9, d / 2 - 0.02, Math.min(0.6, w), 0.7, 0.02, M.solid(0xcfe3ea, 0.05, 0.9));
  } else if (t === 'shower') {
    B(0, 0, 0, w, 0.05, d, white);
    const gl = M.glass();
    const p1 = B(0, 0.05, -d / 2 + 0.01, w, h - 0.05, 0.01, gl); p1.castShadow = false;
    const p2 = B(-w / 2 + 0.01, 0.05, 0, 0.01, h - 0.05, d, gl); p2.castShadow = false;
    B(0, h - 0.15, d / 2 - 0.15, 0.2, 0.02, 0.2, M.solid(0xbfc3c7, 0.2, 0.9));
  } else if (t === 'bath') {
    B(0, 0, 0, w, h, d, white);
    B(0, h - 0.01, 0, w - 0.15, 0.015, d - 0.15, M.solid(0xbfe0ea, 0.1));
  } else if (t === 'wardrobe' || t === 'bookshelf' || t === 'fridge') {
    B(0, 0, 0, w, h, d, t === 'fridge' ? M.solid(0xd9dadb, 0.3, 0.6) : M.solid(0xe8e2d6, 0.6));
    const n = Math.max(1, Math.round(w / 0.5));
    for (let i = 1; i < n; i++) B(-w / 2 + (i * w) / n, 0.02, -d / 2 - 0.003, 0.008, h - 0.04, 0.004, M.solid(0x9a9286, 0.6));
  } else if (t === 'tv_unit') {
    B(0, 0, 0, w, h, d, M.solid(0x5b4636, 0.6));
    B(0, h + 0.05, d / 2 - 0.1, Math.min(1.4, w * 0.8), 0.8, 0.05, M.solid(0x111111, 0.2, 0.3));
  } else if (t === 'car') {
    const paint = M.solid(0x8d99a6, 0.3, 0.7), glassC = M.solid(0x22303c, 0.06, 0.7);
    B(0, 0.22, 0, w, 0.5, d, paint);                         // body
    B(0, 0.72, 0.25, w - 0.16, 0.08, d * 0.5, paint);         // belt line
    // tapered glasshouse: trapezoid profile (z, y) extruded across the width
    const prof = new THREE.Shape([new THREE.Vector2(-d * 0.24, 0), new THREE.Vector2(d * 0.3, 0), new THREE.Vector2(d * 0.2, 0.44), new THREE.Vector2(-d * 0.08, 0.44)]);
    const cab = new THREE.ExtrudeGeometry(prof, { depth: w - 0.22, bevelEnabled: false });
    cab.rotateY(Math.PI / 2); cab.translate(-(w - 0.22) / 2, 0.8, 0.1);
    const cm = new THREE.Mesh(cab, glassC); cm.castShadow = true; g.add(cm);
    B(0, 1.24, 0.1 + d * 0.06, w - 0.26, 0.04, d * 0.27, paint);  // roof panel
    for (const sx of [-1, 1]) { B(sx * (w / 2 - 0.25), 0.5, -d / 2 - 0.005, 0.3, 0.1, 0.01, M.solid(0xf2f2e8, 0.2)); B(sx * (w / 2 - 0.25), 0.5, d / 2 + 0.005, 0.3, 0.08, 0.01, M.solid(0xa01818, 0.3)); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14), M.solid(0x151515, 0.8)); wh.rotation.z = Math.PI / 2; wh.position.set(sx * (w / 2 - 0.1), 0.32, sz * (d / 2 - 0.75)); wh.castShadow = true; g.add(wh); }
  } else if (t === 'plant') {
    B(0, 0, 0, 0.35, 0.35, 0.35, M.solid(0x8a6f5a, 0.8));
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), M.leaf(0x4f7a3a)); m.position.y = 0.75; m.castShadow = true; g.add(m);
  } else {
    B(0, 0, 0, w, h, d, M.solid(0xb0a898, 0.7));
  }
  return g;
}
