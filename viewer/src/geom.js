// Small 2D geometry helpers. Plan coords: [x, y] metres, x east, y north.
export const EPS = 1e-6;

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2; // >0 = counter-clockwise
}

export function ensureCCW(poly) {
  return polygonArea(poly) < 0 ? poly.slice().reverse() : poly.slice();
}

export function centroid(poly) {
  let x = 0, y = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const c = x1 * y2 - x2 * y1;
    a += c; x += (x1 + x2) * c; y += (y1 + y2) * c;
  }
  if (Math.abs(a) < EPS) {
    const n = poly.length;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [x / (3 * a), y / (3 * a)];
}

export function pointInPolygon(pt, poly) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

// Offset a simple polygon outward by d (negative = inward), miter joins (clamped).
export function offsetPolygon(poly, d) {
  const p = ensureCCW(poly);
  const n = p.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    const e1 = norm([b[0] - a[0], b[1] - a[1]]);
    const e2 = norm([c[0] - b[0], c[1] - b[1]]);
    // outward normal of CCW polygon edge = (dy, -dx)
    const n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]];
    let m = [n1[0] + n2[0], n1[1] + n2[1]];
    const ml = Math.hypot(m[0], m[1]);
    if (ml < 1e-9) { out.push([b[0] + n1[0] * d, b[1] + n1[1] * d]); continue; }
    m = [m[0] / ml, m[1] / ml];
    const cos = m[0] * n1[0] + m[1] * n1[1];
    const s = d / Math.max(cos, 0.25);
    out.push([b[0] + m[0] * s, b[1] + m[1] * s]);
  }
  return out;
}

export function norm(v) {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

// Distance from point p to segment ab, plus closest point.
export function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx, cy = a[1] + t * dy;
  return { d: Math.hypot(p[0] - cx, p[1] - cy), cx, cy, t };
}

// Rectangle (oriented) as polygon from centre, half extents along unit dir u and its perpendicular.
export function orientedRect(cx, cy, ux, uy, halfLen, halfWid) {
  const vx = -uy, vy = ux;
  return [
    [cx - ux * halfLen - vx * halfWid, cy - uy * halfLen - vy * halfWid],
    [cx + ux * halfLen - vx * halfWid, cy + uy * halfLen - vy * halfWid],
    [cx + ux * halfLen + vx * halfWid, cy + uy * halfLen + vy * halfWid],
    [cx - ux * halfLen + vx * halfWid, cy - uy * halfLen + vy * halfWid],
  ];
}

// Separating-axis overlap test for two convex polygons.
export function convexOverlap(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      const ax = -(b[1] - a[1]), ay = b[0] - a[0];
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const q of A) { const v = q[0] * ax + q[1] * ay; minA = Math.min(minA, v); maxA = Math.max(maxA, v); }
      for (const q of B) { const v = q[0] * ax + q[1] * ay; minB = Math.min(minB, v); maxB = Math.max(maxB, v); }
      if (maxA <= minB + 1e-9 || maxB <= minA + 1e-9) return false;
    }
  }
  return true;
}
