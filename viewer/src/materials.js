// Procedural PBR-ish materials. All geometry uses world-space UVs in metres,
// so each texture's `size` is the real-world size (m) of one texture tile.
import * as THREE from 'three';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function canvasTex(px, draw, sizeM, { srgb = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  draw(g, px);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / sizeM[0], 1 / sizeM[1]);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noise(g, px, base, amp, seed = 1, dots = 4000, size = 2) {
  g.fillStyle = base; g.fillRect(0, 0, px, px);
  const r = rng(seed);
  for (let i = 0; i < dots; i++) {
    const v = (r() - 0.5) * amp;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(r() * px, r() * px, size * (0.5 + r()), size * (0.5 + r()));
  }
}

const cache = new Map();
function mat(key, make) { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); }

export const M = {
  plaster: () => mat('plaster', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, map: canvasTex(256, (g, p) => noise(g, p, '#efece6', 0.06, 3, 6000, 2), [1.5, 1.5]) })),
  plasterGrey: () => mat('plasterGrey', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, map: canvasTex(256, (g, p) => noise(g, p, '#c9c6bf', 0.06, 4, 6000, 2), [1.5, 1.5]) })),
  interior: () => mat('interior', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, map: canvasTex(128, (g, p) => noise(g, p, '#f3f0ea', 0.03, 5, 1500, 2), [1, 1]) })),
  ceiling: () => mat('ceiling', () => new THREE.MeshStandardMaterial({ color: 0xf7f6f2, roughness: 1, side: THREE.DoubleSide })),
  brick: () => mat('brick', () => new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.85,
    map: canvasTex(512, (g, p) => {
      // 4 bricks x 12 courses = 0.928 x 0.996 m; brick 222x73 mm, 10 mm joints
      g.fillStyle = '#b9b2a6'; g.fillRect(0, 0, p, p);
      const r = rng(7), bw = p / 4, bh = p / 12, j = Math.max(2, p * 0.01 / 0.928 * 1.1);
      const cols = ['#9c5a3c', '#a8623f', '#8e4f35', '#b06c48', '#94563a', '#a35e44', '#7f4630', '#b8774f'];
      for (let row = 0; row < 12; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let k = -1; k < 5; k++) {
          const x = k * bw + off, y = row * bh;
          g.fillStyle = cols[Math.floor(r() * cols.length)];
          g.fillRect(x + j / 2, y + j / 2, bw - j, bh - j);
          for (let s = 0; s < 40; s++) { g.fillStyle = `rgba(0,0,0,${r() * 0.12})`; g.fillRect(x + j / 2 + r() * (bw - j - 3), y + j / 2 + r() * (bh - j - 3), 3, 3); }
        }
      }
    }, [0.928, 0.996]),
  })),
  timberDeck: () => mat('timberDeck', () => new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.8,
    map: canvasTex(512, (g, p) => {
      const r = rng(11), n = 8, w = p / n; // 8 boards over 1.12 m => 140 mm boards
      g.fillStyle = '#3b2c20'; g.fillRect(0, 0, p, p);
      for (let i = 0; i < n; i++) {
        const tones = ['#8a6a4e', '#7d5f45', '#94735a', '#86664c', '#9b7a5c'];
        g.fillStyle = tones[Math.floor(r() * tones.length)];
        g.fillRect(i * w + 2, 0, w - 4, p);
        for (let s = 0; s < 60; s++) { g.strokeStyle = `rgba(40,25,15,${0.05 + r() * 0.12})`; g.lineWidth = 1; const x = i * w + 4 + r() * (w - 8); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 6, p); g.stroke(); }
        const cut = r() * p; g.fillStyle = '#3b2c20'; g.fillRect(i * w, cut, w, 3);
      }
    }, [1.12, 1.12]),
  })),
  woodFloor: () => mat('woodFloor', () => new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.55,
    map: canvasTex(512, (g, p) => {
      const r = rng(21), n = 6, w = p / n; // 6 boards over 1.2 m (200 mm)
      for (let i = 0; i < n; i++) {
        let y = -r() * p;
        while (y < p) {
          const L = p * (0.4 + r() * 0.6);
          const tones = ['#c49a6c', '#b88d5f', '#cfa679', '#b3865a', '#c79f73'];
          g.fillStyle = tones[Math.floor(r() * tones.length)]; g.fillRect(i * w, y, w, L);
          for (let s = 0; s < 25; s++) { g.strokeStyle = `rgba(90,60,30,${0.05 + r() * 0.1})`; const x = i * w + r() * w; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4, y + L); g.stroke(); }
          g.fillStyle = 'rgba(60,40,20,0.5)'; g.fillRect(i * w, y, w, 1.5);
          y += L;
        }
        g.fillStyle = 'rgba(60,40,20,0.45)'; g.fillRect(i * w, 0, 1.5, p);
      }
    }, [1.2, 1.2]),
  })),
  tile: () => mat('tile', () => new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.35,
    map: canvasTex(512, (g, p) => {
      noise(g, p, '#d9d5ce', 0.05, 31, 5000, 2);
      g.fillStyle = '#b3aea5'; const t = p / 2; // 600 mm tiles, 1.2 m texture
      for (let i = 0; i <= 2; i++) { g.fillRect(i * t - 1.5, 0, 3, p); g.fillRect(0, i * t - 1.5, p, 3); }
    }, [1.2, 1.2]),
  })),
  bathTile: () => mat('bathTile', () => new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.3,
    map: canvasTex(256, (g, p) => {
      noise(g, p, '#e8e6e1', 0.04, 41, 1500, 2);
      g.fillStyle = '#bfbab2'; const t = p / 4;
      for (let i = 0; i <= 4; i++) { g.fillRect(i * t - 1, 0, 2, p); g.fillRect(0, i * t - 1, p, 2); }
    }, [1.2, 1.2]),
  })),
  carpet: () => mat('carpet', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, map: canvasTex(256, (g, p) => noise(g, p, '#bdb2a2', 0.12, 51, 12000, 1.5), [0.8, 0.8]) })),
  concrete: () => mat('concrete', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, map: canvasTex(256, (g, p) => noise(g, p, '#a7a49e', 0.12, 61, 9000, 2), [2, 2]) })),
  pavers: () => mat('pavers', () => new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.85,
    map: canvasTex(512, (g, p) => {
      noise(g, p, '#b9b5ad', 0.1, 71, 8000, 2);
      const r = rng(72); g.fillStyle = '#8a867e';
      const rows = 8, h = p / rows; // 200 x 100 mm bricks over 0.8 m
      for (let i = 0; i < rows; i++) { g.fillRect(0, i * h - 1, p, 2); const off = i % 2 ? p / 8 : 0; for (let k = 0; k <= 4; k++) g.fillRect(k * p / 4 + off - 1, i * h, 2, h); }
      for (let s = 0; s < 30; s++) { g.fillStyle = `rgba(0,0,0,${r() * 0.08})`; g.fillRect(r() * p, r() * p, 40, 20); }
    }, [0.8, 0.8]),
  })),
  slabs: () => mat('slabs', () => new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.85,
    map: canvasTex(256, (g, p) => { noise(g, p, '#c8c4bb', 0.08, 81, 4000, 2); g.fillStyle = '#7c8a5a'; g.fillRect(0, 0, p, 10); g.fillRect(0, 0, 10, p); }, [1.0, 1.0]),
  })),
  grass: () => mat('grass', () => new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1,
    map: canvasTex(512, (g, p) => {
      noise(g, p, '#5f8a3a', 0.18, 91, 30000, 2);
      const r = rng(92);
      for (let i = 0; i < 4000; i++) { g.strokeStyle = r() > 0.5 ? 'rgba(140,180,80,0.35)' : 'rgba(40,70,25,0.35)'; const x = r() * p, y = r() * p; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 4 - r() * 5); g.stroke(); }
    }, [3, 3]),
  })),
  veld: () => mat('veld', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, map: canvasTex(256, (g, p) => noise(g, p, '#9a9a6a', 0.2, 101, 12000, 2), [6, 6]) })),
  soil: () => mat('soil', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, map: canvasTex(256, (g, p) => noise(g, p, '#5c4634', 0.2, 111, 9000, 2), [1.5, 1.5]) })),
  gravel: () => mat('gravel', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, map: canvasTex(256, (g, p) => noise(g, p, '#b2aca2', 0.35, 121, 16000, 2.5), [1, 1]) })),
  poolTile: () => mat('poolTile', () => new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.3,
    map: canvasTex(256, (g, p) => { noise(g, p, '#5fb3c9', 0.08, 131, 3000, 2); g.fillStyle = '#4b97ab'; const t = p / 8; for (let i = 0; i <= 8; i++) { g.fillRect(i * t - 1, 0, 2, p); g.fillRect(0, i * t - 1, p, 2); } }, [0.4, 0.4]),
  })),
  water: () => mat('water', () => new THREE.MeshStandardMaterial({ color: 0x2aa7c9, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.62, depthWrite: false, envMapIntensity: 1.5 })),
  coping: () => mat('coping', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, map: canvasTex(256, (g, p) => { noise(g, p, '#dcd6ca', 0.08, 141, 3000, 2); g.fillStyle = '#a9a397'; g.fillRect(0, 0, 3, p); }, [0.6, 0.6]) })),
  charcoal: () => mat('charcoal', () => new THREE.MeshStandardMaterial({ color: 0x33363a, roughness: 0.55, metalness: 0.3 })),
  aluminium: () => mat('aluminium', () => new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.4, metalness: 0.7 })),
  whiteFrame: () => mat('whiteFrame', () => new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.6 })),
  doorLeaf: () => mat('doorLeaf', () => new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.6 })),
  frontDoor: () => mat('frontDoor', () => new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.5, metalness: 0.2 })),
  garageDoor: () => mat('garageDoor', () => new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.5, metalness: 0.3,
    map: canvasTex(256, (g, p) => { g.fillStyle = '#3c3f44'; g.fillRect(0, 0, p, p); g.fillStyle = '#2b2e32'; for (let i = 0; i < 4; i++) g.fillRect(0, i * p / 4, p, 4); }, [1, 0.6]),
  })),
  glass: () => mat('glass', () => new THREE.MeshStandardMaterial({ color: 0x9fc4d6, roughness: 0.02, metalness: 0.2, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 2 })),
  roofIBR: () => mat('roofIBR', () => new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.5, metalness: 0.5,
    map: canvasTex(256, (g, p) => { g.fillStyle = '#4a4e53'; g.fillRect(0, 0, p, p); g.fillStyle = '#5c6066'; for (let i = 0; i < 4; i++) g.fillRect(i * p / 4, 0, p / 16, p); }, [0.76, 0.76]),
  })),
  roofTile: () => mat('roofTile', () => new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.8,
    map: canvasTex(256, (g, p) => { g.fillStyle = '#5a5c5e'; g.fillRect(0, 0, p, p); g.fillStyle = '#45474a'; for (let i = 0; i < 8; i++) g.fillRect(0, i * p / 8, p, 3); for (let i = 0; i < 8; i++) for (let k = 0; k < 6; k++) g.fillRect(k * p / 6 + (i % 2) * p / 12, i * p / 8, 2, p / 8); }, [1.8, 2.4]),
  })),
  slate: () => mat('slate', () => new THREE.MeshStandardMaterial({ color: 0x3f454c, roughness: 0.7 })),
  soffit: () => mat('soffit', () => new THREE.MeshStandardMaterial({ color: 0xf4f2ed, roughness: 0.9, side: THREE.DoubleSide })),
  fabric: (c) => mat('fabric' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 })),
  solid: (c, r = 0.6, m = 0) => mat(`solid${c}_${r}_${m}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m })),
  leaf: (c) => mat('leaf' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true })),
};

// Map a free-text material name from the plan onto one of ours.
export function wallMaterial(name, fallback = 'plaster') {
  const s = String(name || '').toLowerCase();
  if (/brick/.test(s)) return M.brick();
  if (/grey|gray|charcoal/.test(s)) return M.plasterGrey();
  if (/timber|wood|clad/.test(s)) return M.timberDeck();
  if (/stone|concrete|off.?shutter/.test(s)) return M.concrete();
  return fallback === 'interior' ? M.interior() : M.plaster();
}
export function floorMaterial(name, roomType) {
  const s = String(name || '').toLowerCase();
  if (/carpet/.test(s)) return M.carpet();
  if (/deck/.test(s)) return M.timberDeck();
  if (/wood|timber|laminate|oak|vinyl/.test(s)) return roomType === 'patio' ? M.timberDeck() : M.woodFloor();
  if (/concrete|screed|cement/.test(s)) return M.concrete();
  if (/paver|paving|brick/.test(s)) return M.pavers();
  if (/tile|porcelain|ceramic|stone|marble/.test(s)) return roomType === 'bathroom' ? M.bathTile() : M.tile();
  return M.tile();
}
export function featureMaterial(f) {
  const s = String(f.material || '').toLowerCase();
  if (/timber|wood|deck/.test(s)) return M.timberDeck();
  if (/slab/.test(s)) return M.slabs();
  if (/paver|brick/.test(s)) return M.pavers();
  if (/gravel|stone chip/.test(s)) return M.gravel();
  if (/concrete/.test(s)) return M.concrete();
  if (/tile/.test(s)) return M.tile();
  switch (f.type) {
    case 'deck': return M.timberDeck();
    case 'patio': return M.pavers();
    case 'paving': return M.slabs();
    case 'driveway': return M.pavers();
    case 'lawn': case 'garden': return M.grass();
    case 'planter': return M.soil();
    default: return M.concrete();
  }
}
export function roofMaterial(name, type) {
  const s = String(name || '').toLowerCase();
  if (/ibr|corrugat|iron|sheet|metal|klip/.test(s)) return M.roofIBR();
  if (/slate/.test(s)) return M.slate();
  if (/tile/.test(s)) return M.roofTile();
  return type === 'flat' ? M.roofIBR() : M.roofTile();
}
