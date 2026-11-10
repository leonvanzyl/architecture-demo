// 2D plan minimap with room labels and the player marker.
const FEATURE_COLORS = { pool: '#6cc3dc', garden: '#9cc07a', lawn: '#a9cc85', patio: '#d8cbb3', deck: '#b58f69', paving: '#cfcac0', driveway: '#bdb8ae', planter: '#7f9b5a' };

export class Minimap {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.onClick = null;
    canvas.addEventListener('click', (e) => {
      if (!this.onClick || !this.tf) return;
      const r = canvas.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * canvas.width, py = ((e.clientY - r.top) / r.height) * canvas.height;
      this.onClick((px - this.tf.ox) / this.tf.s, (this.tf.oy - py) / this.tf.s);
    });
  }
  setPlan(plan, bounds) {
    this.plan = plan; this.b = bounds;
    const pad = 1;
    const W = this.c.width, H = this.c.height;
    const s = Math.min(W / (bounds.w + pad * 2), H / (bounds.h + pad * 2));
    this.tf = { s, ox: (W - bounds.w * s) / 2 - bounds.minX * s, oy: H - ((H - bounds.h * s) / 2 - bounds.minY * s) };
  }
  P(x, y) { return [this.tf.ox + x * this.tf.s, this.tf.oy - y * this.tf.s]; }
  draw(levelId, player) {
    const { g, plan } = this; if (!plan) return;
    const W = this.c.width, H = this.c.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(245,243,238,0.92)'; g.fillRect(0, 0, W, H);
    const poly = (pts, fill, stroke, lw = 1) => {
      g.beginPath(); pts.forEach((p, i) => { const [x, y] = this.P(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
      if (fill) { g.fillStyle = fill; g.fill(); }
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
    };
    if (plan.site.boundary) poly(plan.site.boundary, '#ebe7df', '#b9b3a8');
    for (const f of plan.site.features) {
      if (f.type === 'boundary_wall' || f.type === 'fence') continue;
      poly(f.polygon, FEATURE_COLORS[f.type] || '#ddd', null);
    }
    const level = plan.levels.find((l) => l.id === levelId) || plan.levels[0];
    const rooms = plan.rooms.filter((r) => r.level === level.id);
    for (const r of rooms) poly(r.polygon, r.outdoor ? '#e9dcc5' : '#fffdf8', null);
    for (const s of plan.stairs.filter((s) => s.fromLevel === level.id || s.toLevel === level.id)) {
      const a = (s.direction * Math.PI) / 180, dx = Math.sin(a), dy = Math.cos(a);
      const n = s.steps;
      for (let i = 0; i <= n; i++) {
        const cx = s.start[0] + dx * (s.run * i) / n, cy = s.start[1] + dy * (s.run * i) / n;
        const [x1, y1] = this.P(cx - dy * s.width / 2, cy + dx * s.width / 2), [x2, y2] = this.P(cx + dy * s.width / 2, cy - dx * s.width / 2);
        g.strokeStyle = '#a08870'; g.lineWidth = 1; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
    }
    const opByWall = new Map();
    for (const o of plan.openings) { if (!opByWall.has(o.wall)) opByWall.set(o.wall, []); opByWall.get(o.wall).push(o); }
    for (const w of plan.walls.filter((w) => w.level === level.id)) {
      const [x1, y1] = this.P(...w.start), [x2, y2] = this.P(...w.end);
      g.strokeStyle = '#2d2d2d'; g.lineCap = 'butt'; g.lineWidth = Math.max(1.5, w.thickness * this.tf.s);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      for (const o of opByWall.get(w.id) || []) {
        const ux = (w.end[0] - w.start[0]) / w.length, uy = (w.end[1] - w.start[1]) / w.length;
        const a = this.P(w.start[0] + ux * o.offset, w.start[1] + uy * o.offset), b = this.P(w.start[0] + ux * (o.offset + o.width), w.start[1] + uy * (o.offset + o.width));
        g.strokeStyle = o.type === 'window' ? '#7fb6d8' : o.type === 'garage_door' ? '#777' : '#fffdf8';
        g.lineWidth = Math.max(1.5, w.thickness * this.tf.s) + 0.5;
        g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
      }
    }
    for (const f of plan.site.features.filter((f) => f.type === 'boundary_wall' || f.type === 'fence')) {
      g.setLineDash(f.type === 'fence' ? [3, 3] : []); poly(f.polygon, null, '#8a8478', 1.5); g.setLineDash([]);
    }
    g.fillStyle = '#333'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const fs = Math.max(8, Math.min(11, this.tf.s * 0.45));
    g.font = `${fs}px system-ui, sans-serif`;
    for (const r of rooms) {
      const xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]);
      const [x, y] = this.P((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
      const words = r.name.split(/\s+/);
      const roomW = (Math.max(...xs) - Math.min(...xs)) * this.tf.s;
      if (g.measureText(r.name).width > roomW - 4 && words.length > 1) {
        const half = Math.ceil(words.length / 2);
        g.fillText(words.slice(0, half).join(' '), x, y - fs * 0.55); g.fillText(words.slice(half).join(' '), x, y + fs * 0.55);
      } else g.fillText(r.name, x, y);
    }
    // north arrow
    g.fillStyle = '#555'; g.font = 'bold 10px system-ui'; g.fillText('N', W - 12, 12); g.beginPath(); g.moveTo(W - 12, 18); g.lineTo(W - 16, 28); g.lineTo(W - 8, 28); g.closePath(); g.fill();
    if (player) {
      const [x, y] = this.P(player.x, player.y);
      const yaw = player.yaw; // 0 = north, clockwise
      g.save(); g.translate(x, y); g.rotate(yaw);
      g.fillStyle = 'rgba(255,90,40,0.25)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 26, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); g.closePath(); g.fill();
      g.fillStyle = '#ff5a28'; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
  }
}
