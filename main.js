import * as THREE from 'three';
import { OrbitControls } from './OrbitControls.js';

// ---------- deterministic random ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261114);

// ---------- renderer / scene ----------
const container = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xef9f66, 45, 210);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 600);
{
  // narrow screens start farther back so the whole island fits
  const dir = new THREE.Vector3(27, 13, 30);
  const k = Math.max(1.12, Math.min(1.32 / camera.aspect, 2.2));
  camera.position.copy(dir.multiplyScalar(k)).add(new THREE.Vector3(0, -1, 6.5));
}
const DEFAULT_CAM = camera.position.clone();
const DEFAULT_TGT = new THREE.Vector3(0, -2, 6.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(DEFAULT_TGT);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 7;
controls.maxDistance = 95;
// default view polar ~1.26 rad (72 deg); vertical range: +45 deg up, down only to eye level
// (strict -45 deg would put the camera under the sea at far zoom, so down is capped at horizontal)
const POLAR_DEF = 1.26, POLAR_MIN = Math.max(POLAR_DEF - Math.PI / 4, 0.15), POLAR_MAX = Math.PI / 2 - 0.02;
controls.minPolarAngle = POLAR_MIN;
controls.maxPolarAngle = POLAR_MAX;

// ---------- lights ----------
const SUN_DIR = new THREE.Vector3(-0.5, 0.16, -0.85).normalize();
const sun = new THREE.DirectionalLight(0xffb377, 1.22);
sun.position.copy(SUN_DIR).multiplyScalar(80);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xc4aae0, 0x3e4a66, 1.28));
const fill = new THREE.DirectionalLight(0x8fa8d8, 0.55);
fill.position.set(45, 30, 55);
scene.add(fill);
// warm bounce off the sea, lights the floating underside
const bounce = new THREE.DirectionalLight(0xff9a5a, 0.5);
bounce.position.set(10, -40, 20);
scene.add(bounce);
const lampLight = new THREE.PointLight(0xffc46a, 30, 26, 1.8);
scene.add(lampLight);

// ---------- sky ----------
{
  const skyGeo = new THREE.SphereGeometry(320, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { sunDir: { value: SUN_DIR } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 sunDir;
      void main(){
        float h = vDir.y;
        vec3 top = vec3(0.15, 0.13, 0.34);
        vec3 mid = vec3(0.48, 0.30, 0.55);
        vec3 hor = vec3(0.98, 0.62, 0.32);
        vec3 col = h > 0.28 ? mix(mid, top, smoothstep(0.28, 0.85, h))
                            : mix(hor, mid, smoothstep(-0.02, 0.28, h));
        float s = max(dot(vDir, sunDir), 0.0);
        col += vec3(1.0, 0.75, 0.42) * pow(s, 220.0) * 1.6;   // sun disc
        col += vec3(1.0, 0.62, 0.30) * pow(s, 6.0) * 0.42;    // glow
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

// ---------- water ----------
const waterUniforms = { t: { value: 0 }, sunDir: { value: SUN_DIR } };
{
  const geo = new THREE.PlaneGeometry(900, 900, 90, 90);
  const mat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: `
      uniform float t; varying vec3 vPos;
      void main(){
        vec3 p = position;
        p.z += sin(p.x * 0.11 + t * 0.9) * 0.35 + sin(p.y * 0.09 + t * 1.25) * 0.3;
        vPos = (modelMatrix * vec4(p,1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float t; uniform vec3 sunDir; varying vec3 vPos;
      void main(){
        vec3 deep = vec3(0.11, 0.44, 0.60);
        vec3 lift = vec3(0.22, 0.64, 0.74);
        vec3 warm = vec3(0.95, 0.55, 0.28);
        vec3 vDir = normalize(vPos - cameraPosition);
        float towardSun = max(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0);
        float glit = pow(max(sin(vPos.x * 1.4 + t * 2.0) * sin(vPos.z * 1.1 - t * 1.6) * sin((vPos.x + vPos.z) * 0.7 + t * 0.8), 0.0), 12.0);
        float swell = pow(max(sin(vPos.x * 0.5 - t * 0.7) * sin(vPos.z * 0.45 + t * 0.9), 0.0), 6.0);
        vec3 col = mix(deep, lift, 0.35 + 0.30 * swell);
        col = mix(col, warm, pow(towardSun, 3.0) * 0.85);
        col += vec3(1.0, 0.85, 0.6) * glit * (0.16 + 0.6 * pow(towardSun, 5.0));
        float d = length(vPos.xz - cameraPosition.xz);
        col = mix(col, vec3(0.94, 0.62, 0.40), smoothstep(60.0, 220.0, d));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const water = new THREE.Mesh(geo, mat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -8;
  scene.add(water);
}

// ---------- voxel batcher ----------
function makeBatch() { return { pos: [], nrm: [], col: [] }; }
const _m4 = new THREE.Matrix4();
function vox(batch, x, y, z, sx, sy, sz, color, ry = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
  _m4.makeRotationY(ry).setPosition(x, y, z);
  g.applyMatrix4(_m4);
  const c = new THREE.Color(color);
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  for (let i = 0; i < p.length; i += 3) {
    batch.pos.push(p[i], p[i + 1], p[i + 2]);
    batch.nrm.push(n[i], n[i + 1], n[i + 2]);
    batch.col.push(c.r, c.g, c.b);
  }
  g.dispose();
}
function buildMesh(batch, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(batch.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(batch.nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(batch.col, 3));
  return new THREE.Mesh(g, material);
}
const lit = makeBatch();    // normal shaded voxels
const glow = makeBatch();   // unlit emissive-looking voxels
const cloudB = makeBatch(); // translucent clouds
const foamB = makeBatch();  // white waterline foam

// ---------- island terrain (fine 0.5-unit grain, hidden-face culled) ----------
const U = 0.5;
const lattice = new Map();
function lrand(i, j) {
  const k = i + ',' + j;
  if (!lattice.has(k)) { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; lattice.set(k, s - Math.floor(s)); }
  return lattice.get(k);
}
const _sm = (t) => t * t * (3 - 2 * t);
function heightAt(x, z) {
  const xi = Math.floor(x / 4), zi = Math.floor(z / 4);
  const xf = _sm(x / 4 - xi), zf = _sm(z / 4 - zi);
  const n = lrand(xi, zi) * (1 - xf) * (1 - zf) + lrand(xi + 1, zi) * xf * (1 - zf)
          + lrand(xi, zi + 1) * (1 - xf) * zf + lrand(xi + 1, zi + 1) * xf * zf;
  return Math.round((n * 1.5) / U) * U;
}
function edgeOk(x, z) {
  const r = Math.hypot(x, z);
  const edge = 13.2 + Math.sin(Math.atan2(z, x) * 3.1) * 1.4 + Math.sin(Math.atan2(z, x) * 5.7 + 1.3) * 0.9;
  return r <= edge;
}
// face table: outward normal + 4 corners (unit box, CCW from outside)
const FACES = [
  [[1, 0, 0], [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]]],
  [[-1, 0, 0], [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]]],
  [[0, 1, 0], [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]]],
  [[0, -1, 0], [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]]],
  [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
  [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
];
const FIDX = [0, 1, 2, 0, 2, 3];
function emitBox(batch, x, y, z, s, color, mask) {
  const c = new THREE.Color(color);
  for (let f = 0; f < 6; f++) {
    if (!mask[f]) continue;
    const [n, verts] = FACES[f];
    for (const vi of FIDX) {
      const v = verts[vi];
      batch.pos.push(x + v[0] * s, y + v[1] * s, z + v[2] * s);
      batch.nrm.push(n[0], n[1], n[2]);
      batch.col.push(c.r, c.g, c.b);
    }
  }
}
const topH = new Map(); // integer columns -> top voxel center y (object placement)
{
  const boxes = [];
  const fullSet = new Set();
  const key = (x, y, z) => Math.round(x * 2) + ',' + Math.round(y * 2) + ',' + Math.round(z * 2);
  for (let x = -22; x <= 22; x += U) {
    for (let z = -22; z <= 22; z += U) {
      if (!edgeOk(x, z)) continue;
      const gy = heightAt(x, z);
      if (Number.isInteger(x) && Number.isInteger(z)) topH.set(x + ',' + z, gy);
      const gVar = 0.88 + rand() * 0.28;
      boxes.push([x, gy, z, U, true, new THREE.Color(rand() < 0.18 ? 0x86c05a : 0x74b653).multiplyScalar(gVar).getHex()]);
      boxes.push([x, gy - U, z, U, true, rand() < 0.5 ? 0x9a6a46 : 0x8a5f40]);
      boxes.push([x, gy - 2 * U, z, U, true, 0x8a6248]);
      for (let d = 3; d <= 10; d++) {
        const shade = (1 - d * 0.028) * (0.9 + rand() * 0.2);
        const strata = [0x9a98b4, 0x8a8ca8, 0x878a9f][d % 3];
        boxes.push([x, gy - d * U, z, U, true, new THREE.Color(strata).multiplyScalar(shade).getHex()]);
      }
      let depth = 11;
      let keep = rand();
      while (keep < 0.82 && depth < 26) {
        const shrink = Math.max(1 - (depth - 10) * 0.055, 0.35) * U;
        const shade = Math.max((0.72 - (depth - 10) * 0.022) * (0.9 + rand() * 0.2), 0.4);
        const strata = [0x8d8ba8, 0x7e7c9c, 0x9694b0][depth % 3];
        boxes.push([x, gy - depth * U, z, shrink, false, new THREE.Color(strata).multiplyScalar(shade).getHex()]);
        depth++;
        keep = rand();
        if (depth > 15 && rand() < 0.45) break;
      }
    }
  }
  for (const b of boxes) if (b[4]) fullSet.add(key(b[0], b[1], b[2]));
  const DIRS = [[U, 0, 0], [-U, 0, 0], [0, U, 0], [0, -U, 0], [0, 0, U], [0, 0, -U]];
  let drawn = 0, skipped = 0;
  for (const b of boxes) {
    const mask = [];
    for (let f = 0; f < 6; f++) {
      if (b[4]) mask[f] = !fullSet.has(key(b[0] + DIRS[f][0], b[1] + DIRS[f][1], b[2] + DIRS[f][2]));
      else mask[f] = f === 2 ? !fullSet.has(key(b[0], b[1] + U, b[2])) : true; // shrink box: only its top can be covered
    }
    for (let f = 0; f < 6; f++) (mask[f] ? drawn++ : skipped++);
    emitBox(lit, b[0], b[1], b[2], b[3], b[5], mask);
  }
  if (location.search.includes('stats')) console.log('terrain faces drawn=' + drawn + ' culled=' + skipped);
  // coastline dressing at coarse density: hanging vines, grass lip
  for (let cx = -21; cx <= 21; cx++) {
    for (let cz = -21; cz <= 21; cz++) {
      if (!edgeOk(cx, cz)) continue;
      let open = null;
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!edgeOk(cx + nx * 1.5, cz + nz * 1.5)) { open = [nx, nz]; break; }
      }
      if (!open) continue;
      const [nx, nz] = open;
      const gy = heightAt(cx, cz);
      if (rand() < 0.4) {
        const vn = 1 + Math.floor(rand() * 4);
        for (let k = 0; k < vn; k++) {
          vox(lit, cx + nx * 0.5, gy - 0.15 - k * 0.5, cz + nz * 0.5, 0.3, 0.5, 0.3, rand() < 0.5 ? 0x5da348 : 0x4c8f3e);
        }
      }
      if (rand() < 0.5) vox(lit, cx + nx * 0.3, gy + 0.32, cz + nz * 0.3, 0.46, 0.3, 0.46, rand() < 0.5 ? 0x86c05a : 0x74b653);
    }
  }
}
const surf = (x, z) => (topH.get(Math.round(x) + ',' + Math.round(z)) ?? 0) + 0.25;

// ---------- lighthouse ----------
{
  const bx = -7.5, bz = -4.5, by = surf(bx, bz);
  vox(lit, bx, by + 0.15, bz, 4.6, 0.5, 4.6, 0x8b89a0); // platform
  vox(lit, bx, by + 0.44, bz, 4.9, 0.16, 4.9, 0x9c9ab2); // platform rim
  const whites = [0xf8f2e6, 0xf2ebda, 0xefe5cf], reds = [0xd95a4e, 0xcf5043, 0xdf6150];
  for (let i = 0; i < 16; i++) {                       // finer courses, 4 quadrants each
    const s = 2.55 - i * 0.055, hs = s / 2, q = hs / 2;
    const band = Math.floor(i / 3) % 2;
    const base = new THREE.Color(band === 0 ? whites[i % 3] : reds[i % 3]);
    for (const [qx, qz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const sunF = (qx * -0.5 + qz * -0.85) / 1.35;    // sunset side warmer
      vox(lit, bx + qx * q, by + 0.9 + i * 0.58, bz + qz * q, hs, 0.58, hs,
        base.clone().multiplyScalar(1 + sunF * 0.07).getHex());
    }
  }
  // staggered tower windows facing the sea
  vox(lit, bx, by + 3.6, bz + (2.55 - 5 * 0.055) / 2 + 0.02, 0.5, 0.72, 0.08, 0x4a4460);
  vox(lit, bx, by + 6.4, bz + (2.55 - 9 * 0.055) / 2 + 0.02, 0.5, 0.72, 0.08, 0x4a4460);
  const ty = by + 0.9 + 15 * 0.58; // top of last course center
  vox(lit, bx, ty + 0.63, bz, 3.1, 0.34, 3.1, 0x565071);           // balcony
  for (const [rx2, rz2] of [[-1.45, -1.45], [1.45, -1.45], [-1.45, 1.45], [1.45, 1.45], [0, -1.45], [0, 1.45], [-1.45, 0], [1.45, 0]]) {
    vox(lit, bx + rx2, ty + 1.0, bz + rz2, 0.13, 0.55, 0.13, 0xf5f0e4); // railing posts
  }
  vox(lit, bx, ty + 1.26, bz - 1.45, 3.0, 0.08, 0.08, 0xf5f0e4);
  vox(lit, bx, ty + 1.26, bz + 1.45, 3.0, 0.08, 0.08, 0xf5f0e4);
  vox(lit, bx - 1.45, ty + 1.26, bz, 0.08, 0.08, 3.0, 0xf5f0e4);
  vox(lit, bx + 1.45, ty + 1.26, bz, 0.08, 0.08, 3.0, 0xf5f0e4);
  vox(lit, bx, by + 1.35, bz + 1.26, 0.85, 1.55, 0.1, 0x6e4a32);   // tower door
  vox(glow, bx, ty + 1.45, bz, 1.5, 1.15, 1.5, 0xffd98c);          // lamp room
  vox(lit, bx, ty + 2.18, bz, 1.95, 0.4, 1.95, 0xd95a4e);          // dome base
  vox(lit, bx, ty + 2.5, bz, 1.15, 0.32, 1.15, 0xcf5043);
  vox(lit, bx, ty + 2.78, bz, 0.45, 0.28, 0.45, 0xb8483c);         // tip
  lampLight.position.set(bx, ty + 1.5, bz);
}

// ---------- TRQN letters ----------
const LETTERS = {
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
};
{
  const cols = { T: 0xef6f60, R: 0xffce55, Q: 0x74d889, N: 0x6fb2f5 };
  const word = 'TRQN';
  let ox = -5.0;
  const bz = 6.5, by = surf(0, 6);
  vox(lit, 0.2, by + 0.08, bz, 12.3, 0.35, 1.8, 0x9a98b2); // base slab
  for (const ch of word) {
    const map = LETTERS[ch];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (map[row][col] === '1') {
          vox(lit, ox + col * 0.52, by + 3.9 - row * 0.52, bz, 0.48, 0.48, 0.8, cols[ch]);
        }
      }
    }
    ox += 3.05;
  }
}

// ---------- office cabin ----------
{
  const bx = 5.5, bz = -5.5, by = surf(bx, bz);
  const wallTones = [0xb0805a, 0xa97b52, 0xb5855e];
  for (let i = 0; i < 3; i++) vox(lit, bx, by + 0.4 + i * 0.88, bz, 5, 0.88, 4, wallTones[i]); // plank courses
  for (const [cx2, cz2] of [[-2.4, -1.9], [2.4, -1.9], [-2.4, 1.9], [2.4, 1.9]]) {
    vox(lit, bx + cx2, by + 1.3, bz + cz2, 0.34, 2.75, 0.34, 0x6e4a32); // corner posts
  }
  for (const wx2 of [-1.3, 1.4]) {                                     // framed front windows
    vox(lit, bx + wx2, by + 1.3, bz + 2.0, 1.35, 1.25, 0.1, 0x5e4028);
    vox(glow, bx + wx2, by + 1.3, bz + 2.07, 1.0, 0.9, 0.08, 0xffd98c);
  }
  vox(lit, bx + 2.5, by + 1.3, bz - 0.6, 0.1, 1.25, 1.45, 0x5e4028);   // side window frame
  vox(glow, bx + 2.55, by + 1.3, bz - 0.6, 0.08, 0.9, 1.1, 0xffd98c);
  vox(lit, bx, by + 1.0, bz + 2.02, 1.2, 2.0, 0.1, 0x5e4028);          // door frame
  vox(lit, bx, by + 0.92, bz + 2.08, 0.85, 1.7, 0.08, 0x6e4a32);       // door
  // plank relief where walls have no openings
  for (let i = 0; i < 3; i++) {
    const wy = by + 0.4 + i * 0.88;
    for (let p = 0; p < 10; p++) {
      const wxp = bx - 2.25 + p * 0.5;
      const rel = wxp - bx;
      vox(lit, wxp, wy, bz - 2.07, 0.505, 0.86, 0.08, new THREE.Color(wallTones[i]).multiplyScalar(0.95 + rand() * 0.09).getHex()); // back
      if (Math.abs(rel) > 2.1) {                                       // front: only clear of door/windows
        vox(lit, wxp, wy, bz + 2.07, 0.505, 0.86, 0.08, new THREE.Color(wallTones[i]).multiplyScalar(0.95 + rand() * 0.09).getHex());
      }
    }
    for (let p = 0; p < 8; p++) {
      const wzp = bz - 1.75 + p * 0.5, relz = wzp - bz;
      vox(lit, bx - 2.57, wy, wzp, 0.08, 0.86, 0.505, new THREE.Color(wallTones[i]).multiplyScalar(0.94 + rand() * 0.09).getHex());  // left
      if (relz < -1.5 || relz > 0.3) {                                 // right: clear of side window
        vox(lit, bx + 2.57, wy, wzp, 0.08, 0.86, 0.505, new THREE.Color(wallTones[i]).multiplyScalar(0.94 + rand() * 0.09).getHex());
      }
    }
  }
  const roofTones = [0x8f6240, 0x9a6c48];
  for (let i = 0; i < 6; i++) {                                        // thinner stepped roof, shingle strips
    const rw = 6.2 - i * 0.95, rd = 5.2 - i * 0.8;
    const n2 = Math.max(1, Math.round(rd / 0.8));
    for (let k = 0; k < n2; k++) {
      const sz = bz - rd / 2 + (k + 0.5) * (rd / n2);
      vox(lit, bx, by + 2.75 + i * 0.34, sz, rw, 0.34, rd / n2 - 0.02,
        new THREE.Color(roofTones[i % 2]).multiplyScalar(0.93 + rand() * 0.13).getHex());
    }
  }
  vox(lit, bx, by + 4.92, bz, 1.3, 0.4, 1.0, 0x6e4a32);                // ridge cap
  for (const ex of [-2.95, 2.95]) for (const ez of [-2.35, 2.35]) {
    vox(lit, bx + ex, by + 3.0, bz + ez, 0.55, 0.3, 0.55, 0x8f6240);   // lifted eave corners
  }
  vox(glow, bx - 2.9, by + 0.9, bz + 2.6, 0.4, 0.5, 0.4, 0xffca7a);    // porch lantern
}

// ---------- dock ----------
{
  const bz0 = 9.5;
  for (let i = 0; i < 6; i++) {
    vox(lit, 0, 0.15, bz0 + i * 1.05, 2.4, 0.28, 0.95, i % 2 ? 0x8a6242 : 0x96704c);
  }
  vox(lit, -1.05, -1.2, bz0 + 2.5, 0.3, 2.6, 0.3, 0x6b4a32);
  vox(lit, 1.05, -1.2, bz0 + 4.5, 0.3, 2.6, 0.3, 0x6b4a32);
  vox(glow, -1.05, 1.15, bz0 + 2.5, 0.42, 0.5, 0.42, 0xffca7a);
  for (let i = 0; i < 4; i++) {                                     // rope rails
    vox(lit, -1.1, 0.75, 10.3 + i * 1.6, 0.14, 1.1, 0.14, 0x6b4a32);
    vox(lit, 1.1, 0.75, 10.3 + i * 1.6, 0.14, 1.1, 0.14, 0x6b4a32);
  }
  vox(lit, -1.1, 1.28, 12.6, 0.08, 0.08, 5.6, 0xd8c49a);
  vox(lit, 1.1, 1.28, 12.6, 0.08, 0.08, 5.6, 0xd8c49a);
}

// ---------- trees, lanterns, flowers ----------
{
  const spots = [[-3, -9], [-11, 2], [-8, 6], [11, 6], [11, -2], [-1, -12]];
  for (const [tx, tz] of spots) {
    const ty = surf(tx, tz);
    vox(lit, tx, ty + 0.7, tz, 0.5, 1.5, 0.5, 0x7a543a);
    vox(lit, tx, ty + 1.55, tz, 0.4, 0.7, 0.4, 0x6e4a32);
    // bumpy leaf cluster: small cubes in a squashed ball, darker low, sun-kissed toward sunset
    const R2 = 1.35 + rand() * 0.3;
    const cy = ty + 2.7 + rand() * 0.3;
    for (let i = 0; i < 30; i++) {
      const a = rand() * Math.PI * 2, b = (rand() - 0.5) * Math.PI, rr = R2 * Math.cbrt(rand());
      const lx = Math.cos(a) * Math.cos(b) * rr, lz = Math.sin(a) * Math.cos(b) * rr, ly = Math.sin(b) * rr * 0.78;
      const h = ly / R2;
      let c = h > 0.4 ? 0x7cc65a : h > -0.12 ? 0x69b34d : 0x4c8f3e;
      if (lx * -0.5 + lz * -0.85 > 0.35 && h > -0.2 && rand() < 0.5) c = 0x9fd06a;
      const s2 = 0.48 + rand() * 0.36;
      vox(lit, tx + lx, cy + ly, tz + lz, s2, s2, s2, c);
    }
  }
  const lamps = [[-3, 0], [4, 1.5], [-6, 7], [8, 1]];
  for (const [lx, lz] of lamps) {
    const ly = surf(lx, lz);
    vox(lit, lx, ly + 0.7, lz, 0.22, 1.4, 0.22, 0x4a3a2c);
    vox(glow, lx, ly + 1.6, lz, 0.45, 0.5, 0.45, 0xffca7a);
  }
  const fCols = [0xe56a8a, 0xf2b53a, 0xffffff, 0xb986e0];
  for (let i = 0; i < 46; i++) {
    const a = rand() * Math.PI * 2, r = rand() * 11.5;
    const fx = Math.round(Math.cos(a) * r), fz = Math.round(Math.sin(a) * r);
    const fy = topH.get(fx + ',' + fz);
    if (fy === undefined) continue;
    vox(lit, fx + rand() * 0.5, fy + 0.45, fz + rand() * 0.5, 0.3, 0.3, 0.3, fCols[i % 4]);
  }
}

// ---------- playground, flag, benches, fence, tufts ----------
{
  const wood = 0x8a6242, woodD = 0x6e4a32;
  // swing
  const sx = -7, sz = 2, sy = surf(sx, sz);
  vox(lit, sx - 1.3, sy + 1.3, sz, 0.28, 2.6, 0.28, wood);
  vox(lit, sx + 1.3, sy + 1.3, sz, 0.28, 2.6, 0.28, wood);
  vox(lit, sx, sy + 2.65, sz, 3.0, 0.26, 0.26, woodD);
  for (const so of [-0.55, 0.55]) {
    vox(lit, sx + so - 0.25, sy + 1.75, sz, 0.06, 1.7, 0.06, 0xd8c49a);
    vox(lit, sx + so + 0.25, sy + 1.75, sz, 0.06, 1.7, 0.06, 0xd8c49a);
    vox(lit, sx + so, sy + 0.85, sz, 0.62, 0.12, 0.42, 0xd95a4e);
  }
  // slide (stepped chute)
  const dx = 1, dz = -2, dy = surf(dx, dz);
  vox(lit, dx, dy + 1.0, dz, 1.1, 2.0, 1.1, 0xf2b53a);
  vox(lit, dx, dy + 2.1, dz, 1.3, 0.22, 1.3, 0xd95a4e);
  for (let i = 0; i < 4; i++) {
    vox(lit, dx + 0.85 + i * 0.62, dy + 1.75 - i * 0.5, dz, 0.66, 0.5, 0.9, 0xef6f60);
  }
  vox(lit, dx - 0.72, dy + 1.0, dz, 0.35, 2.0, 0.9, 0x74d889);
  // red flag with crown near the dock
  const fx2 = 3.2, fz2 = 9.0, fy2 = surf(fx2, fz2);
  vox(lit, fx2, fy2 + 1.7, fz2, 0.18, 3.4, 0.18, 0x6e4a32);
  vox(lit, fx2 + 0.85, fy2 + 2.9, fz2, 1.7, 1.0, 0.1, 0xd9403c);
  for (let k = 0; k < 3; k++) vox(lit, fx2 + 0.55 + k * 0.3, fy2 + 3.0, fz2 + 0.09, 0.16, 0.32, 0.06, 0xffce55);
  vox(lit, fx2 + 0.85, fy2 + 2.76, fz2 + 0.09, 0.95, 0.2, 0.06, 0xffce55);
  // benches facing the sea
  for (const [bx2, bz2] of [[2.4, 8.4], [-3.0, 8.6]]) {
    const by2 = surf(bx2, bz2);
    vox(lit, bx2, by2 + 0.55, bz2, 1.5, 0.14, 0.5, wood);
    vox(lit, bx2, by2 + 0.95, bz2 - 0.22, 1.5, 0.55, 0.12, woodD);
    vox(lit, bx2 - 0.6, by2 + 0.25, bz2, 0.14, 0.5, 0.44, woodD);
    vox(lit, bx2 + 0.6, by2 + 0.25, bz2, 0.14, 0.5, 0.44, woodD);
  }
  // white picket fence in front of the letters
  for (let px = -4.4; px <= 4.4; px += 0.85) {
    vox(lit, px, surf(px, 5.1) + 0.45, 5.1, 0.14, 0.9, 0.14, 0xf5f0e4);
  }
  vox(lit, 0, surf(0, 5.1) + 0.68, 5.1, 9.2, 0.1, 0.08, 0xf5f0e4);
  // grass tufts
  for (let i = 0; i < 80; i++) {
    const a = rand() * Math.PI * 2, r = rand() * 12.5;
    const gx = Math.round(Math.cos(a) * r), gz = Math.round(Math.sin(a) * r);
    const gy = topH.get(gx + ',' + gz);
    if (gy === undefined) continue;
    vox(lit, gx + (rand() - 0.5) * 0.7, gy + 0.47, gz + (rand() - 0.5) * 0.7, 0.16, 0.44, 0.16, rand() < 0.5 ? 0x86c05a : 0x5da348);
  }
}

// ---------- seagulls ----------
const gulls = [];
{
  const gmat = new THREE.MeshLambertMaterial({ color: 0xfdfaf2 });
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.2), gmat);
    const wl = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.16), gmat);
    wl.position.set(-0.34, 0.07, 0);
    const wr = wl.clone();
    wr.position.x = 0.34;
    g.add(body, wl, wr);
    g.userData = { r: 15 + i * 4.5, h: 7.5 + i * 2.4, s: 0.22 + i * 0.06, p: rand() * Math.PI * 2, wl, wr };
    gulls.push(g);
    scene.add(g);
  }
}

// ---------- waterfalls ----------
const falls = [];
{
  const c = document.createElement('canvas'); c.width = 32; c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(235,245,255,0.95)');
  grad.addColorStop(1, 'rgba(200,225,250,0.05)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 32, 128);
  for (let i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(rand() * 30, rand() * 128, 2, 8); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const spots = [[-9.5, -6.5], [8.5, 7.0], [-10.5, 4.0]];
  for (const [wx, wz] of spots) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 8),
      new THREE.MeshBasicMaterial({ map: tex.clone(), transparent: true, side: THREE.DoubleSide, depthWrite: false })
    );
    m.position.set(wx, -4.2, wz);
    m.lookAt(0, -4.2, 0);
    falls.push(m);
    scene.add(m);
    for (let k = 0; k < 5; k++) {                                   // foam at the fall base
      vox(foamB, wx + (rand() - 0.5) * 2.4, -7.68 + rand() * 0.1, wz + (rand() - 0.5) * 2.4,
        0.5 + rand() * 0.7, 0.15, 0.5 + rand() * 0.7, 0xf6fbfa);
    }
  }
}

// ---------- sailboat ----------
const boat = new THREE.Group();
{
  vox; // keep batcher untouched
  const b = makeBatch();
  vox(b, 0, 0.3, 0, 3.2, 0.7, 1.4, 0x7a5236);
  vox(b, 0, 0.75, 0, 2.6, 0.3, 1.0, 0x8f6543);
  vox(b, 0, 2.2, 0, 0.18, 3.2, 0.18, 0x5e3f2a);
  vox(b, 0.75, 2.3, 0, 1.5, 2.4, 0.08, 0xf6efe0, 0);
  vox(b, -0.65, 2.0, 0, 1.1, 1.8, 0.08, 0xefe4cf, 0);
  const bm = buildMesh(b, new THREE.MeshLambertMaterial({ vertexColors: true }));
  boat.add(bm);
  boat.position.set(17, -8.2, 16);
  boat.rotation.y = 0.7;
  scene.add(boat);
}

// ---------- distant islets ----------
{
  const islets = [[-95, 6, -60], [85, -2, -70], [-55, 7, 95]];
  for (const [ix, iy, iz] of islets) {
    const n = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const rx = ix + (rand() - 0.5) * 6, rz = iz + (rand() - 0.5) * 6;
      const rr = 2.2 + rand() * 2;
      vox(lit, rx, iy + rand(), rz, rr, 1, rr, 0x6f8a5e);
      vox(lit, rx, iy - 1.2, rz, rr * 0.7, 2.2, rr * 0.7, 0x76749a);
      vox(lit, rx, iy - 2.8, rz, rr * 0.45, 1.6, rr * 0.45, 0x6a6890);
    }
    vox(lit, ix, iy + 2.2, iz, 1.4, 3.2, 1.4, 0x565274);
    vox(glow, ix, iy + 4.0, iz, 0.8, 0.6, 0.8, 0xffd98c);
  }
}

// ---------- clouds ----------
{
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    const far = rand() < 0.35;
    const r = far ? 60 + rand() * 35 : 18 + rand() * 24;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const cy = far ? 6 + rand() * 12 : -5.5 - rand() * 4.5;
    if (!far && cy < -4 && Math.hypot(cx - 17, cz - 16) < 13) continue; // keep the sailboat view clear
    const n = 4 + Math.floor(rand() * 4);
    for (let j = 0; j < n; j++) {
      vox(cloudB, cx + (rand() - 0.5) * 5, cy + (rand() - 0.5) * 1.1, cz + (rand() - 0.5) * 5,
        1.8 + rand() * 2.2, 0.8 + rand() * 0.6, 1.8 + rand() * 2.2, 0xfdf3ea);
    }
  }
}

// ---------- build merged meshes ----------
scene.add(buildMesh(lit, new THREE.MeshLambertMaterial({ vertexColors: true })));
scene.add(buildMesh(glow, new THREE.MeshBasicMaterial({ vertexColors: true })));
scene.add(buildMesh(cloudB, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.8 })));
scene.add(buildMesh(foamB, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 })));

// ---------- stops / markers ----------
const STOPS = [
  { name: '燈塔', desc: '紅白燈塔是小島最高的地方。天黑之前，它會把暖黃的光灑在海面上。', hint: '繞到燈塔背面，看看夕陽從哪個方向照過來。', target: new THREE.Vector3(-7.5, 6.5, -4.5), cam: new THREE.Vector3(-18, 7, 7) },
  { name: 'TRQN 字牌', desc: '四個字母站在島的胸口，是這片群島的名字，也是孩子們每天練習的地方。', hint: '轉一轉，從字母的側面看看它們是一塊一塊堆出來的。', target: new THREE.Vector3(0.2, 2.2, 6.5), cam: new THREE.Vector3(0.5, 6, 21.5) },
  { name: '辦公小屋', desc: '窗戶亮著的小木屋，大人在這裡準備明天的課，燈永遠先幫你開好。', hint: '找找看，屋子旁邊有幾盞小燈籠？', target: new THREE.Vector3(5.5, 2, -5.5), cam: new THREE.Vector3(14, 5, -12) },
  { name: '木棧道看夕陽', desc: '走到棧道盡頭，腳下是雲，眼前是海天相連的晚霞。', hint: '拉近一點，看看晚霞把遠方的小島染成什麼顏色。', target: new THREE.Vector3(-4, -2.0, 38), cam: new THREE.Vector3(0.3, 4.0, 8.8), mark: new THREE.Vector3(0, 0.3, 22) },
  { name: '帆船與雲海', desc: '小船慢慢繞著島航行。也許哪天，它會載著我們去旁邊的小島看看。', hint: '遠方有幾座小小的浮島，你數得出有幾座嗎？', target: new THREE.Vector3(17, -6, 16), cam: new THREE.Vector3(30, 1, 30) },
];
const markers = [];
{
  for (let i = 0; i < STOPS.length; i++) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.fillStyle = '#73a89a'; ctx.fill();
    ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), 64, 68);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(1.25, 1.25, 1);
    sp.position.copy(STOPS[i].mark || STOPS[i].target).y += 3.4;
    sp.userData.stop = i;
    if (i === 4) sp.position.set(17, -3.6, 16); // on the boat, not in empty air
    markers.push(sp);
    scene.add(sp);
  }
}

// ---------- camera flight ----------
let flight = null;
const FLY_DUR = location.search.includes('selftest') ? 0.35 : 1.7;
function flyTo(camPos, target, done) {
  flight = {
    t: 0, dur: FLY_DUR,
    fromP: camera.position.clone(), toP: camPos.clone(),
    fromT: controls.target.clone(), toT: target.clone(), done,
  };
  controls.enabled = false;
}
const ease = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

// ---------- modes / tour ----------
const qs = new URLSearchParams(location.search);
const noanim = qs.has('noanim');
let mode = 'free';
let tourIdx = 0, tourTimer = 0, tourPlaying = false;
const $ = (id) => document.getElementById(id);
const modeBtns = [...document.querySelectorAll('#modes button')];

function setMode(m) {
  const wasTop = mode === 'top';
  mode = m;
  modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  $('tour').classList.toggle('open', m === 'tour');
  if (m === 'tour') $('toast').style.opacity = '0';
  $('list').classList.toggle('open', m === 'list');
  if (m === 'tour') { tourPlaying = true; $('btn-pause').textContent = '暫停'; goStop(0); }
  if (m === 'top') flyTo(new THREE.Vector3(0.5, 62, 0.5), new THREE.Vector3(0, -2, 0));
  else if (wasTop && m === 'free') flyTo(DEFAULT_CAM.clone(), DEFAULT_TGT.clone()); // glide back, no clamp snap
}
function goStop(i, instant) {
  tourIdx = ((i % STOPS.length) + STOPS.length) % STOPS.length;
  const s = STOPS[tourIdx];
  tourTimer = 0;
  $('tourstep').textContent = `第 ${tourIdx + 1} 站 · 共 ${STOPS.length} 站`;
  $('tourname').textContent = s.name;
  $('tourdesc').textContent = s.desc;
  $('tourhint').textContent = s.hint;
  $('tourbar').style.width = `${((tourIdx + 1) / STOPS.length) * 100}%`;
  if (instant || noanim) {
    camera.position.copy(s.cam); controls.target.copy(s.target); flight = null; controls.enabled = true;
  } else {
    flyTo(s.cam, s.target, () => { controls.enabled = true; });
  }
}
modeBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m)));
$('btn-prev').addEventListener('click', () => goStop(tourIdx - 1));
$('btn-next').addEventListener('click', () => goStop(tourIdx + 1));
$('btn-pause').addEventListener('click', () => {
  tourPlaying = !tourPlaying;
  $('btn-pause').textContent = tourPlaying ? '暫停' : '繼續';
});
$('btn-end').addEventListener('click', () => setMode('free'));
document.querySelector('#list .close').addEventListener('click', () => setMode('free'));
{
  const box = $('listitems');
  STOPS.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<span class="n">${i + 1}</span><span><span class="nm">${s.name}</span><div class="d">${s.desc}</div></span>`;
    el.addEventListener('click', () => { setMode('free'); goStop(i); });
    box.appendChild(el);
  });
}

// ---------- outbound entries (plain links; official urls configured here, no iframe/prefetch) ----------
const ENTRIES = [
  { name: '學習島', url: 'https://learning-archipelago-family.onrender.com/' },
  { name: 'TF', url: 'https://zhuge-taskflow-web.onrender.com/' },
];
{
  const box = document.createElement('div');
  box.id = 'entries';
  box.className = 'chip';
  box.innerHTML = '<div class="h">入口</div>';
  ENTRIES.forEach((en) => {
    const a = document.createElement('a');
    a.href = en.url;
    a.target = '_blank';
    a.rel = 'noopener';
    const nm = document.createElement('span');
    nm.textContent = en.name;
    const go = document.createElement('span');
    go.className = 'go';
    go.textContent = '↗';
    a.append(nm, go);
    box.appendChild(a);
  });
  document.body.appendChild(box);
}

// toast
{
  const t = $('toast');
  t.textContent = '拖曳轉動島嶼 · 點「導覽」讓島帶你逛';
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  setTimeout(() => { t.style.opacity = '0'; }, 4600);
}

// marker picking (tap, not drag)
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 6) return;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hit = ray.intersectObjects(markers, false)[0];
  if (hit) {
    const i = hit.object.userData.stop;
    if (mode === 'tour') { goStop(i); } else { goStop(i); }
  }
});

// ---------- test hooks ----------
{
  const shot = qs.get('shot');
  if (shot === 'top') { camera.position.set(0.5, 62, 0.5); controls.target.set(0, -2, 0); }
  else if (shot && shot.startsWith('stop')) {
    const i = Math.min(Math.max(parseInt(shot.slice(4), 10) - 1 || 0, 0), STOPS.length - 1);
    setMode('tour');
    goStop(i, true);
    tourPlaying = false;
  } else if (shot === 'list') { setMode('list'); }
}

// ---------- scripted self-test (?selftest=1) ----------
window.__state = () => ({ mode, tourIdx, tourTimer, tourPlaying, flying: !!flight, camY: camera.position.y, camPos: camera.position.toArray().map((v) => +v.toFixed(1)) });
if (qs.has('selftest')) {
  const out = [];
  const rec = (name, pass) => out.push([name, !!pass]);
  const el = (id) => document.getElementById(id);
  const step = (ms, fn) => new Promise((res) => setTimeout(() => { fn(); res(); }, ms));
  const waitFor = (cond, maxMs) => new Promise((res) => {
    let n = 0;
    const iv = setInterval(() => {
      if (cond() || ++n > maxMs / 80) { clearInterval(iv); res(cond()); }
    }, 80);
  });
  (async () => {
    await step(600, () => {});
    // 1. marker click flies the camera, and the flight lands
    const m = markers[0].position.clone().project(camera);
    const mx = (m.x * 0.5 + 0.5) * innerWidth, my = (-m.y * 0.5 + 0.5) * innerHeight;
    const opts = { clientX: mx, clientY: my, bubbles: true };
    renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', opts));
    renderer.domElement.dispatchEvent(new PointerEvent('pointerup', opts));
    rec('marker_click_starts_flight', !!flight);
    rec('flight_finishes', await waitFor(() => !flight, 12000));
    // 2. tour mode opens card on stop 1
    setMode('tour');
    rec('tour_card_opens', el('tour').classList.contains('open') && el('tourname').textContent === STOPS[0].name);
    await waitFor(() => !flight, 12000);
    // 3. auto-advance timer runs while playing
    const t1 = tourTimer;
    rec('auto_timer_runs', await waitFor(() => tourTimer > t1 + 0.3, 8000));
    // 4. pause freezes the timer, resume restarts it
    el('btn-pause').click();
    const t2 = tourTimer;
    await step(500, () => rec('pause_freezes_timer', !tourPlaying && Math.abs(tourTimer - t2) < 0.01 && el('btn-pause').textContent === '繼續'));
    el('btn-pause').click();
    rec('resume_restarts', tourPlaying && el('btn-pause').textContent === '暫停');
    // 5. prev/next buttons change stops
    el('btn-next').click();
    rec('next_goes_stop2', tourIdx === 1 && el('tourname').textContent === STOPS[1].name);
    el('btn-prev').click();
    rec('prev_goes_stop1', tourIdx === 0);
    // 6. end tour returns to free
    el('btn-end').click();
    rec('end_tour_closes', mode === 'free' && !el('tour').classList.contains('open'));
    // 7. top-down mode
    setMode('top');
    rec('topdown_reached', await waitFor(() => camera.position.y > 40, 12000));
    // 8. list mode: opens, item click flies to that stop
    setMode('list');
    rec('list_opens', el('list').classList.contains('open') && document.querySelectorAll('#listitems .item').length === STOPS.length);
    document.querySelectorAll('#listitems .item')[2].click();
    rec('list_item_flies', mode === 'free' && tourIdx === 2);
    // 9. entry links: exactly the two configured plain links, no iframes
    const links = [...document.querySelectorAll('#entries a')];
    rec('entry_links', links.length === ENTRIES.length && links.every((a, i) => a.href === ENTRIES[i].url && a.target === '_blank' && (a.rel || '').includes('noopener')) && !document.querySelector('iframe'));
    const div = document.createElement('div');
    div.id = 'selftest';
    div.textContent = 'SELFTEST ' + JSON.stringify(out);
    document.body.appendChild(div);
  })();
}

// ---------- loop ----------
const clock = new THREE.Clock();
let frames = 0;
const nextFrame = qs.has('selftest') ? (fn) => setTimeout(fn, 16) : (fn) => requestAnimationFrame(fn);
function tick() {
  nextFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  waterUniforms.t.value = t;
  falls.forEach((f, i) => { f.material.map.offset.y = -t * 0.55 - i * 0.3; });
  boat.position.y = -8.2 + Math.sin(t * 0.9) * 0.25;
  boat.rotation.z = Math.sin(t * 0.7) * 0.03;
  markers.forEach((m, i) => {
    if (i === 4) m.position.set(boat.position.x, boat.position.y + 4.6, boat.position.z);
    else m.position.y = (STOPS[i].mark || STOPS[i].target).y + 3.4 + Math.sin(t * 1.6 + i) * 0.25;
  });
  lampLight.intensity = 26 + Math.sin(t * 2.2) * 5;

  gulls.forEach((g, i) => {
    const u = g.userData, a = u.p + t * u.s;
    g.position.set(Math.cos(a) * u.r, u.h + Math.sin(t * 0.9 + i) * 0.8, Math.sin(a) * u.r);
    g.rotation.y = -a;
    const flap = Math.sin(t * 7 + i * 2) * 0.5;
    u.wl.rotation.z = flap;
    u.wr.rotation.z = -flap;
  });

  if (flight) {
    flight.t += dt / flight.dur;
    const k = ease(Math.min(flight.t, 1));
    camera.position.lerpVectors(flight.fromP, flight.toP, k);
    controls.target.lerpVectors(flight.fromT, flight.toT, k);
    if (flight.t >= 1) { const d = flight.done; flight = null; controls.enabled = true; d && d(); }
  }
  if (mode === 'tour' && tourPlaying && !flight) {
    tourTimer += dt;
    if (tourTimer > 7) goStop(tourIdx + 1);
  }
  controls.update();
  ++frames;
  controls.minPolarAngle = (mode === 'top' || flight) ? 0 : POLAR_MIN;
  if (!qs.has('selftest') || frames < 15 || frames % 50 === 0) renderer.render(scene, camera);
  if (qs.has('stats') && frames === 3 && !document.getElementById('stats')) {
    const d = document.createElement('div'); d.id = 'stats';
    d.textContent = 'STATS tris=' + renderer.info.render.triangles + ' calls=' + renderer.info.render.calls;
    document.body.appendChild(d);
  }
  if (frames === 12) window.__ready = true;
}
tick();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
