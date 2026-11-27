// Cam_07 blockout: hillside villa, matched to the first-frame render, with wind-animated trees.
// World units = meters. Pool deck level y = 0. Camera looks toward -Z.
import * as THREE from 'three';

const W = 1920, H = 1080, FPS = 25, FRAMES = 101;
const params = new URLSearchParams(location.search);
const WIND = parseFloat(params.get('wind') ?? '0.8');

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc9d6e2);
scene.fog = new THREE.Fog(0xd9d4cc, 60, 420);

// sky gradient dome (warm at horizon, blue above)
{
  const g = new THREE.SphereGeometry(900, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {},
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec3 vP; void main(){ float h = clamp(vP.y*3.0,0.,1.);
      vec3 c = mix(vec3(0.97,0.84,0.68), vec3(0.42,0.62,0.86), pow(h,0.55)); gl_FragColor = vec4(c,1.); }`,
  });
  scene.add(new THREE.Mesh(g, m));
}

scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x5a5444, 1.1));
const sun = new THREE.DirectionalLight(0xffd6a0, 2.6);
sun.position.set(-60, 35, -25);         // low evening sun from the sea side (left, behind)
sun.target.position.set(0, 0, -22);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 30, bottom: -30, near: 1, far: 200 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// ---------- materials ----------
const mat = (color, rough = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
const M = {
  stone: mat(0xd6c2a0), stoneDark: mat(0xc2b08f), wood: mat(0x8a6040),
  glass: mat(0x8fa3ad, 0.15, { transparent: true, opacity: 0.35, metalness: 0.1 }),
  window: mat(0x34312e, 0.25, { emissive: 0x7a5228, emissiveIntensity: 0.16 }), deck: mat(0x8a6a4c), water: mat(0x2c6f93, 0.1, { metalness: 0.2 }),
  grass: mat(0x7d8c4c, 1), hill: mat(0x5f6a48, 1), sea: mat(0x4f7f9f, 0.25), roof: mat(0x8b4a42),
  umbrella: mat(0xf1ece4), dark: mat(0x3b3631),
};

function box(w, h, d, m, x, y, z, ry = 0, parent = scene) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z); b.rotation.y = ry;
  b.castShadow = b.receiveShadow = true;
  parent.add(b); return b;
}

// ---------- landscape ----------
// sea far below, headlands on the left
{
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), M.sea);
  sea.rotation.x = -Math.PI / 2; sea.position.y = -70; scene.add(sea);
  const hill = (x, z, sx, sy, sz) => {
    const h = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), M.hill);
    h.scale.set(sx, sy, sz); h.position.set(x, -70, z); scene.add(h);
  };
  hill(-260, -560, 260, 95, 70);
  hill(-420, -760, 260, 70, 90);
  hill(-120, -700, 90, 60, 50);
  hill(40, -220, 140, 110, 60);   // hill behind the villa
}
// hillside dropping to the left/front below the retaining wall
{
  const g = new THREE.PlaneGeometry(220, 160, 44, 32);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);            // plane local; becomes x, -z
    const wx = x - 30, wz = -y - 20;
    // ground: ~-4 at the wall line, falling away to the left and toward camera
    let h = -3 + 0.08 * (wx + 10) - 0.25 * Math.max(0, wz + 28) - 0.6 * Math.max(0, -(wx + 28));
    h = Math.max(Math.min(h, -2.5), -75);
    p.setZ(i, h);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, M.grass);
  m.rotation.x = -Math.PI / 2; m.position.set(30, 0, -20);
  m.receiveShadow = true; scene.add(m);
}

// ---------- pool water: gentle ripples (normal-perturbed, sky reflection) ----------
const uWaterTime = { value: 0 };
const skyEnv = (() => {
  const pm = new THREE.PMREMGenerator(renderer), sc = new THREE.Scene();
  sc.add(scene.children.find(o => o.material && o.material.type === 'ShaderMaterial').clone());
  return pm.fromScene(sc, 0.02).texture;
})();
function poolWater(x, y, z, ry, w, d) {
  const m = new THREE.MeshStandardMaterial({ color: 0x2a7399, roughness: 0.06, metalness: 0.1, envMap: skyEnv, envMapIntensity: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uT = uWaterTime;
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uT; varying vec3 vWPos;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      vec2 q = vWPos.xz;
      // slow, small overlapping wave trains (gentle)
      vec2 g = vec2(0.0);
      g += 0.050 * vec2(0.8, 0.6)  * cos(dot(q, vec2(0.8, 0.6))  * 4.2 - uT * 1.1);
      g += 0.040 * vec2(-0.5, 0.9) * cos(dot(q, vec2(-0.5, 0.9)) * 5.7 - uT * 1.4 + 1.3);
      g += 0.030 * vec2(0.95,-0.3) * cos(dot(q, vec2(0.95,-0.3)) * 8.3 - uT * 1.9 + 2.1);
      g += 0.018 * vec2(-0.9,-0.4) * cos(dot(q, vec2(-0.9,-0.4)) * 13.0 - uT * 2.6 + 0.7);
      vec3 nW = normalize(vec3(-g.x, 1.0, -g.y));
      normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
    `).replace('#include <color_fragment>', `#include <color_fragment>
      float caus = sin(vWPos.x * 6.0 + uT * 0.9) * sin(vWPos.z * 7.0 - uT * 1.1);
      diffuseColor.rgb *= 0.92 + 0.12 * caus;`);
  };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(w, d, 1, 1), m);
  water.rotation.set(-Math.PI / 2, 0, ry, 'YXZ'); water.rotation.order = 'YXZ'; water.rotation.y = ry;
  water.position.set(x, y, z); water.receiveShadow = true; scene.add(water);
}

// ---------- terrace / retaining walls / pool ----------
const wallLine = [[-12.5, -38], [-10.7, -28], [3.6, -16.6], [9, -14.5]];   // top edge of the terrace (x, z)
{
  for (let i = 0; i < wallLine.length - 1; i++) {
    const [x1, z1] = wallLine[i], [x2, z2] = wallLine[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1), ang = Math.atan2(z2 - z1, x2 - x1);
    box(len + 0.4, 4, 0.6, M.stone, (x1 + x2) / 2, -2, (z1 + z2) / 2, -ang);          // wall face
    box(len + 0.4, 1.1, 0.08, M.glass, (x1 + x2) / 2, 0.55, (z1 + z2) / 2 - 0.2, -ang); // glass rail
  }
  // terrace slab: polygon behind the wall line
  const shape = new THREE.Shape();
  shape.moveTo(-12.5, -60);
  wallLine.forEach(([x, z]) => shape.lineTo(x, z));
  shape.lineTo(30, -14.5); shape.lineTo(30, -60);
  const deck = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false }), M.stoneDark);
  deck.rotation.x = Math.PI / 2; deck.position.y = 0; deck.receiveShadow = true; scene.add(deck);
  // timber deck strip in front of the houses
  box(9, 0.08, 4.0, M.deck, 1.5, 0.04, -23.2, 0.12);
  // pool (infinity edge toward the wall)
  box(7.0, 0.5, 2.6, M.stone, -3.2, 0.1, -21.2, -0.62);
  poolWater(-3.2, 0.37, -21.2, -0.62, 6.6, 2.2);
  // lower planter step + parapet bottom right
  box(4.2, 1.2, 0.4, M.stone, 6.1, -0.3, -19.2, -0.1);
}

// ---------- villa blocks ----------
function windowsOnFace(parent, w, h, x0, y0, z, count) {
  const ww = w / count;
  for (let i = 0; i < count; i++) box(ww * 0.86, h, 0.1, M.window, x0 + ww * (i + 0.5), y0 + h / 2, z, 0, parent);
}
// Block A (left, 2 floors + roof terrace)
{
  const A = new THREE.Group(); A.position.set(-3.5, 0, -29.6); A.rotation.y = 0.05; scene.add(A);
  box(6.6, 6.8, 8, M.stone, 0, 3.4, 0, 0, A);                    // mass (front face z=+4)
  windowsOnFace(A, 2.6, 2.9, -2.8, 0.15, 4.06, 4);                // ground floor glazing
  windowsOnFace(A, 2.6, 2.9, -2.8, 3.65, 4.06, 4);                // first floor glazing
  box(7.4, 0.45, 2.2, M.stone, -0.1, 3.4, 4.9, 0, A);            // balcony slab
  box(4.2, 1.0, 0.06, M.glass, -1.4, 4.1, 5.95, 0, A);           // balcony glass
  box(7.6, 0.55, 9.0, M.stone, 0, 7.0, 0.4, 0, A);              // roof slab with overhang
  box(5.5, 1.0, 0.06, M.glass, 0.4, 7.8, 4.0, 0, A);             // roof terrace rail
  // outdoor kitchen / BBQ block + counter
  box(0.9, 2.6, 0.7, M.stone, 2.2, 1.3, 5.6, 0, A);
  box(2.4, 0.95, 0.7, M.dark, 3.6, 0.48, 5.6, 0, A);
}
// Block B (right, 3 floors, wood core, eave)
{
  const B = new THREE.Group(); B.position.set(6.17, 0, -24.0); B.rotation.y = -0.40; scene.add(B);
  box(10.5, 9.4, 10, M.stone, 0, 4.7, -1.0, 0, B);               // mass (front face z=+4)
  box(1.6, 9.4, 0.3, M.wood, -6.0, 4.7, 2.0, 0, B);              // recessed wood core toward block A
  box(4.4, 2.2, 0.2, M.wood, -2.7, 8.3, 4.05, 0, B);             // wood on the top floor
  box(1.2, 9.4, 0.3, M.wood, 4.6, 4.7, 4.1, 0, B);
  windowsOnFace(B, 4.6, 3.0, -3.0, 0.2, 4.1, 4);
  windowsOnFace(B, 4.6, 3.0, -3.0, 3.75, 4.1, 4);
  windowsOnFace(B, 3.2, 1.9, -4.6, 7.35, 4.2, 3);
  box(9.8, 0.5, 2.6, M.stone, 0.6, 3.45, 5.3, 0, B);             // 1st-floor balcony slab
  box(9.0, 1.05, 0.06, M.glass, 0.8, 4.2, 6.55, 0, B);
  box(4.4, 0.5, 2.4, M.stone, -2.7, 7.0, 5.2, 0, B);             // 2nd-floor balcony slab
  box(4.0, 1.05, 0.06, M.glass, -2.6, 7.75, 6.35, 0, B);
  box(13.5, 0.35, 13.5, M.stone, 0.2, 9.55, -0.8, 0, B);         // eave
  const roof = new THREE.Mesh(new THREE.ConeGeometry(9.2, 2.4, 4, 1), M.roof);
  roof.rotation.y = Math.PI / 4; roof.position.set(0.2, 10.9, -0.8); roof.castShadow = true; B.add(roof);
}
// umbrellas (static)
function umbrella(x, z, r = 1.5, h = 2.4) {
  const c = new THREE.Mesh(new THREE.ConeGeometry(r, 0.5, 16, 1, true), M.umbrella);
  c.position.set(x, h, z); c.castShadow = true; scene.add(c);
  box(0.06, h, 0.06, M.dark, x, h / 2, z);
}
umbrella(-9.0, -30.5, 1.4); umbrella(1.0, -24.5, 1.7, 2.5);

// ---------- wind material ----------
const uTime = { value: 0 };
const WIND_GLSL = /* glsl */`
  uniform float uTime; uniform float uWind;
  attribute vec4 aW1;   // baseY, height, treePhase, flex
  attribute vec4 aW2;   // leafPhase, flutterAmp, 0, 0
  varying float vShade;
  vec3 windOffset(vec3 wp, float tip) {
    float base = aW1.x, height = aW1.y, ph = aW1.z, flex = aW1.w;
    float h = clamp((wp.y - base) / max(height, 0.01), 0.0, 1.2);
    float bend = h * h;
    float gust = 0.55 + 0.45 * sin(uTime * 0.55 + ph * 0.3) * sin(uTime * 0.21 + 1.7);
    vec2 dir = normalize(vec2(1.0, 0.35));
    float sway = 0.65 * sin(uTime * 1.15 + ph) + 0.35 * sin(uTime * 1.9 + ph * 1.7);
    vec3 o = vec3(0.0);
    o.xz += dir * (sway * gust + 0.35 * gust) * bend * height * 0.035 * flex;
    // branch level: waves running through the crown
    float br = sin(uTime * 3.1 + dot(wp.xz, vec2(0.9, 0.6)) + wp.y * 0.7 + ph);
    o += vec3(br, 0.35 * br, br * 0.6) * 0.08 * bend * flex * gust;
    // leaf flutter
    float lp = aW2.x;
    float f1 = sin(uTime * 9.0 + lp), f2 = sin(uTime * 12.7 + lp * 1.9);
    o += vec3(f1, f2 * 0.8, f2 * 0.6) * aW2.y * tip * (0.4 + 0.8 * gust);
    vShade = 0.86 + 0.22 * f1 * aW2.y / max(aW2.y, 1e-3) * step(0.001, aW2.y);
    return o * uWind;
  }
`;
function windify(material, isDepth = false) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime; sh.uniforms.uWind = { value: WIND };
    sh.vertexShader = WIND_GLSL + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
      wp.xyz += windOffset(wp.xyz, clamp(position.y, 0.0, 1.0));
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;`);
    if (!isDepth) {
      sh.fragmentShader = 'varying float vShade;\n' + sh.fragmentShader.replace(
        '#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vShade;');
    }
  };
  return material;
}
const depthMat = windify(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.5 }), true);

// geometry: leaf card with stem at y=0, tip at y=1
const leafGeo = (() => {
  const g = new THREE.BufferGeometry();
  // diamond-ish leaf
  const v = new Float32Array([0, 0, 0, 0.45, 0.45, 0, 0, 1, 0, -0.45, 0.45, 0]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); return g;
})();
const bladeGeo = (() => {     // long thin leaflet (palm) / grass blade, tip at y=1
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.3, 0.5, 0, -0.3, 0.5, 0, 0, 1, 0]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 3, 2, 4]); g.computeVertexNormals(); return g;
})();

// A "batch" collects instances (matrix + wind attrs) and builds one InstancedMesh.
class Batch {
  constructor(geo, color, opts = {}) { this.geo = geo; this.color = color; this.opts = opts; this.m = []; this.a1 = []; this.a2 = []; this.c = []; }
  add(matrix, w1, w2, color) { this.m.push(matrix); this.a1.push(...w1); this.a2.push(...w2); this.c.push(color ?? new THREE.Color(this.color)); }
  build() {
    const n = this.m.length; if (!n) return;
    const geo = this.geo.clone();
    geo.setAttribute('aW1', new THREE.InstancedBufferAttribute(new Float32Array(this.a1), 4));
    geo.setAttribute('aW2', new THREE.InstancedBufferAttribute(new Float32Array(this.a2), 4));
    const material = windify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide, ...this.opts }));
    const im = new THREE.InstancedMesh(geo, material, n);
    this.m.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, this.c[i]); });
    im.castShadow = true; im.receiveShadow = true; im.customDepthMaterial = depthMat;
    im.frustumCulled = false; scene.add(im);
  }
}
const rnd = (() => { let s = 1234567; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const R = (a, b) => a + (b - a) * rnd();
const leaves = new Batch(leafGeo, 0x5f7f3a);
const blades = new Batch(bladeGeo, 0x6f8f3a);
const trunks = new Batch(new THREE.CylinderGeometry(0.5, 0.7, 1, 7, 4).translate(0, 0.5, 0), 0x5a4636);

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function leafMatrix(p, size, yaw, pitch, roll, stretch = 1) {
  _e.set(pitch, yaw, roll, 'YXZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(p, _q, _s.set(size, size * stretch, size));
}
function colorJitter(hex, j = 0.12) {
  const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl);
  return c.setHSL(hsl.h + R(-0.02, 0.02), hsl.s * R(0.85, 1.1), hsl.l * R(1 - j, 1 + j));
}
function trunk(x, y, z, h, r, w1, lean = [0, 0]) {
  const mm = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(lean[0], 0, lean[1])), new THREE.Vector3(r, h, r));
  trunks.add(mm, w1, [0, 0, 0, 0]);
}

// ---------- tree types ----------
// broadleaf / olive / shrub: ellipsoid crown of leaf cards (+ inner clumps)
function broadleaf({ x, y, z, trunkH, crownR, crownH, n = 2500, leaf = 0.32, color = 0x5e7d3a, flex = 1, trunkR = 0.18, flutter = 0.05 }) {
  const H = trunkH + crownH, ph = R(0, 6.28), w1 = [y, H, ph, flex];
  if (trunkH > 0.2) trunk(x, y, z, trunkH + crownH * 0.4, trunkR, w1);
  const clumps = Math.max(4, Math.round(n / 220));
  const centers = [];
  for (let c = 0; c < clumps; c++) {
    const u = R(0, 6.28), v = R(-0.5, 0.9);
    centers.push(new THREE.Vector3(x + Math.cos(u) * crownR * 0.6 * R(0.3, 1), y + trunkH + crownH * (0.5 + 0.38 * v), z + Math.sin(u) * crownR * 0.6 * R(0.3, 1)));
  }
  for (let i = 0; i < n; i++) {
    const c = centers[i % clumps];
    const d = new THREE.Vector3(R(-1, 1), R(-0.8, 1), R(-1, 1)).normalize().multiplyScalar(Math.pow(R(0, 1), 0.35));
    _p.set(c.x + d.x * crownR * 0.55, c.y + d.y * crownH * 0.32, c.z + d.z * crownR * 0.55);
    leaves.add(leafMatrix(_p.clone(), leaf * R(0.7, 1.3), R(0, 6.28), R(-1.2, 1.2), R(-0.6, 0.6)),
      w1, [R(0, 6.28), flutter, 0, 0], colorJitter(color));
  }
}
function cypress({ x, y, z, h, r, n = 2200, color = 0x3e5a2e }) {
  const ph = R(0, 6.28), w1 = [y, h, ph, 0.7];
  trunk(x, y, z, h * 0.4, 0.15, w1);
  for (let i = 0; i < n; i++) {
    const t = Math.pow(R(0, 1), 0.8), rr = r * Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.7 * Math.sqrt(R(0.2, 1));
    const u = R(0, 6.28);
    _p.set(x + Math.cos(u) * rr, y + h * (0.06 + 0.94 * t), z + Math.sin(u) * rr);
    leaves.add(leafMatrix(_p.clone(), 0.28 * R(0.7, 1.2), R(0, 6.28), R(-0.4, 0.4), R(-0.5, 0.5), 1.4),
      w1, [R(0, 6.28), 0.03, 0, 0], colorJitter(color, 0.15));
  }
}
function pine({ x, y, z, h, crownR, n = 3200, color = 0x40592f }) {
  const ph = R(0, 6.28), w1 = [y, h, ph, 0.8];
  trunk(x, y, z, h * 0.92, 0.3, w1, [0, R(-0.08, 0.08)]);
  const pads = 7;
  for (let k = 0; k < pads; k++) {
    const u = R(0, 6.28), rr = crownR * R(0.1, 0.75);
    const cx = x + Math.cos(u) * rr, cz = z + Math.sin(u) * rr, cy = y + h * R(0.62, 0.95);
    for (let i = 0; i < n / pads; i++) {
      const a = R(0, 6.28), d = Math.sqrt(R(0, 1)) * crownR * R(0.35, 0.6);
      _p.set(cx + Math.cos(a) * d, cy + R(-0.5, 0.6) * (1 - d / crownR), cz + Math.sin(a) * d);
      leaves.add(leafMatrix(_p.clone(), 0.35 * R(0.7, 1.2), R(0, 6.28), R(-1.5, -0.6), R(-0.4, 0.4), 1.2),
        w1, [R(0, 6.28), 0.035, 0, 0], colorJitter(color, 0.15));
    }
  }
}
// fan palm (as in the render): leaning trunk + leaves made of a petiole and a radiating fan of leaflets
const _bm = new THREE.Matrix4();
function bladeAlong(pos, dir, side, width, length) {     // blade whose local +Y runs along dir
  const y = dir.clone().normalize(), x = side.clone().sub(y.clone().multiplyScalar(side.dot(y))).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x.multiplyScalar(width), y.multiplyScalar(length), z).setPosition(pos);
}
function palm({ x, y, z, h, leavesN = 34, petiole = 1.7, fan = 1.35, lean = 0.09, color = 0x6c8a34 }) {
  const ph = R(0, 6.28), w1 = [y, h, ph, 1.2];
  trunk(x, y, z, h, 0.3, w1, [0, lean]);
  const top = new THREE.Vector3(x - h * Math.sin(lean), y + h * Math.cos(lean), z);
  const up = new THREE.Vector3(0, 1, 0);
  for (let l = 0; l < leavesN; l++) {
    const yaw = l * 2.39996 + R(-0.15, 0.15);                      // golden-angle spiral
    const el = R(-0.75, 1.25);                                      // drooping old leaves .. upright new ones
    const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(el), Math.sin(el), Math.sin(yaw) * Math.cos(el));
    const lp = R(0, 6.28), len = petiole * R(0.8, 1.2);
    // petiole: slightly arched stick
    blades.add(bladeAlong(top.clone(), dir.clone().add(new THREE.Vector3(0, 0.12, 0)), new THREE.Vector3(-dir.z, 0, dir.x), 0.06, len),
      w1, [lp, 0.03, 0, 0], colorJitter(0x7a7a3a, 0.1));
    const c = top.clone().addScaledVector(dir, len * 0.97).add(new THREE.Vector3(0, -0.1 * len * Math.max(0, -el), 0));
    const side = new THREE.Vector3().crossVectors(up, dir).normalize();
    const out = dir.clone().add(new THREE.Vector3(0, 0.25, 0)).normalize();
    const nL = 30, span = R(3.4, 4.0);                              // ~200-230 degree fan
    const leafCol = colorJitter(color, 0.18);
    for (let k = 0; k < nL; k++) {
      const a = (k / (nL - 1) - 0.5) * span;
      const d = out.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a));
      d.y -= 0.35 * Math.abs(Math.sin(a)) + 0.25;                   // leaflets droop toward the sides/tips
      const L = fan * R(0.8, 1.1) * (0.75 + 0.25 * Math.cos(a));
      blades.add(bladeAlong(c.clone(), d, new THREE.Vector3().crossVectors(d, out).normalize(), 0.085, L),
        w1, [lp + k * 0.35, 0.10 + R(0, 0.05), 0, 0], leafCol.clone().offsetHSL(0, 0, R(-0.05, 0.05)));
    }
  }
}
function hedge({ x0, x1, z0, z1, y = 0, h = 1.4, n = 2500, color = 0x3f5a2c, leaf = 0.22 }) {
  const ph = R(0, 6.28);
  for (let i = 0; i < n; i++) {
    const t = rnd(), px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t + R(-0.5, 0.5), py = y + h * Math.sqrt(R(0.05, 1));
    leaves.add(leafMatrix(new THREE.Vector3(px, py, pz), leaf * R(0.7, 1.3), R(0, 6.28), R(-1.2, 1.2), R(-0.6, 0.6)),
      [y, h, ph + px * 0.3, 0.5], [R(0, 6.28), 0.035, 0, 0], colorJitter(color));
  }
}
function grassPatch({ x0, x1, z0, z1, n, heightFn, color = 0x7a8a48, plume = 0xe6aebd, plumeRate = 0.3, len = 0.9 }) {
  for (let i = 0; i < n; i++) {
    const x = R(x0, x1), z = R(z0, z1), y = heightFn(x, z);
    const isPlume = rnd() < plumeRate, L = len * R(0.6, 1.4) * (isPlume ? 1.4 : 1);
    blades.add(leafMatrix(new THREE.Vector3(x, y, z), isPlume ? 0.16 : 0.05, R(0, 6.28), R(-0.35, 0.35), R(-0.35, 0.35), L / (isPlume ? 0.16 : 0.05)),
      [y, L, R(0, 6.28) + x * 0.4, 7.0], [R(0, 6.28), 0.05, 0, 0], colorJitter(isPlume ? plume : color, 0.2));
  }
}
const slopeY = (x, z) => Math.max(Math.min(-3 + 0.08 * (x + 10) - 0.25 * Math.max(0, z + 28) - 0.6 * Math.max(0, -(x + 28)), -2.5), -75);

// ---------- planting (positions from the render) ----------
palm({ x: 5.6, y: -7, z: -10.5, h: 13.6, leavesN: 52, petiole: 1.9, fan: 1.6 });                 // big foreground palm, right
cypress({ x: -8.2, y: 0, z: -33.5, h: 10.5, r: 1.3 });                    // cypress behind block A
cypress({ x: -1.2, y: 1, z: -38, h: 10, r: 1.1 });
cypress({ x: -3.6, y: 1, z: -37, h: 7, r: 0.9 });
pine({ x: -15.5, y: -6, z: -38, h: 12, crownR: 5, n: 4200 });            // umbrella pines, left
pine({ x: -18, y: -8, z: -33, h: 10, crownR: 4.5, n: 3600 });
pine({ x: -13.5, y: -4, z: -44, h: 13, crownR: 4.5, n: 3600 });
pine({ x: -12, y: -5, z: -34, h: 10, crownR: 4 });
pine({ x: -20, y: -9, z: -44, h: 12, crownR: 5 });
broadleaf({ x: -27, y: -14, z: -42, trunkH: 6, crownR: 4.5, crownH: 3.5, n: 2600, leaf: 0.45, color: 0x56703a }); // far-left umbrella tree
broadleaf({ x: -25, y: -12, z: -36, trunkH: 3, crownR: 3, crownH: 3, n: 1800, leaf: 0.4, color: 0x4a6431 });
broadleaf({ x: -10.5, y: 0, z: -31, trunkH: 0.2, crownR: 2.2, crownH: 1.6, n: 1400, color: 0x4e6c34, flex: 0.6 }); // hedge mass behind pool (left)
broadleaf({ x: -7.0, y: 0, z: -30.5, trunkH: 0.2, crownR: 2.0, crownH: 1.5, n: 1200, color: 0x56743a, flex: 0.6 });
broadleaf({ x: -5.6, y: 0, z: -28.6, trunkH: 0.8, crownR: 1.3, crownH: 1.6, n: 1100, color: 0x6c7f4a, leaf: 0.22 }); // olive near A
broadleaf({ x: -0.3, y: -0.6, z: -19.6, trunkH: 0.4, crownR: 1.1, crownH: 1.3, n: 1200, color: 0x5f7b45, leaf: 0.22 }); // olive in planter
broadleaf({ x: 5.6, y: 0, z: -20.8, trunkH: 0.8, crownR: 2.0, crownH: 2.6, n: 6500, color: 0x3f5a2c, leaf: 0.34 }); // big bush right of B
broadleaf({ x: 7.6, y: 0, z: -20.2, trunkH: 0.1, crownR: 2.2, crownH: 0.9, n: 900, color: 0x48652f, flex: 0.5 });  // low hedge right
broadleaf({ x: -6.0, y: 3.8, z: -24.9, trunkH: 0.5, crownR: 0.5, crownH: 1.0, n: 350, color: 0x4d6a33, leaf: 0.16 }); // potted tree on A balcony
hedge({ x0: -11.5, x1: -6.2, z0: -30.6, z1: -29.8, h: 1.7, n: 2600 });                // tall hedge behind the pool (left)
hedge({ x0: 3.2, x1: 9.5, z0: -19.9, z1: -19.6, y: 0.2, h: 0.9, n: 1600, color: 0x47662f });    // hedge along the right parapet
hedge({ x0: 2.5, x1: 9.5, z0: -13.2, z1: -12.4, y: -2.2, h: 1.6, n: 1800, color: 0x3e5a2a });   // low hedge, bottom right
cypress({ x: 6.6, y: -6, z: -13.5, h: 9.2, r: 0.9, n: 1600, color: 0x4c6a34 });               // narrow shrub behind the palm trunk
grassPatch({ x0: -26, x1: -8, z0: -34, z1: -14, n: 9000, heightFn: slopeY, len: 0.7 });      // pampas & grasses on the slope
grassPatch({ x0: -3, x1: 3.5, z0: -20.5, z1: -17, n: 700, heightFn: () => 0, color: 0x7d8a4a, plumeRate: 0.1, len: 0.28 });
leaves.build(); blades.build(); trunks.build();

// ---------- camera: frame 0 matched to the render; motion = solved Cam_07 camera (tools/solve_camera.py) ----------
const camera = new THREE.PerspectiveCamera(31.9, W / H, 0.1, 3000);
const SCENE_DEPTH = 22;          // median scene depth (m) the solved, depth-normalized translation is scaled to
camera.position.set(0, 5.64, 0);
camera.rotation.set(THREE.MathUtils.degToRad(-5.5), 0, 0, 'YXZ');
camera.updateMatrixWorld();
const M0 = camera.matrixWorld.clone();
const solve = await (await fetch('./cam07_solve.json')).json();
const F = new THREE.Matrix4().makeScale(1, -1, -1);       // OpenCV camera axes <-> three.js camera axes
const _rel = new THREE.Matrix4(), _M = new THREE.Matrix4();
function setFrame(f) {
  const fr = solve.frames[Math.min(f, solve.frames.length - 1)], R = fr.R, c = fr.c;
  _rel.set(R[0][0], R[0][1], R[0][2], c[0] * SCENE_DEPTH,
           R[1][0], R[1][1], R[1][2], c[1] * SCENE_DEPTH,
           R[2][0], R[2][1], R[2][2], c[2] * SCENE_DEPTH,
           0, 0, 0, 1);
  _M.copy(M0).multiply(F).multiply(_rel).multiply(F);    // cam_t -> world
  _M.decompose(camera.position, camera.quaternion, camera.scale);
  uTime.value = f / FPS + 3.0;                            // start mid-breeze
  uWaterTime.value = f / FPS;
  renderer.render(scene, camera);
}
window.__setFrame = (f) => { setFrame(f); return true; };
window.__ready = true;
setFrame(parseInt(params.get('f') ?? '0'));
