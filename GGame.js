/* =====================================================================
   GGame.js — Mars Rover project

   STAGE 1: renderer / scene / camera / lights / animation loop
   STAGE 2: procedural terrain (a height FUNCTION) + arrow-key driving
   STAGE 3: the rover as a HIERARCHICAL MODEL (the core requirement)

   'THREE' is the global created by three.min.js, loaded before this
   file in index.html.
   ===================================================================== */
'use strict';

/* 1. RENDERER — draws onto a <canvas> using WebGL */
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(innerWidth, innerHeight);
/* no shadow mapping: the dark inside of the craters is BAKED into the
   terrain's vertex colors instead (see updateGround) — cheaper and it
   reads better on an open landscape */
document.body.appendChild(renderer.domElement);

/* 2. SCENE — the container of everything */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x081226);   // deep night blue behind the stars
/* exponential fog: hides the edge of the terrain patch and adds depth */
scene.fog = new THREE.FogExp2(0x5a3a28, 0.008);

/* 3. CAMERA — fov, aspect, near/far clipping planes */
const camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 500);

/* LIGHTS — a MeshStandardMaterial is BLACK without lights.
   DirectionalLight = parallel rays like the sun;
   AmbientLight = base fill so shadowed sides aren't pure black. */
const sun = new THREE.DirectionalLight(0xfff1dd, 1.2);
sun.position.set(60, 80, 40);          // direction = position -> target
scene.add(sun);
scene.add(sun.target);                 // target must be in the scene to move it
scene.add(new THREE.AmbientLight(0x886655, 0.55));

/* =====================================================================
   STARRY SKY — a shell of points high above the terrain.
   Key details:
   - fog:false            -> stars ignore the dust fog (they're in space)
   - sizeAttenuation:false-> constant pixel size regardless of distance
   - the group follows the rover in the loop, so the sky never gets
     closer no matter how far you drive
   ===================================================================== */
const skyGroup = new THREE.Group();
scene.add(skyGroup);
{
  const N = 900, starPos = new Float32Array(N * 3);
  for(let i = 0; i < N; i++){
    /* random direction on the upper hemisphere, pushed to radius 430 */
    const v = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() * 0.5 + 0.03,   // only above the horizon
      Math.random() - 0.5
    ).normalize().multiplyScalar(430);
    starPos.set([v.x, v.y, v.z], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  skyGroup.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xdfe8ff, size: 2.0, sizeAttenuation: false,
    fog: false, transparent: true, opacity: 0.9
  })));
}

/* =====================================================================
   CONSTELLATIONS — Ursa Major, Ursa Minor and the NORTH STAR.
   Each constellation is a small "star chart": a list of [azimuth,
   elevation] offsets (radians) around a centre direction, projected
   onto the same imaginary sphere as the random stars. Faint lines
   join the stars so the two Dippers read at a glance. They live in
   skyGroup, so they follow the rover like the rest of the sky and
   stay fixed toward north (-Z)
   ===================================================================== */
let polarisMat;                        // twinkled in the animation loop
{
  const RAD = 425;                     // just inside the random-star shell
  /* azimuth 0 = north (-Z), elevation = angle above the horizon */
  const dir = (az, el) => new THREE.Vector3(
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
     -Math.cos(az) * Math.cos(el)).multiplyScalar(RAD);

  /* the Big Dipper:*/
  const bigDipper = [
    [0.00, 0.00],  
    [0.13, 0.07],   
    [0.25, 0.11],   
    [0.36, 0.17],   
    [0.39, 0.01],   
    [0.55, 0.05],   
    [0.53, 0.23]]; 
  /* the Little Dipper: Polaris is the TIP of its handle */
  const littleDipper = [
    [0.00,  0.00],  
    [0.06, -0.08],  
    [0.10, -0.16],  
    [0.13, -0.24],  
    [0.22, -0.29],  
    [0.30, -0.24], 
    [0.21, -0.17]]; 
  /* same wiring for both: along the handle, around the bowl, closed */
  const links = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,3]];

  /* builds the star points + the joining lines of one constellation */
  function constellation(chart, az0, el0, size){
    const pts = chart.map(([a, e]) => dir(az0 + a, el0 + e));
    const sg = new THREE.BufferGeometry().setFromPoints(pts);
    skyGroup.add(new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xdfe8ff, size, sizeAttenuation: false, fog: false,
      transparent: true, opacity: 0.95})));
    const lg = new THREE.BufferGeometry().setFromPoints(
      links.flatMap(([a, b]) => [pts[a], pts[b]]));
    skyGroup.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
      color: 0x91a3c9, transparent: true, opacity: 0.3, fog: false})));
    return pts;
  }
  constellation(bigDipper, -0.75, 0.30, 3.5);              // Ursa Major
  const lp = constellation(littleDipper, 0.10, 0.62, 3.0); // Ursa Minor

  /* Polaris gets its own point on top: bigger, warmer, and twinkling */
  polarisMat = new THREE.PointsMaterial({color: 0xfff3c8, size: 6,
    sizeAttenuation: false, fog: false, transparent: true});
  skyGroup.add(new THREE.Points(
    new THREE.BufferGeometry().setFromPoints([lp[0]]), polarisMat));
}

/* =====================================================================
   VICTORY CONSTELLATION — "MISSION ACCOMPLISHED" written in the sky.
   Each letter is a tiny star chart (points + faint joining lines) in
   the same style as the Dippers. It is built the moment the rocket
   climbs away, centred on the patch of sky it is climbing into, and
   fades in slowly — as if those stars had always been there.
   ===================================================================== */
const skyTextMats = [];   // {mat, target} — faded in by the loop
const skyStarMats = [];   // the star materials only — they twinkle
let   skyTextBuilt = false;

/* a minimal stroke font: x spans 0..w, y spans 0..1, seg joins points */
const SKY_FONT = {
  M: {w:.8,  pts:[[0,0],[0,1],[.4,.45],[.8,1],[.8,0]],
             seg:[[0,1],[1,2],[2,3],[3,4]]},
  I: {w:.2,  pts:[[.1,0],[.1,.5],[.1,1]], seg:[[0,1],[1,2]]},
  S: {w:.6,  pts:[[.6,1],[0,1],[0,.5],[.6,.5],[.6,0],[0,0]],
             seg:[[0,1],[1,2],[2,3],[3,4],[4,5]]},
  O: {w:.6,  pts:[[0,0],[0,1],[.6,1],[.6,0]],
             seg:[[0,1],[1,2],[2,3],[3,0]]},
  N: {w:.7,  pts:[[0,0],[0,1],[.7,0],[.7,1]], seg:[[0,1],[1,2],[2,3]]},
  A: {w:.7,  pts:[[0,0],[.35,1],[.7,0],[.18,.5],[.52,.5]],
             seg:[[0,1],[1,2],[3,4]]},
  C: {w:.6,  pts:[[.6,1],[0,1],[0,0],[.6,0]], seg:[[0,1],[1,2],[2,3]]},
  P: {w:.6,  pts:[[0,0],[0,1],[.6,1],[.6,.55],[0,.55]],
             seg:[[0,1],[1,2],[2,3],[3,4]]},
  L: {w:.6,  pts:[[0,1],[0,0],[.6,0]], seg:[[0,1],[1,2]]},
  H: {w:.7,  pts:[[0,0],[0,1],[.7,0],[.7,1],[0,.5],[.7,.5]],
             seg:[[0,1],[2,3],[4,5]]},
  E: {w:.6,  pts:[[.6,1],[0,1],[0,.5],[.5,.5],[0,0],[.6,0]],
             seg:[[0,1],[1,2],[2,3],[2,4],[4,5]]},
  D: {w:.65, pts:[[0,0],[0,1],[.5,.88],[.65,.5],[.5,.12]],
             seg:[[0,1],[1,2],[2,3],[3,4],[4,0]]},
};

/* writes ONE word onto the sky sphere, centred at azimuth az0 with its
   baseline at elevation el0; s = letter height in radians */
function skyWord(word, az0, el0, s){
  const R = 420;                          // just inside the star shell
  const dir = (az, el) => new THREE.Vector3(
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
     -Math.cos(az) * Math.cos(el)).multiplyScalar(R);
  /* letters get squeezed horizontally by cos(el) that high up —
     stretch the azimuth offsets by the inverse so the text reads flat */
  const gap = 0.35 * s, str = 1 / Math.cos(el0 + s * 0.5);
  let width = -gap;
  for(const ch of word) width += SKY_FONT[ch].w * s + gap;
  let ax = az0 - width * str / 2;

  const stars = [], lines = [];
  for(const ch of word){
    const g = SKY_FONT[ch];
    const p = g.pts.map(([x, y]) => dir(ax + x * s * str, el0 + y * s));
    stars.push(...p);
    for(const [a, b] of g.seg) lines.push(p[a], p[b]);
    ax += (g.w * s + gap) * str;
  }
  /* the letter vertices are the BRIGHT stars of the constellation:
     big, warm yellow — the same tint as Polaris, just deeper */
  const sm = new THREE.PointsMaterial({color: 0xffe28a, size: 6.5,
    sizeAttenuation: false, fog: false, transparent: true, opacity: 0});
  skyGroup.add(new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(stars), sm));
  /* the strokes are FILLED with lesser stars: scattered along each
     segment at uneven steps, nudged slightly off the line and split
     into two magnitudes — so the words read as a REAL constellation,
     not as drawn lines */
  const dim = [], mid = [];
  for(let i = 0; i < lines.length; i += 2){
    const a = lines[i], b = lines[i + 1];
    const n = Math.ceil(a.distanceTo(b) / 2.2);   // a star every ~2 units
    for(let k = 1; k < n; k++){
      const p = a.clone().lerp(b, (k + (Math.random() - 0.5) * 0.5) / n);
      p.x += (Math.random() - 0.5) * 0.8;         // a touch of scatter
      p.y += (Math.random() - 0.5) * 0.8;
      p.z += (Math.random() - 0.5) * 0.8;
      (Math.random() < 0.35 ? mid : dim).push(p); // two star magnitudes
    }
  }
  const mm = new THREE.PointsMaterial({color: 0xffe9a8, size: 3.6,
    sizeAttenuation: false, fog: false, transparent: true, opacity: 0});
  const dm = new THREE.PointsMaterial({color: 0xfff3c8, size: 2.2,
    sizeAttenuation: false, fog: false, transparent: true, opacity: 0});
  skyGroup.add(new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(mid), mm));
  skyGroup.add(new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(dim), dm));
  skyTextMats.push({mat: sm, target: 1},
                   {mat: mm, target: 0.95}, {mat: dm, target: 0.8});
  skyStarMats.push(sm);
}

/* the two words, stacked, centred where the ship went up */
function buildSkyText(az0){
  skyWord('MISSION',      az0, 0.60, 0.085);
  skyWord('ACCOMPLISHED', az0, 0.44, 0.062);
}

/* keep canvas and camera in sync with the window size */
addEventListener('resize', () => {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  /* the eye camera lives further down (inside the rover's head) but is
     hoisted-safe to touch here because resize only fires at runtime */
  eyeCam.aspect = innerWidth/innerHeight;
  eyeCam.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* =====================================================================
   TERRAIN AS A FUNCTION.
   We never store the terrain: terrainH(x,z) computes the height at ANY
   point on demand. The visible mesh is just a flat plane whose vertices
   we displace to match the function. Since the function exists
   everywhere, the world is conceptually infinite — we only draw a patch.
   Sums of sines at different frequencies look like natural dunes.
   ===================================================================== */
/* deterministic pseudo-random number from a grid cell: same inputs ->
   same output, so craters never move between frames or reloads */
function hash(a, b, s){
  const h = Math.sin(a*127.1 + b*311.7 + s*74.7) * 43758.5453;
  return h - Math.floor(h);
}
/* classic Mars crater profile: a smooth bowl plus a raised rim.
   d = distance from the crater centre, R = radius, depth = bowl depth */
function craterShape(d, R, depth){
  const x = d / R;
  if(x > 1.4) return 0;
  const bowl = x < 1 ? -depth * (1 - x*x) * (1 - x*x) : 0;           // the hole
  const rim  = depth * 0.22 * Math.exp(-((x - 1.05)**2) / 0.015);    // the edge bump
  return bowl + rim;
}
/* craters live on a virtual grid: each cell MAY contain one, with
   hashed centre, radius and depth. Any point only needs to check its
   own cell and the 8 neighbours. The SAME function shapes the mesh
   and drives the rover, so the rover really goes down into the holes.
   TWO layers on different grids give craters of very different sizes:
   - 70 m cells -> rare BIG craters the rover can drive down into
   - 26 m cells -> frequent small pockmarks
   depth grows with the radius, like real impact craters. */
function craterLayer(x, z, cell, s, Rmin, Rmax, dScale){
  let h = 0;
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  for(let i = cx-1; i <= cx+1; i++)
    for(let j = cz-1; j <= cz+1; j++){
      if(hash(i, j, s) < 0.45) continue;              // no crater in this cell
      const ox = i*cell + hash(i, j, s+1) * cell;     // crater centre
      const oz = j*cell + hash(i, j, s+2) * cell;
      const R     = Rmin + hash(i, j, s+3) * (Rmax - Rmin);
      const depth = R * dScale * (0.7 + hash(i, j, s+4) * 0.6);
      h += craterShape(Math.hypot(x - ox, z - oz), R, depth);
    }
  return h;
}
function cratersAt(x, z){
  return craterLayer(x, z, 70, 1,  6,   26,  0.18)    // big: R 6..26 m, up to ~6 m deep
       + craterLayer(x, z, 26, 11, 1.6, 4.5, 0.22);   // small pockmarks
}
/* rolling dunes WITHOUT the craters — split out so the shading pass can
   ask for the crater contribution separately */
function baseH(x, z){
  return Math.sin(x*0.021 + 1.7) * Math.cos(z*0.017) * 4.2   // large hills
       + Math.sin(x*0.052) * Math.cos(z*0.047 + 0.8) * 1.6   // medium dunes
       + Math.sin(x*0.19)  * Math.sin(z*0.16) * 0.22;        // small bumps
}
function terrainH(x, z){
  return baseH(x, z) + cratersAt(x, z);
}
/* terrain normal by finite differences: sample the height a little to
   each side and build the perpendicular. Used to tilt the rover. */
function terrainNormal(x, z){
  const e = 0.6;
  return new THREE.Vector3(
    terrainH(x-e, z) - terrainH(x+e, z),
    2*e,
    terrainH(x, z-e) - terrainH(x, z+e)).normalize();
}

/* =====================================================================
   PROCEDURAL MARS TEXTURES.
   THREE texture KINDS
   - a COLOR map   on the ground: rust base + tone patches + pebbles
   - a NORMAL map  on the ground: computed from the height canvas,
                   RGB-encoded tangent-space normals — the lighting
                   reacts to fake detail without adding any geometry
   - a BUMP map    on the rocks: grayscale height detail
   (Three.js ignores bumpMap when normalMap is present on the SAME
   material, which is why the two kinds live on different objects.)
   Everything is drawn on 2D canvases. Blobs are stamped at 9 wrapped positions
   so the textures tile seamlessly with RepeatWrapping.
   ===================================================================== */
const TILE = 25;                     // one texture copy covers 25 m of ground
function makeMarsTextures(){
  const W = 1024;
  const cv  = document.createElement('canvas'); cv.width  = cv.height  = W;
  const bcv = document.createElement('canvas'); bcv.width = bcv.height = W;
  const ctx = cv.getContext('2d'), bctx = bcv.getContext('2d');
  ctx.fillStyle  = '#93502a'; ctx.fillRect(0, 0, W, W);    // base rust
  bctx.fillStyle = '#808080'; bctx.fillRect(0, 0, W, W);   // bump: mid-gray = flat

  /* soft round patch, repeated at the 8 wrapped offsets => tileable */
  function blob(c, x, y, r, rgba){
    for(const ox of [-W, 0, W]) for(const oy of [-W, 0, W]){
      const g = c.createRadialGradient(x+ox, y+oy, 0, x+ox, y+oy, r);
      g.addColorStop(0, rgba); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(x+ox, y+oy, r, 0, Math.PI*2); c.fill();
    }
  }
  /* gentle tone variation: rust hues CLOSE to the base color, so the
     ground doesn't look uniform but nothing reads as a shadow — the
     only dark areas on the map must be the crater bowls */
  for(let i = 0; i < 70; i++){
    const x = Math.random()*W, y = Math.random()*W, r = 40 + Math.random()*160;
    const warm = Math.random() < 0.5;
    blob(ctx,  x, y, r, warm ? 'rgba(178,100,50,0.20)' : 'rgba(132,72,38,0.18)');
    blob(bctx, x, y, r, warm ? 'rgba(150,150,150,0.15)' : 'rgba(110,110,110,0.12)');
  }
  /* thousands of pebbles: bright in the bump map so they poke UP */
  for(let i = 0; i < 3500; i++){
    const x = Math.random()*(W-4), y = Math.random()*(W-4), s = 1 + Math.random()*3;
    const v = Math.random();
    ctx.fillStyle  = v < 0.5 ? 'rgba(52,24,12,0.55)' : 'rgba(220,150,90,0.5)';
    ctx.fillRect(x, y, s, s);
    bctx.fillStyle = 'rgba(255,255,255,' + (0.25 + v*0.35) + ')';
    bctx.fillRect(x, y, s, s);
  }
  /* NORMAL MAP — derived from the height (bump) canvas: each pixel's
     slope toward its neighbours becomes a tangent-space normal vector,
     encoded as RGB (this is what "normal map generator" tools do).
     Neighbours wrap around the canvas edges, so the result still tiles. */
  const bd = bctx.getImageData(0, 0, W, W).data;
  const ncv = document.createElement('canvas'); ncv.width = ncv.height = W;
  const nctx = ncv.getContext('2d');
  const nimg = nctx.createImageData(W, W);
  const hAt = (x, y) => bd[(((y + W) % W) * W + ((x + W) % W)) * 4]; // red = height
  const STR = 2.4;                     // how strong the fake relief reads
  for(let y = 0; y < W; y++)
    for(let x = 0; x < W; x++){
      const sx = (hAt(x+1, y) - hAt(x-1, y)) / 255 * STR;
      const sy = (hAt(x, y+1) - hAt(x, y-1)) / 255 * STR;
      const inv = 1 / Math.sqrt(sx*sx + sy*sy + 1); // normalize (x,y,z=1)
      const o = (y * W + x) * 4;
      nimg.data[o]     = (-sx * inv * 0.5 + 0.5) * 255;  // X -> red
      nimg.data[o + 1] = ( sy * inv * 0.5 + 0.5) * 255;  // Y -> green
      nimg.data[o + 2] = (      inv * 0.5 + 0.5) * 255;  // Z -> blue
      nimg.data[o + 3] = 255;
    }
  nctx.putImageData(nimg, 0, 0);

  const map = new THREE.CanvasTexture(cv), normal = new THREE.CanvasTexture(ncv);
  for(const t of [map, normal]){
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(SIZE/TILE, SIZE/TILE);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy(); // sharp at grazing angles
  }
  /* the height canvas becomes the BUMP map for the rocks (their own
     texture object: rock UVs must not follow the ground's offsets) */
  const rockBump = new THREE.CanvasTexture(bcv);
  rockBump.wrapS = rockBump.wrapT = THREE.RepeatWrapping;
  rockBump.repeat.set(3, 3);
  return {map, normal, rockBump};
}

/* build the ground patch: PlaneGeometry is vertical by default, so we
   rotate it flat; after that, vertex Y is "up" and we can set it from
   the height function. */
const SIZE = 300, SEGS = 150;   // finer grid so crater bowls look smooth
const groundGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
groundGeo.rotateX(-Math.PI/2);
const posAttr = groundGeo.attributes.position;
const marsTex = makeMarsTextures();
/* per-vertex COLOR attribute: multiplied with the texture by the
   material (vertexColors:true). updateGround writes darkness into it
   inside the crater bowls — a baked ambient-occlusion effect. */
const colAttr = new THREE.BufferAttribute(new Float32Array(posAttr.count * 3).fill(1), 3);
groundGeo.setAttribute('color', colAttr);
const groundMat = new THREE.MeshStandardMaterial({
  map: marsTex.map,            // color texture (kind 1)
  normalMap: marsTex.normal,   // normal texture (kind 2)
  normalScale: new THREE.Vector2(0.9, 0.9),
  vertexColors: true,          // crater shading
  roughness: 0.97
});
const ground = new THREE.Mesh(groundGeo, groundMat);
scene.add(ground);

/* =====================================================================
   ROCKS — big boulders and small stones scattered over the whole
   surface, in a darker red than the soil.
   Same trick as the craters: rocks live on a virtual grid, each cell
   deterministically decides (via hash) if it holds rocks, where, and
   how big. Only the rocks near the rover exist as meshes; they are
   RECYCLED through a pool while driving, so memory stays constant.

   DESIGNED FOR THE FUTURE PICKUP FEATURE: every rock mesh carries a
   stable id + size in userData. When the rover will grab a rock, write
   into movedRocks:  movedRocks.set(id, null)        -> rock removed
                     movedRocks.set(id, {x:…, z:…})  -> rock re-placed
   then force a refresh; the generator consults the map every time.
   ===================================================================== */
const rockGroup = new THREE.Group();
scene.add(rockGroup);
const ROCK_CELL  = 16;   // one virtual cell may hold up to 1 big + 2 small rocks
const ROCK_RANGE = 7;    // rocks exist within ±7 cells (~112 m) of the rover

/* darker red than the #93502a soil — three variants for variety.
   The rocks carry the BUMP texture: grayscale
   height detail that roughens their lighting. */
const rockMats = [0x6b2115, 0x7a2a1a, 0x581b10].map(c =>
  new THREE.MeshStandardMaterial({color: c, roughness: 0.92, metalness: 0.05,
                                  bumpMap: marsTex.rockBump, bumpScale: 0.25}));
const rockGeo = new THREE.DodecahedronGeometry(1, 0);   // low-poly boulder shape

/* GOLD-VEINED BOULDERS — a rare variant of the BIG rocks (~30%).
   Two more procedural textures drawn on canvases:
   - a COLOR map: dark basalt mottling + branching gold veins
   - a METALNESS map: the same veins painted white on black — metal=1
     only along the veins, so the gold catches the sun and the
     headlights while the rock around it stays dull.
   The vein paths are generated once as random walks and stroked onto
   BOTH canvases, so color and metalness match exactly. */
const goldenMat = (() => {
  const W = 512;
  const cv = document.createElement('canvas'); cv.width = cv.height = W;
  const mv = document.createElement('canvas'); mv.width = mv.height = W;
  const ctx = cv.getContext('2d'), mtx = mv.getContext('2d');
  ctx.fillStyle = '#2c1a3e'; ctx.fillRect(0, 0, W, W);   // deep purple base
  mtx.fillStyle = '#000';    mtx.fillRect(0, 0, W, W);   // black = no metal
  /* mottling (color only) — dark violet tones */
  for(let i = 0; i < 900; i++){
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(18,10,30,0.4)'
                                        : 'rgba(80,50,110,0.35)';
    ctx.fillRect(Math.random()*W, Math.random()*W,
                 2 + Math.random()*5, 2 + Math.random()*5);
  }
  /* veins: each is a random walk; the point list is reused to stroke
     gold on the color canvas, white on the metalness canvas, and a
     thin brighter core on top */
  for(let v = 0; v < 14; v++){
    const pts = [[Math.random()*W, Math.random()*W]];
    let a = Math.random() * Math.PI * 2;
    const steps = 30 + Math.floor(Math.random()*50);
    for(let s = 0; s < steps; s++){
      a += (Math.random() - 0.5) * 0.9;              // the vein wanders
      const [lx, ly] = pts[pts.length-1];
      pts.push([lx + Math.cos(a)*7, ly + Math.sin(a)*7]);
    }
    const w = 5 + Math.random()*6;    // WIDE veins: bold against the purple
    const stroke = (c, style, lw) => {
      c.strokeStyle = style; c.lineWidth = lw; c.lineCap = 'round';
      c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
      for(const [x, y] of pts) c.lineTo(x, y);
      c.stroke();
    };
    stroke(ctx, '#ffd24a', w);        // gold vein
    stroke(ctx, '#fff0a0', w*0.4);    // brighter core
    stroke(mtx, '#fff', w);           // metal follows the vein exactly
  }
  /* GLITTER: a dust of tiny bright specks, white and gold, painted on
     BOTH canvases — being metallic on a low-roughness surface, each
     speck catches the sun/headlights and twinkles as the view moves */
  for(let i = 0; i < 1600; i++){
    const x = Math.random()*W, y = Math.random()*W, s = 1 + Math.random();
    ctx.fillStyle = Math.random() < 0.5 ? '#ffffff' : '#ffd86a';
    ctx.fillRect(x, y, s, s);
    mtx.fillStyle = '#fff';
    mtx.fillRect(x, y, s, s);
  }
  return new THREE.MeshStandardMaterial({
    map: new THREE.CanvasTexture(cv),
    metalnessMap: new THREE.CanvasTexture(mv),
    metalness: 1.0,                   // multiplied by the map: veins + glitter
    roughness: 0.28,                  // glossy enough to make the glitter ping
    bumpMap: marsTex.rockBump, bumpScale: 0.2
  });
})();

/* GRAPE-CLUSTER SHAPE — golden boulders are built differently from
   normal rocks: a central sphere buried under 12..17 smaller lobes
   pushed well outward, like a bunch of grapes. They have their own
   pool (goldenPool) because the compound object cannot be recycled
   as a plain dodecahedron. */
const goldSphereGeo = new THREE.SphereGeometry(1, 10, 8);
const goldenPool = [];
function makeGoldenRock(){
  const g = new THREE.Mesh(goldSphereGeo, goldenMat);   // hidden centre
  const n = 12 + Math.floor(Math.random() * 6);
  for(let k = 0; k < n; k++){
    const lobe = new THREE.Mesh(goldSphereGeo, goldenMat);
    lobe.scale.setScalar(0.32 + Math.random() * 0.22);  // grape-sized
    /* random direction, pushed FAR out: the silhouette becomes all
       bumps, the central sphere only fills the gaps */
    const a = Math.random() * Math.PI * 2;
    const b = (Math.random() - 0.5) * Math.PI;
    const r = 0.6 + Math.random() * 0.25;
    lobe.position.set(Math.cos(a) * Math.cos(b) * r,
                      Math.sin(b) * r * 0.9,
                      Math.sin(a) * Math.cos(b) * r);
    g.add(lobe);
  }
  return g;
}

const movedRocks = new Map();   // future pickup feature writes here

/* deterministic list of the rocks belonging to one grid cell */
function rockSpecs(i, j){
  const specs = [];
  if(hash(i, j, 60) > 0.84)                       // BIG boulder: ~1 cell in 6
    specs.push({k: 0, big: true,
      golden: hash(i, j, 64) > 0.5,               // half the boulders: golden
      x: (i + hash(i, j, 61)) * ROCK_CELL,
      z: (j + hash(i, j, 62)) * ROCK_CELL,
      s: 0.9 + hash(i, j, 63) * 1.3});            // radius 0.9..2.2 m
  const n = Math.floor(hash(i, j, 70) * 3);       // 0..2 SMALL rocks per cell
  for(let k = 1; k <= n; k++)                     // (the future pickable ones)
    specs.push({k, big: false,
      x: (i + hash(i, j, 70 + k*3)) * ROCK_CELL,
      z: (j + hash(i, j, 71 + k*3)) * ROCK_CELL,
      s: 0.16 + hash(i, j, 72 + k*3) * 0.3});     // radius 0.16..0.46 m
  return specs;
}

const activeRocks = new Map();   // id -> mesh currently in the scene
const rockPool = [];             // spare meshes, recycled while driving
function updateRocks(cx, cz){
  const ci = Math.round(cx / ROCK_CELL), cj = Math.round(cz / ROCK_CELL);
  const wanted = new Set();
  for(let i = ci - ROCK_RANGE; i <= ci + ROCK_RANGE; i++)
    for(let j = cj - ROCK_RANGE; j <= cj + ROCK_RANGE; j++)
      for(const sp of rockSpecs(i, j)){
        const id = i + '_' + j + '_' + sp.k;
        /* any rock the rover ever touched with its arms (grabbed or
           re-placed) has left the procedural world: it is tracked by
           carried/placedRocks instead, so the generator must NEVER
           spawn it again at its birth place */
        if(movedRocks.has(id)) continue;
        if(Math.hypot(sp.x, sp.z) < 3) continue;       // keep the spawn point clear
        wanted.add(id);
        if(activeRocks.has(id)) continue;              // already in the scene
        /* golden popcorn boulders and plain rocks come from SEPARATE
           pools: they are different objects (compound vs single mesh) */
        const mesh = sp.golden
          ? (goldenPool.pop() || makeGoldenRock())
          : (rockPool.pop() || new THREE.Mesh(rockGeo, rockMats[0]));
        const h1 = hash(sp.x, sp.z, 80), h2 = hash(sp.x, sp.z, 81);
        if(!sp.golden)
          mesh.material = rockMats[Math.floor(h1 * rockMats.length) % rockMats.length];
        /* squashed on Y + random yaw + slightly sunk = sits naturally */
        mesh.scale.set(sp.s, sp.s * (0.55 + h2 * 0.3), sp.s);
        mesh.rotation.set(0, h1 * Math.PI * 2, 0);
        mesh.position.set(sp.x, terrainH(sp.x, sp.z) + sp.s * 0.18, sp.z);
        mesh.userData = {id, big: sp.big, radius: sp.s, golden: !!sp.golden};
        rockGroup.add(mesh);
        activeRocks.set(id, mesh);
      }
  /* rocks that fell out of range go back to their own pool */
  for(const [id, mesh] of activeRocks)
    if(!wanted.has(id)){
      rockGroup.remove(mesh);
      (mesh.userData.golden ? goldenPool : rockPool).push(mesh);
      activeRocks.delete(id);
    }
}

/* =====================================================================
   ROCK CARRYING (keys P / O) — the rover moves boulders around.
   P: if a big boulder sits right in front, the arms STRETCH out and
      grab it. The rock mesh is re-parented INTO THE CHASSIS with
      .attach() — the hierarchy at work again: as a child of the
      chassis it follows every movement, bounce and tilt of the rover
      for free, no per-frame math needed. While carried it stops
      being an obstacle.
   O: the boulder is set down on the terrain just beyond the rover's
      front and becomes a normal obstacle again.
   T: the boulder is THROWN forward instead: it flies on a ballistic
      arc under real Mars gravity, then ROLLS following the terrain
      gradient — down a crater wall it keeps rolling, oscillates
      across the bowl and settles at the bottom, or it stops early
      against another boulder.
   Bookkeeping: a touched rock leaves the procedural world forever
   (movedRocks marks its id, so updateRocks won't respawn it) and,
   once it comes to rest, lives in placedRocks — a permanent list
   checked by the collision loop together with the procedural rocks.
   ===================================================================== */
const placedRocks = [];                        // boulders the rover re-placed
function* obstacles(){
  yield* activeRocks.values();
  yield* placedRocks;
  /* a thrown rock is STILL solid while it flies and rolls — without
     this the rover could drive straight through it before it settles */
  for(const f of flyingRocks) yield f.mesh;
}

function grabRock(){
  if(carried) return;                          // hands already full
  const fx = -Math.sin(heading), fz = -Math.cos(heading);   // forward direction
  let best = null, bestD = Infinity;
  for(const mesh of obstacles()){
    if(!mesh.userData.big) continue;           // only boulders need the arms
    if(mesh.userData.golden) continue;         // purple ones can't be moved, only shot
    if(flyingRocks.some(f => f.mesh === mesh)) continue;  // can't catch a moving rock
    const dx = mesh.position.x - px, dz = mesh.position.z - pz;
    const d = Math.hypot(dx, dz);
    const reachDist = mesh.userData.radius * 0.85 + 1.0 + 1.8; // contact + arms
    /* must be within reach AND roughly in FRONT of the rover:
       the dot product with the forward direction filters by angle */
    if(d < reachDist && (dx*fx + dz*fz) / (d || 1) > 0.5 && d < bestD){
      best = mesh; bestD = d;
    }
  }
  if(!best) return;                            // nothing in front to take
  /* remove it from whichever collection it currently lives in */
  activeRocks.delete(best.userData.id);
  const k = placedRocks.indexOf(best);
  if(k >= 0) placedRocks.splice(k, 1);
  movedRocks.set(best.userData.id, null);      // generator: never respawn it
  chassis.attach(best);   // new parent, world position preserved (no jump)
  carried = best;         // the loop eases it into the hands from here
}

function dropRock(){
  if(!carried) return;
  rockGroup.attach(carried);                   // back to world space, no jump
  /* set it down on the ground just beyond the rover's front, outside
     the collision circle so the rover isn't instantly pushed back */
  const R = carried.userData.radius;
  const d = R * 0.85 + 1.0 + 0.4;
  const x = px - Math.sin(heading) * d, z = pz - Math.cos(heading) * d;
  carried.position.set(x, terrainH(x, z) + R * 0.18, z);
  carried.rotation.x = 0; carried.rotation.z = 0;   // lies flat again
  /* dropped ON THE CARGO PAD: the boulder is loaded, not placed */
  if(onPad(x, z)){
    loadRockIntoRocket(carried);
    carried = null;
    return;
  }
  movedRocks.set(carried.userData.id, {x, z});      // bookkeeping
  placedRocks.push(carried);                        // permanent obstacle now
  carried = null;                                   // arms retract in the loop
}

/* --- THROWING --- */
const MARS_G = 3.71;          // real Mars gravity, m/s^2
const flyingRocks = [];       // rocks currently flying or rolling
const _rollAxis = new THREE.Vector3();   // scratch vector, reused every frame

function throwRock(){
  if(!carried) return;
  const mesh = carried;
  carried = null;                        // arms retract in the loop
  rockGroup.attach(mesh);                // back to world space, keeps position
  /* a gentle toss, not a hurl: barely forward and up — the rock lands
     a couple of metres ahead; moving adds a little momentum */
  const v0 = 2.5 + Math.max(0, vel) * 0.3;
  /* 'ghost': for the first instants the rock is not an obstacle for
     the rover — it spawns right at the hands, inside the rover's own
     collision circle, and would otherwise shove the rover backwards
     the moment it is released */
  mesh.userData.ghost = true;
  flyingRocks.push({mesh, age: 0,
    vx: -Math.sin(heading) * v0,
    vy: 1.8,
    vz: -Math.cos(heading) * v0});
}

/* =====================================================================
   SHOOTING (key F) — the rover blasts the purple boulders to pieces
   A continuous green laser fires from the rover's head, straight ahead.
   If it hits a purple rock, the rock explodes: it disappears from
   every bookkeeping structure for good (movedRocks guarantees it
   never respawns) and bursts into a dozen small fragments that fly
   outward, fall back under Mars gravity, bounce, then shrink away —
   debris, not permanent objects, so the scene stays clean.
   ===================================================================== */
/* =====================================================================
   EMERALDS: green gems hidden inside the purple boulders.
   Blasting a purple rock releases 1..3 of them: scatter around
   the blast point and stay there spinning and BOBBING like game
   collectibles. 
   ===================================================================== */
const emeralds = [];
const emeraldGeo = new THREE.OctahedronGeometry(0.22, 0);
const emeraldMat = new THREE.MeshStandardMaterial({color: 0x2ecc4f,
  emissive: 0x1d8f33, emissiveIntensity: 0.7,
  roughness: 0.15, metalness: 0.3,
  transparent: true, opacity: 0.7});   // slightly see-through, gem-like

function spawnEmeralds(x, z, rockId){
  const n = 1 + Math.floor(Math.random() * 3);       // 1..3 gems per boulder
  for(let k = 0; k < n; k++){
    const gem = new THREE.Mesh(emeraldGeo, emeraldMat);
    gem.scale.set(1, 1.55, 1);                       // plumbob proportions
    const a = Math.random() * Math.PI * 2, d = 0.6 + Math.random() * 1.4;
    const gx = x + Math.cos(a) * d, gz = z + Math.sin(a) * d;
    gem.position.set(gx, terrainH(gx, gz) + 1.6, gz);   // floats high, eye level
    gem.userData = {emerald: true, id: rockId + '_gem' + k}; // future pickup hook
    scene.add(gem);
    emeralds.push({mesh: gem, baseY: gem.position.y,
                   phase: Math.random() * Math.PI * 2});
  }
}

/* =====================================================================
   EMERALD PICKUP — drive over a gem to collect it.
   Every frame the emeralds array is scanned (same array the bobbing
   animation iterates); any gem within reach of the rover disappears
   with a little sparkle. A green counter appears in the hud the moment
   the first gem is collected and counts up to GEM_GOAL (set by the
   game mode picked on the start screen).
   ===================================================================== */
let gemCount = 0;
let GEM_GOAL = 10;     // set by the menu mode buttons: EASY 10 · HARD 17
const PICKUP_DIST = 1.6;              // horizontal reach, in metres
const gemHud = document.getElementById('gems');

function collectEmeralds(){
  for(let i = emeralds.length - 1; i >= 0; i--){
    const m = emeralds[i].mesh;
    const dx = m.position.x - px, dz = m.position.z - pz;
    if(dx*dx + dz*dz > PICKUP_DIST * PICKUP_DIST) continue;
    /* a burst of tiny green shards marks the pickup — reuses the
       explosion-debris system, so the shards fall, bounce and fade */
    spawnPickupSparkle(m.position);
    scene.remove(m);
    emeralds.splice(i, 1);
    gemCount = Math.min(gemCount + 1, GEM_GOAL);
    gemHud.style.display = 'block';   // first pickup reveals the counter
    gemHud.textContent = '✦ ' + gemCount + ' / ' + GEM_GOAL +
                         (gemCount >= GEM_GOAL ? '  ✓' : '');
    checkLaunch();     // the last gem can be what completes the mission
  }
}

/* a handful of tiny gem shards thrown upward; they ride the same
   updateFragments physics as the boulder debris (fall, bounce, fade) */
function spawnPickupSparkle(P){
  for(let k = 0; k < 6; k++){
    const fm = new THREE.Mesh(emeraldGeo, emeraldMat);
    const s = 0.25 + Math.random() * 0.2;
    fm.scale.set(s, s, s);
    fm.position.copy(P);
    const a = Math.random() * Math.PI * 2;
    fragments.push({mesh: fm, life: 0.8 + Math.random() * 0.4,
      vx: Math.cos(a) * 1.2, vy: 2 + Math.random() * 1.5, vz: Math.sin(a) * 1.2,
      rx: (Math.random()-0.5) * 10, rz: (Math.random()-0.5) * 10});
    scene.add(fm);
  }
}

const lasers = [];       // beams currently fading out
const fragments = [];    // debris from exploded boulders
const laserGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6);
const flashGeo = new THREE.SphereGeometry(0.16, 8, 6);
const LASER_RANGE = 45;
const _up = new THREE.Vector3(0, 1, 0);

/* laser: the hit is instant (hit-scan). We march
   along the ray until the terrain or a boulder stops it, then draw a
   solid green beam from the muzzle to that exact point. */
function shoot(){
  const fx = -Math.sin(heading), fz = -Math.cos(heading);
  /* The beam follows the hea tilt, with a small
     natural droop — so by default it meets the ground ~30 m ahead
     instead of flying level over every low boulder. The muzzle also
     sits lower than the eyes, closer to boulder height. */
  const p = eyePitch - 0.04;
  const cp = Math.cos(p), sp2 = Math.sin(p);
  const dx3 = fx * cp, dy3 = sp2, dz3 = fz * cp;   // unit ray direction
  const oy = terrainH(px, pz) + 1.1;               // muzzle height
  const ox = px + fx*1.2, oz = pz + fz*1.2;
  let hitT = LASER_RANGE, target = null;
  march:
  for(let t = 0; t < LASER_RANGE; t += 0.4){
    const x = ox + dx3*t, y = oy + dy3*t, z = oz + dz3*t;
    if(terrainH(x, z) >= y){ hitT = t; break; }    // the ground stops it
    for(const o of obstacles()){
      if(o === carried || !o.userData.big || o.userData.ghost) continue;
      const dx = x - o.position.x, dz = z - o.position.z;
      /* 2D circle + vertical band: a boulder deep in a crater is NOT
         hit by a beam passing above it */
      if(dx*dx + dz*dz < (o.userData.radius * 0.85)**2 &&
         Math.abs(y - o.position.y) < o.userData.radius * 1.1 + 0.5){
        hitT = t; target = o;
        break march;
      }
    }
  }
  /* only the purple boulders are destructible; a red one (and the
     ground) simply absorbs the beam */
  if(target && target.userData.golden) explodeRock(target);

  /* the visible beam: a thin green cylinder from muzzle to hit point
     (cylinder axis is Y, so a quaternion turns it onto the ray) */
  const mat = new THREE.MeshBasicMaterial({color: 0x22ff44,
                                           transparent: true, opacity: 0.9});
  const beam = new THREE.Mesh(laserGeo, mat);
  beam.scale.y = hitT;
  beam.position.set(ox + dx3*hitT/2, oy + dy3*hitT/2, oz + dz3*hitT/2);
  beam.quaternion.setFromUnitVectors(_up, new THREE.Vector3(dx3, dy3, dz3));
  scene.add(beam);
  const flash = new THREE.Mesh(flashGeo, mat);   // impact flash, same fade
  flash.position.set(ox + dx3*hitT, oy + dy3*hitT, oz + dz3*hitT);
  scene.add(flash);
  lasers.push({beam, flash, mat, life: 0.22});
}

function explodeRock(rock){
  const id = rock.userData.id, R = rock.userData.radius, P = rock.position;
  /* the boulder leaves the world for good, whatever state it was in */
  activeRocks.delete(id);
  const pi = placedRocks.indexOf(rock);
  if(pi >= 0) placedRocks.splice(pi, 1);
  const fi = flyingRocks.findIndex(f => f.mesh === rock);
  if(fi >= 0) flyingRocks.splice(fi, 1);
  movedRocks.set(id, null);            // generator: never respawn it
  rockGroup.remove(rock);
  (rock.userData.golden ? goldenPool : rockPool).push(rock); // recycled later
  /* the burst: small chunks of the same material, thrown outward and
     UP — that upward bias is what makes it read as an explosion */
  const n = 12 + Math.floor(Math.random() * 5);
  for(let k = 0; k < n; k++){
    const fm = new THREE.Mesh(rockGeo, rock.material);
    const s = R * (0.12 + Math.random() * 0.16);
    fm.scale.set(s, s * (0.6 + Math.random() * 0.4), s);
    fm.position.set(P.x, P.y + R * 0.2, P.z);
    fm.rotation.set(Math.random()*3, Math.random()*3, Math.random()*3);
    scene.add(fm);
    const a = Math.random() * Math.PI * 2;        // horizontal direction
    const sp = 1.5 + Math.random() * 3.5;         // horizontal speed
    fragments.push({mesh: fm, life: 2.5 + Math.random() * 1.5,
      vx: Math.cos(a) * sp, vy: 1.5 + Math.random() * 3, vz: Math.sin(a) * sp,
      rx: (Math.random()-0.5) * 8, rz: (Math.random()-0.5) * 8}); // tumble rates
  }
  /* only HALF the purple boulders hide emeralds — decided by a hash
     of the rock's position, so it is deterministic per boulder but
     you never know before blasting it */
  if(rock.userData.golden && hash(P.x, P.z, 130) > 0.5)
    spawnEmeralds(P.x, P.z, id);
  bump = 1;                            // the shockwave shakes the chassis
}

/* the beams don't move — they just fade away quickly */
function updateLasers(dt){
  for(let i = lasers.length - 1; i >= 0; i--){
    const l = lasers[i];
    l.life -= dt;
    l.mat.opacity = Math.max(0, l.life / 0.22) * 0.9;
    if(l.life <= 0){
      scene.remove(l.beam); scene.remove(l.flash);
      lasers.splice(i, 1);
    }
  }
}

function updateFragments(dt){
  for(let i = fragments.length - 1; i >= 0; i--){
    const f = fragments[i], m = f.mesh;
    f.life -= dt;
    f.vy -= MARS_G * dt;                            // ballistic fall
    m.position.x += f.vx * dt;
    m.position.y += f.vy * dt;
    m.position.z += f.vz * dt;
    m.rotation.x += f.rx * dt;                      // tumbling in the air
    m.rotation.z += f.rz * dt;
    const gy = terrainH(m.position.x, m.position.z) + m.scale.y * 0.5;
    if(m.position.y < gy){                          // damped bounce
      m.position.y = gy;
      f.vy = Math.abs(f.vy) * 0.35;
      f.vx *= 0.6; f.vz *= 0.6; f.rx *= 0.6; f.rz *= 0.6;
    }
    /* near the end of its life the fragment shrinks to nothing */
    if(f.life < 0.6) m.scale.multiplyScalar(Math.max(0, 1 - dt * 2.5));
    if(f.life <= 0){ scene.remove(m); fragments.splice(i, 1); }
  }
}

/* one physics step for every airborne/rolling rock, called each frame */
function updateFlyingRocks(dt){
  for(let i = flyingRocks.length - 1; i >= 0; i--){
    const f = flyingRocks[i], m = f.mesh, R = m.userData.radius;

    /* the ghost phase ends shortly after launch: from then on the
       rover collides with the rock like with any other boulder */
    f.age += dt;
    if(f.age > 0.6) m.userData.ghost = false;

    /* ballistic integration: gravity pulls, position follows velocity */
    f.vy -= MARS_G * dt;
    m.position.x += f.vx * dt;
    m.position.y += f.vy * dt;
    m.position.z += f.vz * dt;

    /* ground contact: clamp to the terrain; a hard landing bounces a
       little, a soft one transitions into rolling.
       NOTE the rest height: a MOVING rock sits on TOP of the ground
       (~ its half-height, R*0.55), unlike the spawned rocks which are
       deliberately sunk a little to look planted — a rolling stone
       half-buried in the soil would look wrong */
    const gy = terrainH(m.position.x, m.position.z) + R * 0.55;
    let grounded = false;
    if(m.position.y <= gy){
      m.position.y = gy;
      grounded = true;
      if(f.vy < -1.2){ f.vy = -f.vy * 0.35; f.vx *= 0.7; f.vz *= 0.7; }
      else f.vy = 0;
    }
    /* GLUE: rolling downhill, the ground drops away faster than gravity
       pulls the rock down — without this snap the rock spends half the
       time in micro-hops, the slope can only push it intermittently
       and the roll drags on forever */
    else if(m.position.y - gy < 0.3 && f.vy <= 0){
      m.position.y = gy; f.vy = 0; grounded = true;
    }

    /* against another boulder: push out of the overlap and kill the
       horizontal motion — the rock stops where it hit */
    let blocked = false;
    for(const o of obstacles()){
      if(o === m || !o.userData.big) continue;
      const dx = m.position.x - o.position.x, dz = m.position.z - o.position.z;
      const rr = (R + o.userData.radius) * 0.8;
      const d2 = dx*dx + dz*dz;
      if(d2 < rr*rr){
        const d = Math.sqrt(d2) || 1e-6;
        m.position.x = o.position.x + dx/d * rr;
        m.position.z = o.position.z + dz/d * rr;
        f.vx = 0; f.vz = 0;
        blocked = true;
        break;
      }
    }

    if(grounded && f.vy === 0){
      /* ROLLING: the terrain gradient (computed by finite differences,
         like terrainNormal) accelerates the rock downhill; friction
         brakes it. Inside a crater bowl the rock rolls down the wall,
         crosses the bottom, climbs a little, comes back — and the
         oscillation dies out exactly at the lowest point. */
      const e = 0.5, x = m.position.x, z = m.position.z;
      const gx = (terrainH(x+e, z) - terrainH(x-e, z)) / (2*e);
      const gz = (terrainH(x, z+e) - terrainH(x, z-e)) / (2*e);
      if(!blocked){
        f.vx -= gx * MARS_G * 2.5 * dt;
        f.vz -= gz * MARS_G * 2.5 * dt;
      }
      /* Coulomb friction: a constant braking deceleration, like real
         dry friction — unlike viscous friction (v *= factor) it brings
         the rock to a full stop by itself, exactly where the slope is
         no longer steep enough to push it: a few seconds on open
         ground, the bottom of the bowl inside a crater */
      const sp2 = Math.hypot(f.vx, f.vz);
      const brake = 0.35 * MARS_G * dt;
      if(sp2 <= brake){                           // friction wins: at rest
        flyingRocks.splice(i, 1);
        /* came to rest ON THE CARGO PAD: loaded into the rocket */
        if(onPad(x, z)){
          loadRockIntoRocket(m);
          continue;
        }
        m.userData.ghost = false;                 // fully solid again
        movedRocks.set(m.userData.id, {x, z});    // bookkeeping
        placedRocks.push(m);                      // obstacle again
        continue;
      }
      f.vx -= f.vx / sp2 * brake;                 // brake against the motion
      f.vz -= f.vz / sp2 * brake;
      m.position.y = terrainH(x, z) + R * 0.55;   // hug the slope, on TOP of it
    }

    /* visual spin: rotate around the horizontal axis perpendicular to
       the motion, by (distance / radius) — like a real rolling stone */
    const sp = Math.hypot(f.vx, f.vz);
    if(sp > 0.01){
      _rollAxis.set(f.vz / sp, 0, -f.vx / sp);
      m.rotateOnWorldAxis(_rollAxis, sp * dt / Math.max(R, 0.1));
    }
  }
}

/* =====================================================================
   UNLIMITED GROUND.
   terrainH(x,z) is defined EVERYWHERE, but we only draw one 300 m patch;
   driving past its edge used to leave the rover floating on nothing.
   Fix: the patch follows the rover. Its centre snaps to the vertex grid
   (steps of quant), so re-displaced vertices land on exactly the same
   world positions as before and the terrain never "crawls".
   The textures are pinned to the world via texture.offset, otherwise
   they would slide along with the recentred patch.
   ===================================================================== */
const QUANT = SIZE / SEGS;            // vertex spacing (2 m) = snap step
/* the vertices' LOCAL x/z never change — cache them once */
const localX = new Float32Array(posAttr.count);
const localZ = new Float32Array(posAttr.count);
for(let i = 0; i < posAttr.count; i++){
  localX[i] = posAttr.getX(i);
  localZ[i] = posAttr.getZ(i);
}
let groundCx = Infinity, groundCz = Infinity;
function updateGround(x, z){
  const cx = Math.round(x / QUANT) * QUANT;
  const cz = Math.round(z / QUANT) * QUANT;
  if(cx === groundCx && cz === groundCz) return;   // rover still in same cell
  groundCx = cx; groundCz = cz;
  ground.position.set(cx, 0, cz);                  // move the patch...
  for(let i = 0; i < posAttr.count; i++){          // ...and re-shape it
    const wx = localX[i] + cx, wz = localZ[i] + cz;
    const ch = cratersAt(wx, wz);      // negative inside a bowl, + on the rim
    posAttr.setY(i, baseH(wx, wz) + ch);
    /* crater shading: the deeper the point, the darker the ground;
       the rim (ch > 0) gets a touch brighter, like sunlit crater edges */
    const shade = Math.max(0.4, Math.min(1.12, 1 + ch * 0.16));
    colAttr.setXYZ(i, shade, shade, shade);
  }
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
  groundGeo.computeVertexNormals();                // recompute lighting
  groundGeo.attributes.normal.needsUpdate = true;
  /* cancel the patch offset in UV space -> textures stay glued to the world */
  marsTex.map.offset.set(cx / TILE, -cz / TILE);
  marsTex.normal.offset.set(cx / TILE, -cz / TILE);
  /* rocks near the new centre appear, far ones are recycled */
  updateRocks(cx, cz);
}
updateGround(0, 0);                    // initial shape

/* =====================================================================
  THE ROVER AS A HIERARCHY

   Parts are attached to other parts with .add(). A child's position and
   rotation are expressed in its parent space, so moving a parent
   moves all of its children:

     rover (Group)                     <- moving this moves everything
      ├─ tread left / tread right (+ fenders)
      └─ chassis (Group)
          ├─ body box, front hatch
          ├─ 2 × shoulder ─ arm ─ hand        (rotate shoulder = arm swings)
          ├─ neckBase ─ neck
          │           └─ head ─ 2 × eye pods  (rotate head = both eyes tilt)
          ├─ antenna
          └─ beacon

   THREE.Group is an invisible node used as a joint: place the group at
   the pivot point, add the limb inside it shifted away from the pivot,
   and rotating the group rotates the limb around the joint. This is
   what "animations that exploit the hierarchical structure" means.
   The rover faces -Z (the Three.js "forward" convention).
   ===================================================================== */

/* shared materials */
const rustMat  = new THREE.MeshStandardMaterial({color:0xc8862a, roughness:0.62, metalness:0.45});
const darkMat  = new THREE.MeshStandardMaterial({color:0x2b2b28, roughness:0.6,  metalness:0.6});
const steelMat = new THREE.MeshStandardMaterial({color:0x9aa0a8, roughness:0.35, metalness:0.85});

const rover = new THREE.Group();
scene.add(rover);

/* --- chassis: its own Group so it can bounce later without moving the
       treads, which stay glued to the ground --- */
const chassis = new THREE.Group();
chassis.position.y = 0.62;
rover.add(chassis);
chassis.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.95, 1.35), rustMat));
const hatch = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.62, 0.06), darkMat);
hatch.position.set(0, 0, -0.7);        // -Z is the front
chassis.add(hatch);

/* --- retro-reflective safety stripes laid on top of the fenders
       where they are clearly visible from the chase camera. 
       Alternating white/orange plates, slightly emissive so they read as light-catching
       even in shadow, like real reflective tape.*/
const reflWhite  = new THREE.MeshStandardMaterial({color:0xf5f5f0, emissive:0x555550,
                                                   roughness:0.15, metalness:0.85});
const reflOrange = new THREE.MeshStandardMaterial({color:0xff6a1a, emissive:0x7a2a00,
                                                   roughness:0.2,  metalness:0.6});

/* --- treads: children of the rpver, not the chassis.
       Shape: a cylinder laid on its side (axis along X = the width),
       then scaled into an oval: local x is flattened (world height),
       local z is stretched (world length) — a proper tank-track profile.
       Note the order: scale is applied in local space, before rotation. --- */
for(const sx of [-1, 1]){              // sx = -1 left side, +1 right side
  const tread = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.5, 24), darkMat);
  tread.rotation.z = Math.PI/2;        // cylinder axis: Y -> X (sideways)
  tread.scale.set(0.85, 1, 2.7);       // local x = world height, local z = length
  tread.position.set(sx*1.05, 0.31, 0);
  rover.add(tread);
  const fender = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.08, 2.0), rustMat);
  fender.position.set(sx*1.05, 0.68, 0);
  rover.add(fender);

  /* reflective plates lying flat on the fender top, alternating colours
     along its length */
  for(let i = 0; i < 5; i++){
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 0.3),
                                 i % 2 === 0 ? reflWhite : reflOrange);
    plate.position.set(sx*1.05, 0.733, -0.76 + i * 0.38);
    rover.add(plate);
  }
}

/* --- arms: the shoulder group is the joint at the chassis side; the arm
       and hand extend forward from it, so rotating the shoulder swings
       the whole limb --- */
const arms = [];
for(const sx of [-1, 1]){
  const shoulder = new THREE.Group();
  shoulder.position.set(sx*0.78, 0.15, -0.3);
  chassis.add(shoulder);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.85), steelMat);
  arm.position.z = -0.42;              // extends FORWARD from the joint
  shoulder.add(arm);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.24), darkMat);
  hand.position.z = -0.9;              // even further from the joint
  shoulder.add(hand);
  arms.push(shoulder);
}

/* --- neckBase > neck > head > eye pods: the deepest chain.
       'head' is the joint tilted with keys 1/2; both eyes follow because
       they are its children. --- */
const neckBase = new THREE.Group();
neckBase.position.set(0, 0.5, -0.45);
chassis.add(neckBase);
const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.72, 8), steelMat);
neck.position.y = 0.3;
neck.rotation.x = 0.35;                // leaning forward, WALL-E style
neckBase.add(neck);

const head = new THREE.Group();
head.position.set(0, 0.62, -0.24);     // sits on top of the neck
neckBase.add(head);
head.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.3), darkMat));

for(const sx of [-1, 1]){              // two binocular eye pods
  const eye = new THREE.Group();
  eye.position.set(sx*0.21, 0.08, -0.05);
  head.add(eye);
  const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.34, 10), steelMat);
  pod.rotation.x = Math.PI/2;          // cylinder axis along Z = looking forward
  eye.add(pod);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 10),
    new THREE.MeshStandardMaterial({color:0x0a1418, roughness:0.15, metalness:0.9}));
  lens.rotation.x = Math.PI/2;
  lens.position.z = -0.18;
  eye.add(lens);
  const iris = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.055, 12),
    new THREE.MeshBasicMaterial({color:0x7adcff}));  // Basic = glows without light
  iris.position.z = -0.185;
  eye.add(iris);
}
/* --- the EYES camera (key C): a camera is a scene-graph node exactly
       like a mesh, so parking it inside the 'head' group means it
       inherits the FULL hierarchy chain (rover > chassis > neckBase >
       head): it drives with the rover, tilts with the terrain, and
       pans/tilts with keys 1/2/9/0 — first-person from the eyes. */
const eyeCam = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.05, 500);
eyeCam.position.set(0, 0.15, -0.2);    // just above, between the two eye pods
head.add(eyeCam);

/* --- rear license plate with "GGame".
       Text in 3D is done by DRAWING on a 2D canvas and using it as a
       texture (THREE.CanvasTexture) on a small plane. The plane faces
       +Z by default, which is exactly the rover's rear. --- */
{
  /* high-resolution canvas = sharp text when the texture is magnified */
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 288;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f2f2ee';                       // plate background
  ctx.fillRect(0, 0, 1024, 288);
  ctx.fillStyle = '#1a3fa8';                      
  ctx.fillRect(0, 0, 96, 288);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, 1010, 274);                 // border
  ctx.fillStyle = '#111';
  ctx.font = 'bold 190px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('GGame', 560, 154);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.31),
    new THREE.MeshStandardMaterial({map: new THREE.CanvasTexture(cv), roughness: 0.4}));
  plate.position.set(0, -0.2, 0.679);              // rear face of the chassis
  chassis.add(plate);
}

/* --- headlights: two SpotLights at the front of the chassis.
       A SpotLight shines from its position toward a target object;
       lamp, light and target are all children of the chassis, so the
       light cones follow every movement and tilt of the rover
       automatically — hierarchy again. Key L toggles them. --- */
const headlights = [];
for(const sx of [-1, 1]){
  /* the visible lamp: a small emissive cylinder set into the front */
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.06, 12),
    new THREE.MeshStandardMaterial({color: 0xfff6d8, emissive: 0xffe9b0,
                                    emissiveIntensity: 1}));
  lamp.rotation.x = Math.PI/2;           // cylinder face points forward
  lamp.position.set(sx*0.45, 0.28, -0.71);
  chassis.add(lamp);
  /* the actual light: aims forward and slightly down, so the cone
     lands on the ground a few metres ahead of the rover */
  const spot = new THREE.SpotLight(0xffe9c0, 1.6, 45, 0.55, 0.45);
  spot.position.copy(lamp.position);
  const tgt = new THREE.Object3D();
  tgt.position.set(sx*0.45, -1.2, -9);
  chassis.add(tgt);
  spot.target = tgt;
  chassis.add(spot);
  headlights.push({spot, lamp});
}

/* --- antenna + blinking beacon --- */
const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.5, 6), steelMat);
antenna.position.set(0.55, 0.75, 0.4);
antenna.rotation.z = -0.15;
chassis.add(antenna);
const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6),
  new THREE.MeshBasicMaterial({color:0xff4433}));
beacon.position.set(0.59, 1.0, 0.4);
chassis.add(beacon);

/* --- JUMP ROCKETS (key SPACE): two small thruster bells bolted under
       the rear of the hull, one per side, children of the rover group
       so they follow every tilt. Each bell hides an emissive flame
       cone that only shows — and flickers — while the rockets burn. --- */
const flames = [];
for(const sx of [-1, 1]){
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, 0.24, 10), steelMat);
  bell.position.set(sx*0.45, 0.2, 0.45);
  rover.add(bell);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.55, 8),
    new THREE.MeshStandardMaterial({color: 0xffa03c, emissive: 0xff7722,
      emissiveIntensity: 1.8, transparent: true, opacity: 0.85, fog: false}));
  flame.rotation.x = Math.PI;          // cone tip pointing down
  flame.position.set(sx*0.45, -0.15, 0.45);
  flame.visible = false;               // off until lift-off
  rover.add(flame);
  flames.push(flame);
}

/* =====================================================================
   THE ROCKET (the endgame goal): parked on a platform some 45 m from
   the landing site, with a loading RAMP and a glowing CARGO PAD at its
   base. Drop (O) or throw (T) red boulders onto the pad: each one is
   loaded into the hold — it disappears for good and a counter in the
   HUD ticks up. With at least 10 rocks aboard the status lights over
   the hatch (and the pad itself) turn GREEN: the rocket is fuelled
   and ready for the final lift-off.
   ===================================================================== */
const ROCKET_X = 18, ROCKET_Z = -42;   // where the rocket stands
const PAD_DX = 0, PAD_DZ = 6.0;        // cargo pad centre, past the ramp foot
const PAD_R = 2.6;                     // pad radius: dropping inside counts
let ROCKET_GOAL = 5;                   // set by the menu: EASY 5 · HARD 12
let rocketRocks = 0;                   // boulders loaded so far
let rocketReady = false;               // true once the hold is full
const statusMats = [];                 // hatch lamps: red -> green when ready
let padMat;                            // the pad glow, pulsed in the loop
let ship, shipFlame;                   // the part that lifts off + its exhaust
let launchPhase = 0;                   // 0 idle · 1 countdown · 2 flying · 3 gone
let launchT = 0;                       // countdown seconds left / flight time

/* =====================================================================
   MISSION TIMER — 5 minutes, same in both modes. It starts ticking the
   FIRST time a rock is loaded onto the pad and shows mm:ss at the top
   centre of the screen (red in the last 30 s). Reaching the launch
   countdown in time stops it; running out ends the mission — TIME'S
   UP fills the screen and the game reloads back to the menu.
   ===================================================================== */
const MISSION_TIME = 300;              // 5 minutes, in seconds
let timeLeft = 0;
let timerOn = false;
const timerEl = document.getElementById('timer');

function updateTimer(dt){
  if(!timerOn) return;
  if(launchPhase > 0){                 // lift-off underway: made it in time
    timerOn = false;
    timerEl.style.display = 'none';
    return;
  }
  timeLeft -= dt;
  if(timeLeft <= 0){                   // out of time: mission failed
    timerOn = false;
    timerEl.style.display = 'none';
    const countEl = document.getElementById('count');
    countEl.style.display = 'flex';
    countEl.textContent = "TIME'S UP!";
    setTimeout(() => location.reload(), 3500);   // back to the menu
    return;
  }
  const m = Math.floor(timeLeft / 60);
  const s = Math.floor(timeLeft % 60);
  timerEl.style.display = 'block';
  timerEl.textContent = m + ':' + String(s).padStart(2, '0');
  timerEl.style.color = timeLeft < 30 ? '#ff5544' : '#ffd9b0';  // urgency!
}

const rocket = new THREE.Group();
{
  const ry = terrainH(ROCKET_X, ROCKET_Z);
  rocket.position.set(ROCKET_X, ry, ROCKET_Z);
  scene.add(rocket);
  /* the rocket's own livery: BLUE hull, RED nose, deep blue fins,
     WHITE platform/hatch/ramp (dedicated materials — steelMat and
     rustMat are shared with the rover and must not be recolored) */
  const hullMat = new THREE.MeshStandardMaterial({color: 0x2e6fd6,
    roughness: 0.35, metalness: 0.7});
  const trimMat = new THREE.MeshStandardMaterial({color: 0x1a3f8f,
    roughness: 0.4,  metalness: 0.65});
  const noseMat = new THREE.MeshStandardMaterial({color: 0xd63030,
    roughness: 0.4,  metalness: 0.6});
  const whiteMat = new THREE.MeshStandardMaterial({color: 0xf2f2ee,
    roughness: 0.45, metalness: 0.35});
  /* the SHIP sub-group: everything that lifts off lives here (body,
     nose, fins, hatch, lamps, exhaust flame) — platform, ramp and pad
     stay on the ground when it launches */
  ship = new THREE.Group();
  rocket.add(ship);
  /* launch platform + body + nose: classic retro rocket silhouette */
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.5, 16), whiteMat);
  plat.position.y = 0.25; rocket.add(plat);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 4.2, 14), hullMat);
  body.position.y = 2.6; ship.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.02, 1.7, 14), noseMat);
  nose.position.y = 5.55; ship.add(nose);
  /* three fins around the tail */
  for(let k = 0; k < 3; k++){
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.9), trimMat);
    const a = k * Math.PI * 2 / 3;
    fin.position.set(Math.sin(a) * 1.15, 1.1, Math.cos(a) * 1.15);
    fin.rotation.y = a;
    ship.add(fin);
  }
  /* cargo hatch facing the ramp (+Z side, toward the landing site) */
  const hatchR = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.1), whiteMat);
  hatchR.position.set(0, 1.6, 1.08); ship.add(hatchR);
  /* three status lamps above the hatch — red until the hold is full */
  for(let k = -1; k <= 1; k++){
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshStandardMaterial({color: 0xff3b30,
        emissive: 0xa11510, emissiveIntensity: 1.2}));
    lamp.position.set(k * 0.32, 2.35, 1.06);
    ship.add(lamp);
    statusMats.push(lamp.material);
  }
  /* the exhaust flame under the tail: hidden until lift-off, then it
     flickers every frame like the rover's little jump rockets */
  shipFlame = new THREE.Mesh(
    new THREE.ConeGeometry(0.85, 3.2, 12),
    new THREE.MeshStandardMaterial({color: 0xffa03c, emissive: 0xff7722,
      emissiveIntensity: 2.0, transparent: true, opacity: 0.9, fog: false}));
  shipFlame.rotation.x = Math.PI;       // tip pointing DOWN
  shipFlame.position.y = -1.1;
  shipFlame.visible = false;
  ship.add(shipFlame);
  /* loading ramp: foot on the ground by the pad, top at the hatch */
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 4.6), whiteMat);
  ramp.position.set(0, 0.85, 3.2);
  ramp.rotation.x = 0.35;             // +Z end down at the pad, -Z end up
  rocket.add(ramp);
  /* the CARGO PAD: a glowing disc lying on the terrain at the ramp foot */
  padMat = new THREE.MeshStandardMaterial({color: 0x552222,
    emissive: 0xcc3322, emissiveIntensity: 0.7,
    transparent: true, opacity: 0.85});
  const pad = new THREE.Mesh(new THREE.CircleGeometry(PAD_R, 24), padMat);
  pad.rotation.x = -Math.PI/2;
  pad.position.set(PAD_DX,
    terrainH(ROCKET_X + PAD_DX, ROCKET_Z + PAD_DZ) - ry + 0.05, PAD_DZ);
  rocket.add(pad);
}

/* is a world point inside the cargo pad? */
function onPad(x, z){
  const dx = x - (ROCKET_X + PAD_DX), dz = z - (ROCKET_Z + PAD_DZ);
  return dx*dx + dz*dz < PAD_R * PAD_R;
}

/* a boulder landed on the pad: load it into the hold. Same permanent
   bookkeeping as the explosion — the rock leaves the world for good. */
const cargoHud = document.getElementById('cargo');
function loadRockIntoRocket(mesh){
  activeRocks.delete(mesh.userData.id);
  const pi = placedRocks.indexOf(mesh);
  if(pi >= 0) placedRocks.splice(pi, 1);
  movedRocks.set(mesh.userData.id, null);      // generator: never respawn it
  rockGroup.remove(mesh);
  rockPool.push(mesh);                         // recycled by the generator
  /* the FIRST rock on the pad starts the 5-minute mission timer */
  if(!timerOn && timeLeft === 0 && launchPhase === 0){
    timerOn = true;
    timeLeft = MISSION_TIME;
  }
  rocketRocks++;
  cargoHud.style.display = 'block';            // first rock reveals the counter
  cargoHud.textContent = '● ' + rocketRocks + ' / ' + ROCKET_GOAL +
                         (rocketRocks >= ROCKET_GOAL ? '  ✓' : '');
  if(rocketRocks >= ROCKET_GOAL && !rocketReady){
    rocketReady = true;
    for(const sm of statusMats){
      sm.color.setHex(0x2eff6a); sm.emissive.setHex(0x1daa44);
    }
    padMat.color.setHex(0x225522); padMat.emissive.setHex(0x1daa44);
  }
  checkLaunch();
}

/* lift-off needs BOTH goals: the hold full of rocks AND all the
   emeralds collected — called after every rock load and gem pickup */
function checkLaunch(){
  if(launchPhase === 0 && rocketReady && gemCount >= GEM_GOAL){
    launchPhase = 1; launchT = 3;              // start the countdown: 3, 2, 1...
  }
}

/* =====================================================================
   LAUNCH SEQUENCE — runs once the hold is full.
   Phase 1: a big 3 · 2 · 1 countdown in the middle of the screen.
   Phase 2: the ship (body, nose, fins — NOT platform/ramp/pad) climbs
            on an accelerating arc with a flickering exhaust flame,
            slowly rolling, until it is far above the fog and vanishes.
   ===================================================================== */
const countEl = document.getElementById('count');
function updateLaunch(dt){
  if(launchPhase === 1){                       // countdown
    launchT -= dt;
    const n = Math.ceil(launchT);
    countEl.style.display = 'flex';   // flex = the number sits dead centre
    countEl.textContent = n > 0 ? n : 'LIFT-OFF!';
    if(launchT <= -0.8){                       // LIFT-OFF! lingers a beat
      countEl.style.display = 'none';
      launchPhase = 2; launchT = 0;
      shipFlame.visible = true;
    }
  }
  else if(launchPhase === 2){                  // climbing
    launchT += dt;
    /* a gentle, MAJESTIC ascent: barely lifting for the first seconds
       (the flame roaring on the pad), then slowly gathering speed —
       about 17 s from ignition to vanishing point */
    ship.position.y = launchT * launchT * 0.9;
    ship.rotation.y += dt * 0.25;              // a slow, elegant roll
    shipFlame.scale.set(1, 0.8 + Math.random() * 0.5, 1);  // flicker
    /* 10 s into the climb, with the rocket still shrinking into the
       sky, MISSION ACCOMPLISHED fades in among the stars — a brand
       new constellation, centred on the sky the ship is climbing into */
    if(launchT >= 10 && !skyTextBuilt){
      skyTextBuilt = true;
      const dx = ROCKET_X - px, dz = ROCKET_Z - pz;
      buildSkyText(dx*dx + dz*dz > 1 ? Math.atan2(dx, -dz) : -heading);
    }
    if(ship.position.y > 260){                 // far above the fog: gone
      ship.visible = false;
      launchPhase = 3;
    }
  }
}

/* =====================================================================
   DRIVING = state + integration.
   The vehicle is three numbers: position (px,pz), heading, velocity.
   Each frame: read keys -> update velocity/heading -> move -> then just
   LOOK UP the terrain height at the new position and place the rover
   there. No physics engine needed.
   ===================================================================== */
let px = 0, pz = 0;    // position on the map
let heading = 0;       // facing direction in radians (0 = facing -Z)
let vel = 0;           // signed speed (negative = reverse)
let eyePitch = 0;      // head tilt controlled with keys 1/2
let eyeYaw = 0;        // head pan (left/right) controlled with keys 9/0
let bump = 0;          // 1 right after driving over a small rock, fades to 0
let eyeView = false;   // C: false = chase camera, true = rover's eyes
let lightsOn = true;   // L: headlights on/off
let carried = null;    // the boulder mesh currently in the hands (or null)
let reach = 0;         // arm extension 0..1, eased every frame
let jumpH = 0;         // height ABOVE the terrain while jumping
let jumpVel = 0;       // vertical speed of the jump
let airborne = false;  // true from lift-off to touchdown

/* =====================================================================
   MUSIC (key M) — browsers only allow audio AFTER a user gesture, so
   the Audio object is created lazily on the first M press.
   Loops 'soundtrack.mp3', which sits next to index.html.
   ===================================================================== */
let musicOn = false, musicFile = null;
function toggleMusic(){
  musicOn = !musicOn;
  if(musicOn){
    if(!musicFile){
      musicFile = new Audio('soundtrack.mp3');
      musicFile.loop = true; musicFile.volume = 0.55;
    }
    musicFile.play();
  } else if(musicFile) musicFile.pause();
}

/* =====================================================================
   START SCREEN — the Mars scene renders live behind the translucent
   menu; PLAY removes it and unlocks the keyboard. The music button is
   a click = a valid user gesture, so the browser lets audio start
   right from the menu.
   ===================================================================== */
let started = false;
document.getElementById('playBtn').addEventListener('click', () => {
  started = true;
  document.getElementById('menu').style.display = 'none';
});

/* GAME MODES — picked on the start screen, before PLAY:
   EASY: 10 crystals + 5 rocks · HARD: 17 crystals + 12 rocks.
   Switching mode rewrites the goals and every number shown in the
   hints (the .goalGems / .goalRocks spans). Easy is the default. */
function setMode(hard){
  GEM_GOAL    = hard ? 17 : 10;
  ROCKET_GOAL = hard ? 12 : 5;
  document.getElementById('easyBtn').classList.toggle('on', !hard);
  document.getElementById('hardBtn').classList.toggle('on', hard);
  for(const el of document.querySelectorAll('.goalGems'))  el.textContent = GEM_GOAL;
  for(const el of document.querySelectorAll('.goalRocks')) el.textContent = ROCKET_GOAL;
}
document.getElementById('easyBtn').addEventListener('click', () => setMode(false));
document.getElementById('hardBtn').addEventListener('click', () => setMode(true));
setMode(false);                        // easy by default
document.getElementById('musicBtn').addEventListener('click', e => {
  toggleMusic();
  e.target.classList.toggle('on', musicOn);
});

const keys = {};
addEventListener('keydown', e => {
  if(!started) return;                 // keyboard is locked on the menu
  keys[e.code] = true;
  if(e.code === 'KeyC') eyeView = !eyeView;      // switch viewpoint
  if(e.code === 'KeyL') lightsOn = !lightsOn;    // toggle headlights
  if(e.code === 'KeyM') toggleMusic();           // soundtrack on/off
  if(e.code === 'KeyP') grabRock();              // stretch the arms and grab
  if(e.code === 'KeyO') dropRock();              // set the boulder down
  if(e.code === 'KeyT') throwRock();             // hurl it forward
  /* hands full = no shooting: the arms hold the boulder right in front
     of the head, the laser would blast the cargo */
  if(e.code === 'KeyF' && !carried) shoot();     // fire at the boulders
  /* SPACE fires the jump rockets — only from the ground, no double
     jump, and NOT while carrying a boulder: too heavy to lift */
  if(e.code === 'Space' && !airborne && !carried){
    e.preventDefault();
    airborne = true;
    jumpVel = 4.8;      // lift-off speed: ~3 m apex under Mars gravity
  }
  if(e.code === 'KeyR'){ px = 0; pz = 0; heading = 0; vel = 0; eyePitch = 0; eyeYaw = 0;
                         jumpH = 0; jumpVel = 0; airborne = false; }
  /* V — shortcut straight to the finale: the 3·2·1 countdown, lift-off
     and the constellation, no rocks or crystals needed */
  if(e.code === 'KeyV' && launchPhase === 0){ launchPhase = 1; launchT = 3; }
});
addEventListener('keyup', e => keys[e.code] = false);

/* =====================================================================
   The animation loop ties everything together.
   dt = seconds since the previous frame: multiplying every speed by dt
   makes motion frame-rate independent.
   ===================================================================== */
const clock = new THREE.Clock();
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);  // clamp huge dt (tab switch)
  const t = clock.elapsedTime;

  /* --- driving --- */
  const acc = (keys['ArrowUp'] ? 8 : 0) + (keys['ArrowDown'] ? -6 : 0);
  vel += acc * dt;
  /* friction: STRONG only while coasting (no key pressed), almost none
     while accelerating — otherwise it eats the acceleration and caps
     the real top speed far below the clamp */
  vel -= vel * (acc === 0 ? 2.2 : 0.15) * dt;
  vel = Math.max(-6, Math.min(13, vel));        // clamp

  /* steering (inverted when reversing, like a real car) */
  const turn = (keys['ArrowLeft'] ? 1 : 0) - (keys['ArrowRight'] ? 1 : 0);
  heading += turn * 1.4 * dt * (vel < -0.5 ? -1 : 1);

  /* move along the heading; heading=0 faces -Z */
  px += -Math.sin(heading) * vel * dt;
  pz += -Math.cos(heading) * vel * dt;

  /* --- collision with rocks: the rover cannot drive through them.
     Both rover and rock are treated as circles on the ground plane
     (cheap and robust). If the new position enters a rock's circle,
     the rover is pushed back out to the contact edge and stopped —
     it hits the rock and can't go further, but steering lets it
     slide around the obstacle.
     Two classes, two behaviours:
     - small rocks never block: the treads climb over them; driving
       over one triggers a short jolt (the 'bump' variable) that
       shakes the chassis and eats a bit of speed — bigger stone,
       bigger jolt.
     - big boulders always stop the rover.
  */
  for(const mesh of obstacles()){
    if(mesh === carried) continue;
    if(mesh.userData.ghost) continue;   // just-thrown rock, still leaving the hands
    const R = mesh.userData.radius;
    if(jumpH > R * 1.3 + 0.3) continue; // high enough: the rover flies OVER it
    const dx = px - mesh.position.x, dz = pz - mesh.position.z;
    const d2 = dx*dx + dz*dz;
    if(!mesh.userData.big){                        // small: always crossable
      if(d2 < (R + 0.9)**2 && Math.abs(vel) > 0.3){
        bump = Math.min(1, 0.4 + R * 1.6);         // jolt scales with the stone
        vel *= 1 - 1.2 * dt;                       // the stone steals some speed
      }
      continue;
    }
    const rr = R * 0.85 + 1.0;                     // rock radius + rover half-size
    if(d2 < rr*rr){
      const d = Math.sqrt(d2) || 1e-6;             // distance (guard centre hit)
      px = mesh.position.x + dx/d * rr;            // back out to the contact circle
      pz = mesh.position.z + dz/d * rr;
      vel = 0;                                     // the impact stops the rover
    }
  }
  /* the rocket platform is solid too (pad and ramp are drive-over) */
  {
    const dx = px - ROCKET_X, dz = pz - ROCKET_Z;
    const rr = 2.8 + 1.0;                          // platform radius + rover
    const d2 = dx*dx + dz*dz;
    if(d2 < rr*rr && jumpH < 4){                   // you can't jump THAT high
      const d = Math.sqrt(d2) || 1e-6;
      px = ROCKET_X + dx/d * rr;
      pz = ROCKET_Z + dz/d * rr;
      vel = 0;
    }
  }
  bump = Math.max(0, bump - dt * 4);               // the jolt fades out quickly

  /* the ground patch follows the rover: the world never ends */
  updateGround(px, pz);

  /* --- jump: a simple ballistic arc ABOVE the terrain height.
     jumpH is an offset over the ground, so terrain-following keeps
     working underneath: land on a slope and you land ON the slope.
     Real Mars gravity makes the arc pleasantly floaty. */
  if(airborne){
    jumpVel -= MARS_G * dt;
    jumpH += jumpVel * dt;
    if(jumpH <= 0){                    // touchdown
      jumpH = 0; jumpVel = 0; airborne = false;
      bump = 0.7;                      // landing jolt shakes the chassis
    }
  }
  /* the flames burn only while the rockets push (rising); a random
     vertical scale every frame makes them flicker like real exhaust */
  for(const f of flames){
    f.visible = airborne && jumpVel > 0;
    if(f.visible) f.scale.set(1, 0.7 + Math.random() * 0.6, 1);
  }

  /* place the rover on the terrain (+ the jump offset) */
  const gy = terrainH(px, pz);
  rover.position.set(px, gy + jumpH, pz);

  /* Tilt the rover to the slope.
     We build an orthonormal basis: 'up' is the terrain normal,
     'fwd' is the heading direction projected onto the ground plane,
     'right' completes the triad. The basis becomes a rotation matrix,
     the matrix a quaternion, and slerp smooths the transition so the
     rover doesn't snap when the slope changes (e.g. entering a crater). */
  const up  = terrainNormal(px, pz);
  const fwd = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));
  fwd.addScaledVector(up, -fwd.dot(up)).normalize();  // project onto the slope
  const back  = fwd.clone().negate();                 // basis wants -Z = forward
  const right = new THREE.Vector3().crossVectors(up, back).normalize();
  const m = new THREE.Matrix4().makeBasis(right, up, back);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  rover.quaternion.slerp(q, Math.min(dt*7, 1));

  /* the sky follows the rover: infinite starfield illusion */
  skyGroup.position.set(px, 0, pz);

  /* the sun follows too, so the light direction stays constant
     everywhere the rover goes, not only near the origin */
  sun.position.set(px + 60, 80, pz + 40);
  sun.target.position.set(px, 0, pz);

  /* --- hierarchy animations--- */
  /* head tilt: one rotation and every child (eyes, lenses, irises)
     follows — that is the hierarchy working */
  if(keys['Digit1']) eyePitch = Math.min( 1.15, eyePitch + dt*1.6);
  if(keys['Digit2']) eyePitch = Math.max(-0.55, eyePitch - dt*1.6);
  head.rotation.x = eyePitch;
  /* head pan: 9 = look left, 0 = look right (clamped to ±52°) */
  if(keys['Digit9']) eyeYaw = Math.min( 0.9, eyeYaw + dt*1.6);
  if(keys['Digit0']) eyeYaw = Math.max(-0.9, eyeYaw - dt*1.6);
  head.rotation.y = eyeYaw;

  /* --- rock carrying: the arm extension eases toward 1 while a rock
     is held, back to 0 after the drop; the boulder itself glides into
     the "hands" position in chassis space (it is a chassis child now,
     so a simple local lerp is all it takes) */
  reach += ((carried ? 1 : 0) - reach) * Math.min(dt * 4, 1);
  updateFlyingRocks(dt);               // thrown rocks fly, roll and settle
  updateLasers(dt);                    // laser beams fade out
  updateFragments(dt);                 // explosion debris falls and fades
  if(carried){
    const R = carried.userData.radius;
    carried.position.lerp(
      new THREE.Vector3(0, 0.1 + R * 0.3, -(1.05 + R * 0.8)),
      Math.min(dt * 5, 1));
  }

  /* arms sway more when driving faster; beacon blinks; body bounces
     slightly (only the chassis: treads stay on the ground).
     While grabbing, the sway fades out and the arms reach forward and
     stretch (scaling the shoulder group stretches the whole limb —
     hierarchy again) */
  const sp = Math.abs(vel);
  arms.forEach((a, i) => {
    const sway = Math.sin(t*3 + i*Math.PI) * 0.05 * Math.min(sp, 3)
               + Math.sin(t*0.8 + i) * 0.03;
    a.rotation.x = sway * (1 - reach) - 0.3 * reach;
    a.scale.z = 1 + 1.1 * reach;
  });
  /* the small-rock jolt: fast vertical rattle + a hint of roll on the
     chassis while 'bump' fades — reads as the treads climbing a stone */
  chassis.position.y = 0.62 + Math.sin(t*9) * 0.006 * Math.min(sp, 4)
                     + bump * Math.abs(Math.sin(t*40)) * 0.06;
  chassis.rotation.z = bump * Math.sin(t*33) * 0.04;
  beacon.material.color.setHex((t % 1.2) < 0.15 ? 0xff8877 : 0x661a11);
  /* Polaris twinkles gently — a slow size pulse is enough to make it
     stand out from every other star in the sky */
  polarisMat.size = 6 + Math.sin(t * 2.5) * 1.2;
  /* the victory constellation: a slow fade-in, then the same gentle
     twinkle as Polaris so it reads as real stars */
  for(const ft of skyTextMats)
    ft.mat.opacity += (ft.target - ft.mat.opacity) * Math.min(dt * 0.5, 1);
  for(const stm of skyStarMats) stm.size = 6.5 + Math.sin(t * 2.8) * 1.3;
  /* freed emeralds spin and bob in place, waiting to be collected */
  for(const e of emeralds){
    e.mesh.rotation.y = t * 2.2 + e.phase;
    e.mesh.position.y = e.baseY + Math.sin(t * 2 + e.phase) * 0.08;
  }
  collectEmeralds();                   // drive over a gem to pick it up
  /* the cargo pad breathes so it reads as "put things HERE" */
  padMat.emissiveIntensity = 0.55 + Math.sin(t * 3) * 0.25;
  updateLaunch(dt);                    // countdown + lift-off, when ready
  updateTimer(dt);                     // 5-minute mission clock, once running

  /* headlights: the L key flips 'lightsOn'; the lamps stay softly lit
     when off so the rover front doesn't look broken */
  for(const h of headlights){
    h.spot.visible = lightsOn;
    h.lamp.material.emissiveIntensity = lightsOn ? 1 : 0.06;
  }

  /* --- chase camera: a point behind the rover, smoothed with lerp --- */
  const cx = px + Math.sin(heading) * 7;
  const cz = pz + Math.cos(heading) * 7;
  const cy = Math.max(gy + jumpH + 3.5, terrainH(cx, cz) + 1.5); // don't sink into hills
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(dt * 3, 1));
  /* during lift-off the camera tilts up, following the ship into the
     stars — and stays there, framing the constellation it leaves behind */
  if(launchPhase >= 2){
    const g = Math.min(launchT / 5, 1);            // ease into the tilt
    const dx = ROCKET_X - camera.position.x;
    const dz = ROCKET_Z - camera.position.z;
    const dh = Math.max(Math.hypot(dx, dz), 0.001);
    const sy = rocket.position.y + ship.position.y + 6 - camera.position.y;
    const el = Math.min(Math.atan2(sy, dh), 0.55); // don't crane past the text
    const look = new THREE.Vector3(px, gy + jumpH + 1, pz).lerp(
      new THREE.Vector3(
        camera.position.x + (dx / dh) * Math.cos(el) * 60,
        camera.position.y + Math.sin(el) * 60,
        camera.position.z + (dz / dh) * Math.cos(el) * 60), g);
    camera.lookAt(look);
  }
  else camera.lookAt(px, gy + jumpH + 1, pz);

  /* --- HUD --- */
  document.getElementById('info').textContent =
    'pos ' + px.toFixed(0) + ', ' + pz.toFixed(0) +
    (eyeView ? '  ·  EYE VIEW' : '');

  /* C switches which camera renders: the chase camera keeps lerping in
     the background, so switching back is seamless */
  renderer.render(scene, eyeView ? eyeCam : camera);
}
animate();