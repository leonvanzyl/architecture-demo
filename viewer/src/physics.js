// Walker physics: floor height queries + 2D wall collision (circle vs thick segments).
import { pointInPolygon, distToSegment } from './geom.js';

export const EYE = 1.6, RADIUS = 0.25, STEP = 0.45, BODY_LOW = 0.3, BODY_HIGH = 1.75;

export function makeWorld(build) {
  const { floors, ramps, colliders } = build;
  function surfaces(x, y) {
    const out = [];
    for (const f of floors) {
      if (!pointInPolygon([x, y], f.poly)) continue;
      if (f.holes && f.holes.some((h) => pointInPolygon([x, y], h))) continue;
      out.push({ h: f.h, f });
    }
    for (const r of ramps) {
      const { s, from, R } = r;
      const px = x - s.start[0], py = y - s.start[1];
      const along = px * R.dx + py * R.dy;
      const across = px * -R.dy + py * R.dx;
      if (Math.abs(across) > s.width / 2 + 0.02 || along < -0.01 || along > s.run + 0.02) continue;
      const tread = s.run / s.steps;
      const h = from.elevation + s.rise * Math.min(1, Math.max(0, (along + tread * 0.6) / s.run));
      out.push({ h, ramp: r });
    }
    return out;
  }
  function floorAt(x, y, feet) {
    let best = -Infinity, info = null;
    for (const s of surfaces(x, y)) if (s.h <= feet + STEP && s.h > best) { best = s.h; info = s; }
    if (best === -Infinity) return { h: -0.06, info: null };
    return { h: best, info };
  }
  // Is there a floor we could stand on at (x,y) given current feet? (prevents walking off into holes too fast is fine)
  function collide(pos, feet) {
    const lo = feet + BODY_LOW, hi = feet + BODY_HIGH;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const c of colliders) {
        if (c.z1 <= lo || c.z0 >= hi) continue;
        const r = distToSegment([pos.x, pos.y], c.a, c.b);
        const min = c.r + RADIUS;
        if (r.d < min) {
          let nx = pos.x - r.cx, ny = pos.y - r.cy;
          let l = Math.hypot(nx, ny);
          if (l < 1e-6) { nx = -(c.b[1] - c.a[1]); ny = c.b[0] - c.a[0]; l = Math.hypot(nx, ny) || 1; }
          pos.x = r.cx + (nx / l) * min; pos.y = r.cy + (ny / l) * min;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return pos;
  }
  return { floorAt, collide, surfaces };
}
