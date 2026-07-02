/* =====================================================================
   GGame.js — Mars Rover project, stages 1+2+3 integrated.

   STAGE 1: renderer / scene / camera / lights / animation loop
   STAGE 2: procedural terrain (a height FUNCTION) + arrow-key driving
   STAGE 3: the rover as a HIERARCHICAL MODEL (the core requirement)

   Not here yet (next stages):
     4 - tilt the rover to the terrain slope (quaternion from normal)
     5 - tread scrolling, dust, more animations
     6 - the two eye cameras with picture-in-picture feeds
     7 - sky dome, stars, the whole solar system
     8 - headlights, HUD polish (ground color+bump textures: done)

   'THREE' is the global created by three.min.js, loaded before this
   file in index.html.
   ===================================================================== */
'use strict';

/* =====================================================================
   STAGE 1 — the skeleton every Three.js app has
   ===================================================================== */

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
   - the group FOLLOWS the rover in the loop, so the sky never gets
     closer no matter how far you drive (like a real sky)
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
   STAGE 2a — TERRAIN AS A FUNCTION.
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
   STAGE 8 (arrived early) — PROCEDURAL MARS TEXTURES.
   THREE texture KINDS (the requirement says "textures of different
   kinds (color, normal, specular, …)"):
   - a COLOR map   on the ground: rust base + tone patches + pebbles
   - a NORMAL map  on the ground: computed from the height canvas,
                   RGB-encoded tangent-space normals — the lighting
                   reacts to fake detail without adding any geometry
   - a BUMP map    on the rocks: grayscale height detail
   (Three.js ignores bumpMap when normalMap is present on the SAME
   material, which is why the two kinds live on different objects.)
   Everything is drawn on 2D canvases (like the license plate) so the
   repo needs no image files. Blobs are stamped at 9 wrapped positions
   so the textures TILE seamlessly with RepeatWrapping.
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
   (unlimited) surface, in a DARKER RED than the soil.
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
   The rocks carry the BUMP texture (third texture kind): grayscale
   height detail that roughens their lighting. */
const rockMats = [0x6b2115, 0x7a2a1a, 0x581b10].map(c =>
  new THREE.MeshStandardMaterial({color: c, roughness: 0.92, metalness: 0.05,
                                  bumpMap: marsTex.rockBump, bumpScale: 0.25}));
const rockGeo = new THREE.DodecahedronGeometry(1, 0);   // low-poly boulder shape

const movedRocks = new Map();   // future pickup feature writes here

/* deterministic list of the rocks belonging to one grid cell */
function rockSpecs(i, j){
  const specs = [];
  if(hash(i, j, 60) > 0.84)                       // BIG boulder: ~1 cell in 6
    specs.push({k: 0, big: true,
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
        if(movedRocks.get(id) === null) continue;      // picked up, not dropped yet
        if(Math.hypot(sp.x, sp.z) < 3) continue;       // keep the spawn point clear
        wanted.add(id);
        if(activeRocks.has(id)) continue;              // already in the scene
        const mesh = rockPool.pop() || new THREE.Mesh(rockGeo, rockMats[0]);
        const h1 = hash(sp.x, sp.z, 80), h2 = hash(sp.x, sp.z, 81);
        mesh.material = rockMats[Math.floor(h1 * rockMats.length) % rockMats.length];
        /* squashed on Y + random yaw + slightly sunk = sits naturally */
        mesh.scale.set(sp.s, sp.s * (0.55 + h2 * 0.3), sp.s);
        mesh.rotation.set(0, h1 * Math.PI * 2, 0);
        const pos = movedRocks.get(id) || sp;          // future: moved rocks re-placed
        mesh.position.set(pos.x, terrainH(pos.x, pos.z) + sp.s * 0.18, pos.z);
        mesh.userData = {id, big: sp.big, radius: sp.s};  // hooks for the pickup
        rockGroup.add(mesh);
        activeRocks.set(id, mesh);
      }
  /* rocks that fell out of range go back to the pool */
  for(const [id, mesh] of activeRocks)
    if(!wanted.has(id)){
      rockGroup.remove(mesh); rockPool.push(mesh); activeRocks.delete(id);
    }
}

/* =====================================================================
   STAGE 2a (continued) — UNLIMITED GROUND.
   terrainH(x,z) is defined EVERYWHERE, but we only draw one 300 m patch;
   driving past its edge used to leave the rover floating on nothing.
   Fix: the patch FOLLOWS the rover. Its centre snaps to the vertex grid
   (steps of QUANT), so re-displaced vertices land on exactly the same
   world positions as before and the terrain never "crawls".
   The textures are pinned to the WORLD via texture.offset, otherwise
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
   STAGE 3 — THE ROVER AS A HIERARCHY (the core exam requirement).

   Parts are ATTACHED to other parts with .add(). A child's position and
   rotation are expressed IN ITS PARENT'S SPACE, so moving a parent
   moves all of its children:

     rover (Group)                     <- moving this moves EVERYTHING
      ├─ tread left / tread right (+ fenders)
      └─ chassis (Group)
          ├─ body box, front hatch
          ├─ 2 × shoulder ─ arm ─ hand        (rotate shoulder = arm swings)
          ├─ neckBase ─ neck
          │           └─ head ─ 2 × eye pods  (rotate head = both eyes tilt)
          ├─ antenna
          └─ beacon

   THREE.Group is an invisible node used as a JOINT: place the group at
   the pivot point, add the limb inside it shifted away from the pivot,
   and rotating the group rotates the limb around the joint. This is
   what "animations that exploit the hierarchical structure" means.
   The rover FACES -Z (the Three.js "forward" convention).
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

/* --- retro-reflective safety stripes laid ON TOP of the fenders
       (the bands covering the treads), where they are clearly visible
       from the chase camera. Alternating white/orange plates, slightly
       emissive so they read as light-catching even in shadow, like
       real reflective tape. Added later, after the fenders exist. --- */
const reflWhite  = new THREE.MeshStandardMaterial({color:0xf5f5f0, emissive:0x555550,
                                                   roughness:0.15, metalness:0.85});
const reflOrange = new THREE.MeshStandardMaterial({color:0xff6a1a, emissive:0x7a2a00,
                                                   roughness:0.2,  metalness:0.6});

/* --- treads: children of the ROVER, not the chassis.
       Shape: a cylinder laid on its side (axis along X = the width),
       then SCALED into an oval: local x is flattened (world height),
       local z is stretched (world length) — a proper tank-track profile.
       Note the order: scale is applied in LOCAL space, before rotation. --- */
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
     along its length (fender top is at y = 0.68 + 0.04) */
  for(let i = 0; i < 5; i++){
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 0.3),
                                 i % 2 === 0 ? reflWhite : reflOrange);
    plate.position.set(sx*1.05, 0.733, -0.76 + i * 0.38);
    rover.add(plate);
  }
}

/* --- arms: the SHOULDER group is the joint at the chassis side; the arm
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
  ctx.fillStyle = '#1a3fa8';                       // EU-style blue band
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
       A SpotLight shines from its position toward a TARGET object;
       lamp, light and target are ALL children of the chassis, so the
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
  /* the actual light: aims forward and slightly DOWN, so the cone
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

/* =====================================================================
   STAGE 2b — DRIVING = state + integration.
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

/* =====================================================================
   MUSIC (key M) — browsers only allow audio AFTER a user gesture, so
   everything is created lazily on the first M press.
   Plan A: loop 'soundtrack.mp3' if such a file sits next to index.html
           (use a track you have the rights to — the real Star Trek
           theme is copyrighted, don't commit it to a public repo).
   Plan B: if the file is missing, synthesize an ORIGINAL space-ambient
           pad live with the Web Audio API: a slow-breathing chord of
           detuned oscillators through a lowpass filter — no imported
           assets, everything generated in code.
   ===================================================================== */
let musicOn = false, musicFile = null, synth = null;
function makeSynthPad(){
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const master = ac.createGain(); master.gain.value = 0;      // faded in below
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 0.6;
  filter.connect(master); master.connect(ac.destination);
  /* a wide, quiet chord (A2, E3, A3, C#4, E4) with slight detune between
     voices = the classic slow "space pad" sound */
  for(const [f, det] of [[110,0],[164.8,3],[220,-4],[277.2,2],[329.6,-3]]){
    const o = ac.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
    const g = ac.createGain(); g.gain.value = 0.05;
    /* each voice breathes at its own very slow rate */
    const lfo = ac.createOscillator(), lg = ac.createGain();
    lfo.frequency.value = 0.05 + Math.random() * 0.08; lg.gain.value = 0.03;
    lfo.connect(lg); lg.connect(g.gain);
    o.connect(g); g.connect(filter);
    o.start(); lfo.start();
  }
  master.gain.linearRampToValueAtTime(1, ac.currentTime + 4); // slow fade-in
  return {ac, master};
}
function toggleMusic(){
  musicOn = !musicOn;
  if(musicOn){
    if(!musicFile && !synth){
      musicFile = new Audio('soundtrack.mp3');   // plan A
      musicFile.loop = true; musicFile.volume = 0.55;
      musicFile.play().catch(() => {             // no file -> plan B
        musicFile = null;
        synth = makeSynthPad();
      });
    }
    else if(musicFile) musicFile.play();
    else synth.ac.resume();
  } else {
    if(musicFile) musicFile.pause();
    if(synth) synth.ac.suspend();
  }
}

/* =====================================================================
   START SCREEN — the Mars scene renders live behind the translucent
   menu; PLAY removes it and unlocks the keyboard. The MUSIC button is
   a click = a valid user gesture, so the browser lets audio start
   right from the menu.
   ===================================================================== */
let started = false;
document.getElementById('playBtn').addEventListener('click', () => {
  started = true;
  document.getElementById('menu').style.display = 'none';
});
document.getElementById('musicBtn').addEventListener('click', e => {
  toggleMusic();
  /* no text on the button: the note glyph glows when music is on */
  e.target.classList.toggle('on', musicOn);
});

const keys = {};
addEventListener('keydown', e => {
  if(!started) return;                 // keyboard is locked on the menu
  keys[e.code] = true;
  if(e.code === 'KeyC') eyeView = !eyeView;      // switch viewpoint
  if(e.code === 'KeyL') lightsOn = !lightsOn;    // toggle headlights
  if(e.code === 'KeyM') toggleMusic();           // soundtrack on/off
  if(e.code === 'KeyR'){ px = 0; pz = 0; heading = 0; vel = 0; eyePitch = 0; eyeYaw = 0; }
});
addEventListener('keyup', e => keys[e.code] = false);

/* =====================================================================
   STAGE 1 (continued) — the animation loop ties everything together.
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
     Both rover and rock are treated as CIRCLES on the ground plane
     (cheap and robust). If the new position enters a rock's circle,
     the rover is pushed back OUT to the contact edge and stopped —
     it hits the rock and can't go further, but steering lets it
     slide around the obstacle.
     TWO CLASSES, two behaviours (the 'big' flag set at spawn time):
     - SMALL rocks never block: the treads climb OVER them; driving
       over one triggers a short jolt (the 'bump' variable) that
       shakes the chassis and eats a bit of speed — bigger stone,
       bigger jolt.
     - BIG boulders always stop the rover.
     Only the ~270 nearby rock meshes are checked, so the cost is
     negligible.
     (Later, the pickup feature can reuse this same loop to detect
     "rover is touching rock X".) */
  for(const mesh of activeRocks.values()){
    const R = mesh.userData.radius;
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
  bump = Math.max(0, bump - dt * 4);               // the jolt fades out quickly

  /* the ground patch follows the rover: the world never ends */
  updateGround(px, pz);

  /* place the rover ON the terrain — just ask the height function */
  const gy = terrainH(px, pz);
  rover.position.set(px, gy, pz);

  /* --- STAGE 4 (arrived early): tilt the rover to the slope.
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

  /* --- hierarchy animations (stage 3 in motion) --- */
  /* head tilt: ONE rotation and every child (eyes, lenses, irises)
     follows — that is the hierarchy working */
  if(keys['Digit1']) eyePitch = Math.min( 1.15, eyePitch + dt*1.6);
  if(keys['Digit2']) eyePitch = Math.max(-0.55, eyePitch - dt*1.6);
  head.rotation.x = eyePitch;
  /* head pan: 9 = look left, 0 = look right (clamped to ±52°) */
  if(keys['Digit9']) eyeYaw = Math.min( 0.9, eyeYaw + dt*1.6);
  if(keys['Digit0']) eyeYaw = Math.max(-0.9, eyeYaw - dt*1.6);
  head.rotation.y = eyeYaw;

  /* arms sway more when driving faster; beacon blinks; body bounces
     slightly (only the chassis: treads stay on the ground) */
  const sp = Math.abs(vel);
  arms.forEach((a, i) =>
    a.rotation.x = Math.sin(t*3 + i*Math.PI) * 0.05 * Math.min(sp, 3)
                 + Math.sin(t*0.8 + i) * 0.03);
  /* the small-rock jolt: fast vertical rattle + a hint of roll on the
     chassis while 'bump' fades — reads as the treads climbing a stone */
  chassis.position.y = 0.62 + Math.sin(t*9) * 0.006 * Math.min(sp, 4)
                     + bump * Math.abs(Math.sin(t*40)) * 0.06;
  chassis.rotation.z = bump * Math.sin(t*33) * 0.04;
  beacon.material.color.setHex((t % 1.2) < 0.15 ? 0xff8877 : 0x661a11);

  /* headlights: the L key flips 'lightsOn'; the lamps stay softly lit
     when off so the rover front doesn't look broken */
  for(const h of headlights){
    h.spot.visible = lightsOn;
    h.lamp.material.emissiveIntensity = lightsOn ? 1 : 0.06;
  }

  /* --- chase camera: a point behind the rover, smoothed with lerp --- */
  const cx = px + Math.sin(heading) * 7;
  const cz = pz + Math.cos(heading) * 7;
  const cy = Math.max(gy + 3.5, terrainH(cx, cz) + 1.5); // don't sink into hills
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(dt * 3, 1));
  camera.lookAt(px, gy + 1, pz);

  /* --- HUD --- */
  document.getElementById('info').textContent =
    'pos ' + px.toFixed(0) + ', ' + pz.toFixed(0) +
    (eyeView ? '  ·  EYE VIEW' : '');

  /* C switches which camera renders: the chase camera keeps lerping in
     the background, so switching back is seamless */
  renderer.render(scene, eyeView ? eyeCam : camera);
}
animate();