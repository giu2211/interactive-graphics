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
     8 - textures/normal maps, headlights, HUD polish

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
sun.position.set(60, 80, 40);          // direction = position -> origin
scene.add(sun);
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
function terrainH(x, z){
  return Math.sin(x*0.021 + 1.7) * Math.cos(z*0.017) * 4.2   // large hills
       + Math.sin(x*0.052) * Math.cos(z*0.047 + 0.8) * 1.6   // medium dunes
       + Math.sin(x*0.19)  * Math.sin(z*0.16) * 0.22;        // small bumps
}

/* build the ground patch: PlaneGeometry is vertical by default, so we
   rotate it flat; after that, vertex Y is "up" and we can set it from
   the height function. */
const SIZE = 300, SEGS = 100;
const groundGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
groundGeo.rotateX(-Math.PI/2);
const posAttr = groundGeo.attributes.position;
for(let i = 0; i < posAttr.count; i++){
  posAttr.setY(i, terrainH(posAttr.getX(i), posAttr.getZ(i)));
}
groundGeo.computeVertexNormals();      // recompute lighting after displacement
const ground = new THREE.Mesh(groundGeo,
  new THREE.MeshStandardMaterial({color: 0x64301a, roughness: 0.97}));  // dark Mars soil
scene.add(ground);

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
/* in stage 6, a THREE.PerspectiveCamera gets added inside each eye group
   exactly like the lens — cameras are scene-graph nodes too */

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

const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
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

  /* place the rover ON the terrain — just ask the height function.
     (It stays level on slopes for now: stage 4 tilts it using the
     terrain normal and a quaternion.) */
  const gy = terrainH(px, pz);
  rover.position.set(px, gy, pz);
  rover.rotation.y = heading;

  /* the sky follows the rover: infinite starfield illusion */
  skyGroup.position.set(px, 0, pz);

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
  chassis.position.y = 0.62 + Math.sin(t*9) * 0.006 * Math.min(sp, 4);
  beacon.material.color.setHex((t % 1.2) < 0.15 ? 0xff8877 : 0x661a11);

  /* --- chase camera: a point behind the rover, smoothed with lerp --- */
  const cx = px + Math.sin(heading) * 7;
  const cz = pz + Math.cos(heading) * 7;
  const cy = Math.max(gy + 3.5, terrainH(cx, cz) + 1.5); // don't sink into hills
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(dt * 3, 1));
  camera.lookAt(px, gy + 1, pz);

  /* --- HUD --- */
  document.getElementById('info').textContent =
    'pos ' + px.toFixed(0) + ', ' + pz.toFixed(0);

  renderer.render(scene, camera);
}
animate();