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
renderer.toneMappingExposure = 1.28;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xef9f66, 45, 210);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 600);
{
  // narrow screens start farther back so the whole island fits
  const dir = new THREE.Vector3(27, 13, 30);
  const k = Math.max(1, Math.min(1.15 / camera.aspect, 1.8));
  camera.position.copy(dir.multiplyScalar(k));
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, -1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 7;
controls.maxDistance = 95;
controls.maxPolarAngle = 1.72;

// ---------- lights ----------
const SUN_DIR = new THREE.Vector3(-0.5, 0.16, -0.85).normalize();
const sun = new THREE.DirectionalLight(0xffb377, 1.65);
sun.position.copy(SUN_DIR).multiplyScalar(80);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xb39ad8, 0x46536e, 1.0));
const fill = new THREE.DirectionalLight(0x8fa8d8, 0.75);
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
        vec3 deep = vec3(0.10, 0.35, 0.48);
        vec3 warm = vec3(0.95, 0.55, 0.28);
        vec3 vDir = normalize(vPos - cameraPosition);
        float towardSun = max(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0);
        float glit = pow(max(sin(vPos.x * 1.4 + t * 2.0) * sin(vPos.z * 1.1 - t * 1.6) * sin((vPos.x + vPos.z) * 0.7 + t * 0.8), 0.0), 18.0);
        vec3 col = mix(deep, warm, pow(towardSun, 3.0) * 0.85);
        col += vec3(1.0, 0.8, 0.55) * glit * (0.05 + 0.55 * pow(towardSun, 5.0));
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

// ---------- island terrain ----------
const topH = new Map(); // "x,z" -> top y of grass
{
  const R = 13.2;
  for (let x = -22; x <= 22; x++) {
    for (let z = -22; z <= 22; z++) {
      const r = Math.hypot(x, z);
      const edge = R + Math.sin(Math.atan2(z, x) * 3.1) * 1.4 + Math.sin(Math.atan2(z, x) * 5.7 + 1.3) * 0.9;
      if (r > edge) continue;
      const bump = (rand() < 0.12 && r < edge - 3) ? 1 : 0;
      const gy = bump;
      topH.set(x + ',' + z, gy);
      const gVar = 0.9 + rand() * 0.25;
      vox(lit, x, gy, z, 1, 1, 1, new THREE.Color(rand() < 0.18 ? 0x86c05a : 0x74b653).multiplyScalar(gVar).getHex());
      vox(lit, x, gy - 1, z, 1, 1, 1, rand() < 0.5 ? 0x9a6a46 : 0x8a5f40);
      vox(lit, x, gy - 2, z, 1, 1, 1, 0x8a6248);
      for (let d = 3; d <= 5; d++) {
        const shade = 1 - d * 0.05;
        vox(lit, x, gy - d, z, 1, 1, 1, new THREE.Color(0x9a98b4).multiplyScalar(shade).getHex());
      }
      // jagged floating underside
      let depth = 6;
      let keep = rand();
      while (keep < 0.82 && depth < 13) {
        const shrink = 1 - (depth - 5) * 0.09;
        const shade = 0.72 - (depth - 5) * 0.035;
        vox(lit, x, gy - depth, z, Math.max(shrink, 0.3), 1, Math.max(shrink, 0.3),
          new THREE.Color(0x8d8ba8).multiplyScalar(Math.max(shade, 0.4)).getHex());
        depth++;
        keep = rand();
        if (depth > 8 && rand() < 0.4) break;
      }
    }
  }
}
const surf = (x, z) => (topH.get(Math.round(x) + ',' + Math.round(z)) ?? 0) + 0.5;

// ---------- lighthouse ----------
{
  const bx = -7.5, bz = -4.5, by = surf(bx, bz);
  vox(lit, bx, by + 0.15, bz, 4.6, 0.5, 4.6, 0x8b89a0); // platform
  for (let i = 0; i < 9; i++) {
    const s = 2.9 - i * 0.13;
    const c = Math.floor(i / 2) % 2 === 0 ? 0xf8f2e6 : 0xd95a4e;
    vox(lit, bx, by + 0.9 + i, bz, s, 1, s, c);
  }
  vox(lit, bx, by + 9.6, bz, 3.6, 0.35, 3.6, 0x565071);           // balcony
  vox(lit, bx, by + 9.95, bz, 3.6, 0.35, 0.18, 0x565071);
  vox(glow, bx, by + 10.7, bz, 1.7, 1.3, 1.7, 0xffd98c);           // lamp room
  vox(lit, bx, by + 11.7, bz, 2.3, 0.5, 2.3, 0xd95a4e);
  vox(lit, bx, by + 12.15, bz, 1.4, 0.45, 1.4, 0xd95a4e);
  lampLight.position.set(bx, by + 10.8, bz);
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
  vox(lit, bx, by + 1.1, bz, 5, 2.6, 4, 0xb0805a);                 // walls
  vox(glow, bx - 1.3, by + 1.3, bz + 2.02, 1.1, 1.0, 0.1, 0xffd98c); // window
  vox(glow, bx + 1.4, by + 1.3, bz + 2.02, 1.1, 1.0, 0.1, 0xffd98c);
  vox(glow, bx + 2.52, by + 1.3, bz - 0.6, 0.1, 1.0, 1.2, 0xffd98c); // side window
  vox(lit, bx, by + 1.0, bz + 2.04, 1.0, 1.8, 0.12, 0x6e4a32);      // door
  for (let i = 0; i < 4; i++) {                                      // stepped roof
    vox(lit, bx, by + 2.7 + i * 0.45, bz, 5.8 - i * 1.3, 0.45, 4.8 - i * 1.1, 0x9a6c48);
  }
  vox(glow, bx - 2.9, by + 0.9, bz + 2.6, 0.4, 0.5, 0.4, 0xffca7a);  // porch lantern
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
}

// ---------- trees, lanterns, flowers ----------
{
  const spots = [[-3, -9], [-11, 2], [-8, 6], [11, 6], [11, -2], [-1, -12]];
  for (const [tx, tz] of spots) {
    const ty = surf(tx, tz);
    vox(lit, tx, ty + 0.8, tz, 0.55, 1.7, 0.55, 0x7a543a);
    const g1 = 0x69b34d, g2 = 0x7cc65a;
    vox(lit, tx, ty + 2.3, tz, 2.2, 1.4, 2.2, rand() < 0.5 ? g1 : g2);
    vox(lit, tx + 0.5, ty + 3.2, tz - 0.3, 1.5, 1.0, 1.5, g2);
    vox(lit, tx - 0.4, ty + 3.9, tz + 0.2, 0.9, 0.7, 0.9, g1);
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
    vox(lit, fx + rand() * 0.5, fy + 1.05, fz + rand() * 0.5, 0.3, 0.3, 0.3, fCols[i % 4]);
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
  mode = m;
  modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  $('tour').classList.toggle('open', m === 'tour');
  $('list').classList.toggle('open', m === 'list');
  if (m === 'tour') { tourPlaying = true; $('btn-pause').textContent = '暫停'; goStop(0); }
  if (m === 'top') flyTo(new THREE.Vector3(0.5, 62, 0.5), new THREE.Vector3(0, -2, 0));
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
  if (!qs.has('selftest') || frames < 15 || frames % 50 === 0) renderer.render(scene, camera);
  if (frames === 12) window.__ready = true;
}
tick();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
