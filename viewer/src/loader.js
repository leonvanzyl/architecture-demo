// Tolerant plan loader: takes a plan JSON (canonical format: plan-schema.json,
// shared with the Architect bot) and returns a normalised plan with every
// optional field filled in, plus a list of warnings for anything it adapted.
import { ensureCCW, orientedRect, convexOverlap, pointInPolygon, centroid, distToSegment } from './geom.js';

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : d);
const pick = (o, keys, d) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k]; return d; };

function toPoint(p) {
  if (Array.isArray(p) && p.length >= 2) return [num(p[0], 0), num(p[1], 0)];
  if (p && typeof p === 'object') return [num(pick(p, ['x', 'X', 0]), 0), num(pick(p, ['y', 'Y', 'z', 1]), 0)];
  return null;
}
function toPolygon(poly) {
  if (!Array.isArray(poly)) return null;
  const pts = poly.map(toPoint).filter(Boolean);
  // drop a closing duplicate point
  if (pts.length > 3) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) pts.pop();
  }
  return pts.length >= 3 ? pts : null;
}

const OPENING_TYPES = { door: 'door', sliding_door: 'sliding_door', slidingdoor: 'sliding_door', slider: 'sliding_door', sliding: 'sliding_door', stacking_door: 'sliding_door', garage_door: 'garage_door', garagedoor: 'garage_door', garage: 'garage_door', window: 'window', opening: 'opening', arch: 'opening', archway: 'opening', void: 'opening' };
const OPENING_DEFAULTS = { door: [2.1, 0], sliding_door: [2.1, 0], garage_door: [2.1, 0], window: [1.2, 0.9], opening: [2.1, 0] };
const FEATURE_TYPES = { pool: 'pool', swimming_pool: 'pool', garden: 'garden', lawn: 'lawn', grass: 'lawn', patio: 'patio', deck: 'deck', decking: 'deck', paving: 'paving', path: 'paving', pavers: 'paving', driveway: 'driveway', planter: 'planter', flowerbed: 'planter', bed: 'planter', boundary_wall: 'boundary_wall', wall: 'boundary_wall', boundary: 'boundary_wall', fence: 'fence' };
export const FURNITURE_SIZES = {
  bed_double: [1.6, 2.0, 0.5], bed_queen: [1.52, 2.0, 0.5], bed_king: [1.83, 2.0, 0.5], bed_single: [0.92, 1.9, 0.5], bed: [1.6, 2.0, 0.5],
  sofa: [2.2, 0.9, 0.8], armchair: [0.85, 0.85, 0.8], dining_table: [1.8, 0.9, 0.75], table: [1.2, 0.8, 0.75], coffee_table: [1.1, 0.6, 0.42],
  kitchen_counter: [2.4, 0.6, 0.9], counter: [2.4, 0.6, 0.9], island: [2.0, 0.9, 0.9], toilet: [0.4, 0.68, 0.78], basin: [0.6, 0.45, 0.85], vanity: [0.9, 0.5, 0.85],
  shower: [0.9, 0.9, 2.0], bath: [1.7, 0.75, 0.55], wardrobe: [1.8, 0.6, 2.2], desk: [1.2, 0.6, 0.75], tv_unit: [1.8, 0.4, 0.5], car: [1.8, 4.4, 1.5],
  fridge: [0.7, 0.7, 1.8], chair: [0.5, 0.5, 0.9], bookshelf: [1.0, 0.35, 1.9], plant: [0.5, 0.5, 1.2], lounger: [0.7, 1.9, 0.35],
};
// Items that normally stand with their back against a wall.
const WALL_HUGGERS = new Set(['bed_double', 'bed_queen', 'bed_king', 'bed_single', 'bed', 'kitchen_counter', 'counter', 'toilet', 'basin', 'vanity', 'wardrobe', 'desk', 'tv_unit', 'fridge', 'bookshelf', 'bath']);

function slug(s) { return String(s || '').trim().toLowerCase().replace(/[\s-]+/g, '_'); }

function parseDirection(d, warn, id) {
  if (typeof d === 'number' || (typeof d === 'string' && isFinite(+d))) return ((+d % 360) + 360) % 360;
  const s = slug(d);
  const map = { n: 0, north: 0, '+y': 0, y: 0, up: 0, e: 90, east: 90, '+x': 90, x: 90, right: 90, s: 180, south: 180, '-y': 180, down: 180, w: 270, west: 270, '-x': 270, left: 270 };
  if (s in map) return map[s];
  if (Array.isArray(d) && d.length >= 2) return ((Math.atan2(d[0], d[1]) * 180) / Math.PI + 360) % 360;
  warn(`stairs ${id}: unknown direction ${JSON.stringify(d)}, using 0 (north)`);
  return 0;
}

export function normalizePlan(raw) {
  const warnings = [];
  const warn = (m) => warnings.push(m);
  if (typeof raw === 'string') raw = JSON.parse(raw);
  if (!raw || typeof raw !== 'object') throw new Error('Plan must be a JSON object');
  // Some exporters wrap the plan: { plan: {...} }
  if (!raw.walls && raw.plan && typeof raw.plan === 'object') raw = raw.plan;

  const meta = Object.assign({ name: 'Untitled plan', units: 'm', northAngleDeg: 0 }, raw.meta || {});
  if (!raw.meta) warn('meta missing; using defaults');
  let scale = 1;
  const u = slug(meta.units);
  if (u === 'mm') scale = 0.001; else if (u === 'cm') scale = 0.01; else if (u === 'ft' || u === 'feet') scale = 0.3048;
  if (scale !== 1) warn(`units "${meta.units}" converted to metres`);
  const S = (v) => (typeof v === 'number' ? v * scale : v);
  const SP = (p) => (p ? [p[0] * scale, p[1] * scale] : p);
  const SPoly = (poly) => (poly ? poly.map(SP) : poly);

  // ---- levels
  let levelsRaw = pick(raw, ['levels', 'floors', 'storeys', 'stories'], null);
  if (!Array.isArray(levelsRaw) || !levelsRaw.length) { levelsRaw = [{ id: 'ground', name: 'Ground floor', elevation: 0 }]; warn('no levels given; assuming a single ground level'); }
  const levels = levelsRaw.map((l, i) => {
    const id = String(pick(l, ['id', 'name'], `L${i}`));
    const height = S(num(pick(l, ['height', 'ceilingHeight', 'ceiling_height']), 2.7 / scale));
    const slab = S(num(pick(l, ['slabThickness', 'slab_thickness', 'slab']), 0.2 / scale));
    let elevation = num(pick(l, ['elevation', 'z', 'ffl']), NaN);
    elevation = isNaN(elevation) ? null : S(elevation);
    return { id, name: String(pick(l, ['name'], id)), elevation, height, slabThickness: slab, index: i };
  });
  levels.forEach((l, i) => {
    if (l.elevation === null) {
      l.elevation = i === 0 ? 0 : levels[i - 1].elevation + levels[i - 1].height + levels[i - 1].slabThickness;
      warn(`level ${l.id}: elevation missing, assumed ${l.elevation.toFixed(2)} m`);
    }
  });
  levels.sort((a, b) => a.elevation - b.elevation);
  levels.forEach((l, i) => (l.index = i));
  const levelById = new Map();
  levels.forEach((l) => { levelById.set(l.id, l); levelById.set(slug(l.id), l); levelById.set(slug(l.name), l); });
  const resolveLevel = (ref, what) => {
    if (ref === undefined || ref === null) return levels[0];
    if (typeof ref === 'number' && levels[ref]) return levels[ref];
    const l = levelById.get(String(ref)) || levelById.get(slug(ref));
    if (!l) { warn(`${what}: unknown level "${ref}", using ${levels[0].id}`); return levels[0]; }
    return l;
  };

  // ---- walls
  const walls = [];
  const wallById = new Map();
  (raw.walls || []).forEach((w, i) => {
    const id = String(pick(w, ['id'], `wall${i}`));
    const start = SP(toPoint(pick(w, ['start', 'from', 'a', 'p1'])));
    const end = SP(toPoint(pick(w, ['end', 'to', 'b', 'p2'])));
    if (!start || !end) { warn(`wall ${id}: missing start/end, skipped`); return; }
    const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (len < 0.01) { warn(`wall ${id}: zero length, skipped`); return; }
    const level = resolveLevel(w.level, `wall ${id}`);
    const exterior = pick(w, ['exterior', 'external', 'isExterior'], undefined);
    let thickness = num(pick(w, ['thickness', 'width', 't']), NaN);
    const ext = exterior === undefined ? (isNaN(thickness) ? false : thickness * scale >= 0.2) : !!exterior;
    thickness = isNaN(thickness) ? (ext ? 0.23 : 0.11) : S(thickness);
    const height = S(num(pick(w, ['height', 'h']), NaN));
    const wall = { id, level: level.id, start, end, thickness, height: isNaN(height) ? level.height : height, heightGiven: !isNaN(height), exterior: ext, material: w.material || null, length: len };
    if (wallById.has(id)) warn(`wall id ${id} duplicated; later one renamed ${id}_${i}`), (wall.id = `${id}_${i}`);
    walls.push(wall); wallById.set(wall.id, wall);
  });

  // ---- openings
  const openings = [];
  (raw.openings || []).forEach((o, i) => {
    const id = String(pick(o, ['id'], `opening${i}`));
    const wall = wallById.get(String(pick(o, ['wall', 'wallId', 'wall_id'])));
    if (!wall) { warn(`opening ${id}: wall "${o.wall}" not found, skipped`); return; }
    let type = OPENING_TYPES[slug(o.type)] || (slug(o.type).includes('window') ? 'window' : slug(o.type).includes('door') ? 'door' : null);
    if (!type) { warn(`opening ${id}: unknown type "${o.type}", treated as door`); type = 'door'; }
    const width = S(num(o.width, type === 'window' ? 1.2 / scale : 0.9 / scale));
    let offset = S(num(pick(o, ['offset', 'position', 'distance']), NaN));
    if (isNaN(offset)) { offset = (wall.length - width) / 2; warn(`opening ${id}: offset missing, centred on wall`); }
    // Optional extension: offsetFrom "center" means offset is to the opening centre.
    if (/^cent/.test(slug(o.offsetFrom || o.offsetRef || ''))) offset -= width / 2;
    let w = width;
    if (offset < 0) { warn(`opening ${id}: offset < 0, clamped`); offset = 0; }
    if (offset + w > wall.length + 1e-6) { warn(`opening ${id}: runs past end of wall ${wall.id} (${(offset + w).toFixed(2)} > ${wall.length.toFixed(2)} m), clamped`); w = Math.max(0.1, wall.length - offset); }
    const [dh, ds] = OPENING_DEFAULTS[type];
    let sill = S(num(pick(o, ['sill', 'sillHeight', 'sill_height']), ds / scale));
    let height = S(num(o.height, dh / scale));
    if (sill + height > wall.height - 0.02) { warn(`opening ${id}: top (${(sill + height).toFixed(2)} m) above wall height ${wall.height}, trimmed`); height = Math.max(0.2, wall.height - 0.02 - sill); }
    openings.push({ id, wall: wall.id, type, offset, width: w, height, sill, swing: o.swing || 'none' });
  });
  // overlap check per wall
  const byWall = new Map();
  openings.forEach((o) => { if (!byWall.has(o.wall)) byWall.set(o.wall, []); byWall.get(o.wall).push(o); });
  for (const [wid, list] of byWall) {
    list.sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < list.length; i++) if (list[i].offset < list[i - 1].offset + list[i - 1].width - 1e-6) warn(`openings ${list[i - 1].id} and ${list[i].id} overlap on wall ${wid}`);
  }

  // ---- rooms
  const rooms = [];
  (raw.rooms || raw.spaces || []).forEach((r, i) => {
    const id = String(pick(r, ['id'], `room${i}`));
    const poly = SPoly(toPolygon(pick(r, ['polygon', 'outline', 'points', 'boundary'])));
    if (!poly) { warn(`room ${id}: no valid polygon, skipped`); return; }
    const level = resolveLevel(r.level, `room ${id}`);
    const type = slug(r.type || '');
    const outdoorDefault = ['patio', 'veranda', 'stoep', 'deck', 'balcony', 'porch', 'carport'].includes(type);
    rooms.push({
      id, level: level.id, name: String(r.name || id), type,
      polygon: ensureCCW(poly),
      floorMaterial: slug(pick(r, ['floorMaterial', 'floor_material', 'floor', 'material'], type === 'garage' ? 'concrete' : 'tile')),
      outdoor: r.outdoor === undefined ? outdoorDefault : !!r.outdoor,
    });
  });
  if (!rooms.length) warn('no rooms: floors will only be drawn from wall footprints');

  // ---- stairs
  const stairs = [];
  (raw.stairs || []).forEach((s, i) => {
    const id = String(pick(s, ['id'], `stair${i}`));
    const from = resolveLevel(pick(s, ['fromLevel', 'from_level', 'from', 'level']), `stairs ${id}`);
    const toRef = pick(s, ['toLevel', 'to_level', 'to']);
    const to = toRef === undefined ? levels[from.index + 1] : resolveLevel(toRef, `stairs ${id}`);
    if (!to || to === from) { warn(`stairs ${id}: no target level, skipped`); return; }
    const start = SP(toPoint(s.start));
    if (!start) { warn(`stairs ${id}: no start, skipped`); return; }
    const rise = to.elevation - from.elevation;
    const run = S(num(pick(s, ['run', 'length']), (rise / 0.175) * 0.25 / scale));
    const steps = Math.max(2, Math.round(num(s.steps, Math.round(Math.abs(rise) / 0.175))));
    stairs.push({ id, fromLevel: from.id, toLevel: to.id, start, direction: parseDirection(s.direction ?? 0, warn, id), width: S(num(s.width, 0.9 / scale)), run, steps, rise });
  });

  // ---- roof
  const r = raw.roof || {};
  if (!raw.roof) warn('no roof given; using a flat roof');
  let rtype = slug(r.type || 'flat');
  if (!['gable', 'hip', 'flat', 'skillion', 'none'].includes(rtype)) { warn(`roof type "${r.type}" not supported, using gable`); rtype = 'gable'; }
  const roofMaterial = r.material || null;
  const overhang = S(num(r.overhang, 0.6 / scale));
  const roof = {
    type: rtype,
    pitchDeg: num(pick(r, ['pitchDeg', 'pitch', 'pitch_deg', 'slope']), rtype === 'flat' ? 2 : 30),
    overhang,
    ridgeDirection: r.ridgeDirection ? slug(r.ridgeDirection).replace('+', '') : null,
    material: roofMaterial,
    outline: r.outline ? ensureCCW(SPoly(toPolygon(r.outline)) || []) : null,
    // Viewer extension: flat roofs get a parapet unless parapet:false or a real overhang is given.
    parapetHeight: r.parapet === false ? 0 : S(num(pick(r, ['parapetHeight', 'parapet_height']), rtype === 'flat' && (overhang <= 0.15 || /parapet/i.test(roofMaterial || '')) ? 0.45 / scale : 0)),
  };
  if (roof.outline && roof.outline.length < 3) roof.outline = null;

  // ---- site
  const site = { boundary: null, features: [] };
  if (raw.site) {
    site.boundary = SPoly(toPolygon(raw.site.boundary));
    (raw.site.features || []).forEach((f, i) => {
      const id = String(pick(f, ['id'], `feature${i}`));
      const type = FEATURE_TYPES[slug(f.type)];
      const poly = SPoly(toPolygon(f.polygon || f.outline || f.points));
      if (!type) { warn(`site feature ${id}: unknown type "${f.type}", skipped`); return; }
      if (!poly) { warn(`site feature ${id}: no polygon, skipped`); return; }
      const defH = { boundary_wall: 1.8, fence: 1.2, planter: 0.4 }[type];
      site.features.push({
        id, type, name: f.name || id,
        polygon: type === 'boundary_wall' || type === 'fence' ? poly : ensureCCW(poly),
        closed: f.closed !== false,
        elevation: S(num(f.elevation, 0)),
        depth: S(num(f.depth, type === 'pool' ? 1.5 / scale : 0)),
        height: S(num(f.height, defH !== undefined ? defH / scale : 0)),
        material: f.material || null,
        thickness: S(num(f.thickness, type === 'fence' ? 0.08 / scale : 0.23 / scale)),
      });
    });
  }

  // ---- furniture
  const roomById = new Map(rooms.map((x) => [x.id, x]));
  const furniture = [];
  (raw.furniture || []).forEach((f, i) => {
    const type = slug(f.type || 'box');
    const position = SP(toPoint(f.position));
    if (!position) { warn(`furniture #${i} (${type}): no position, skipped`); return; }
    let room = roomById.get(String(f.room));
    if (!room) room = rooms.find((rm) => pointInPolygon(position, rm.polygon));
    const size = Array.isArray(f.size) && f.size.length >= 3 ? f.size.map((v) => S(num(v, 0.5))) : (FURNITURE_SIZES[type] || [0.8, 0.8, 0.8]).slice();
    const lvl = room ? levelById.get(room.level) : resolveLevel(f.level, `furniture ${type}`);
    furniture.push({ id: f.id || `${type}-${i}`, type, room: room ? room.id : null, level: lvl.id, position, rotation: num(f.rotation, 0), size, label: f.label || null });
  });

  const plan = { version: raw.version || '1.0', meta, levels, walls, openings, rooms, stairs, roof, site, furniture, warnings };
  adaptFurniture(plan, warn);
  return plan;
}

// Furniture fixes: back against the nearest wall (rotation convention in the
// spec: degrees CCW, at 0 the item's front faces +y), sofas face the TV, and
// long items that block a doorway are trimmed so the door stays usable.
function adaptFurniture(plan, warn) {
  const wallsBy = new Map(plan.walls.map((w) => [w.id, w]));
  const doorZones = [];
  for (const o of plan.openings) {
    if (o.type === 'window') continue;
    const w = wallsBy.get(o.wall);
    const ux = (w.end[0] - w.start[0]) / w.length, uy = (w.end[1] - w.start[1]) / w.length;
    const c = [w.start[0] + ux * (o.offset + o.width / 2), w.start[1] + uy * (o.offset + o.width / 2)];
    // clearance: opening width x (wall thickness + 0.6 m each side)
    doorZones.push({ o, level: w.level, poly: orientedRect(c[0], c[1], ux, uy, o.width / 2, w.thickness / 2 + 0.6), ux, uy, c });
  }
  const tvs = plan.furniture.filter((f) => f.type === 'tv_unit');
  for (const f of plan.furniture) {
    const room = plan.rooms.find((r) => r.id === f.room);
    let rot = (f.rotation * Math.PI) / 180;
    // front direction at rotation 0 is +y; CCW rotation
    const front = () => [-Math.sin(rot), Math.cos(rot)];
    if (f.type === 'sofa' || f.type === 'armchair') {
      const tv = tvs.find((t) => t.room === f.room);
      if (tv) {
        const fr = front();
        const to = [tv.position[0] - f.position[0], tv.position[1] - f.position[1]];
        if (fr[0] * to[0] + fr[1] * to[1] < 0) { rot += Math.PI; f.autoFlipped = true; }
      }
    } else if (WALL_HUGGERS.has(f.type) && room) {
      const fr = front();
      const halfD = f.size[1] / 2;
      const back = [f.position[0] - fr[0] * (halfD + 0.25), f.position[1] - fr[1] * (halfD + 0.25)];
      const fwd = [f.position[0] + fr[0] * (halfD + 0.25), f.position[1] + fr[1] * (halfD + 0.25)];
      const dEdge = (p) => Math.min(...room.polygon.map((a, i) => distToSegment(p, a, room.polygon[(i + 1) % room.polygon.length]).d));
      const backOut = !pointInPolygon(back, room.polygon), fwdOut = !pointInPolygon(fwd, room.polygon);
      if ((fwdOut && !backOut) || (!backOut && !fwdOut && dEdge(fwd) < dEdge(back) - 0.05)) { rot += Math.PI; f.autoFlipped = true; }
    }
    f.rotationRad = rot;
    // door clearance
    const ux = Math.cos(rot), uy = Math.sin(rot);
    for (const z of doorZones) {
      if (z.level !== f.level) continue;
      const fp = orientedRect(f.position[0], f.position[1], ux, uy, f.size[0] / 2, f.size[1] / 2);
      if (!convexOverlap(fp, z.poly)) continue;
      const trimmable = ['kitchen_counter', 'counter', 'wardrobe', 'bookshelf', 'tv_unit', 'island', 'desk'].includes(f.type);
      if (trimmable) {
        // project the door zone onto the item's long (local x) axis and keep the longer remaining piece
        const proj = z.poly.map((p) => (p[0] - f.position[0]) * ux + (p[1] - f.position[1]) * uy);
        const lo = Math.min(...proj), hi = Math.max(...proj);
        const a = -f.size[0] / 2, b = f.size[0] / 2;
        const left = Math.max(0, lo - a), right = Math.max(0, b - hi);
        const keep = left >= right ? [a, Math.min(b, lo)] : [Math.max(a, hi), b];
        const newLen = keep[1] - keep[0];
        if (newLen < 0.3) { f.removed = true; warn(`furniture ${f.id} (${f.type}) blocks opening ${z.o.id}; removed`); break; }
        const mid = (keep[0] + keep[1]) / 2;
        warn(`furniture ${f.id} (${f.type}, ${f.size[0].toFixed(2)} m) blocks opening ${z.o.id}; trimmed to ${newLen.toFixed(2)} m`);
        f.position = [f.position[0] + ux * mid, f.position[1] + uy * mid];
        f.size = [newLen, f.size[1], f.size[2]];
      } else {
        warn(`furniture ${f.id} (${f.type}) sits in the swing/clearance zone of opening ${z.o.id}`);
      }
    }
  }
  plan.furniture = plan.furniture.filter((f) => !f.removed);
}

export async function fetchPlan(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load plan ${url}: HTTP ${res.status}`);
  return normalizePlan(await res.json());
}
