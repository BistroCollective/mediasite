"use client";

import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useFBO } from "@react-three/drei";
import * as THREE from "three";
import { Suspense, useEffect, useMemo, useRef } from "react";

/**
 * Scena 3D della sezione MUSIC — pipeline a 4 passi:
 *   1. sfondo psichedelico  → bgRT
 *   2. SOLO strumenti (su trasparente) → instRT
 *   3. feedback ping-pong degli strumenti → buffer delle scie (lunghissime,
 *      deformate, che ciclano colore)
 *   4. compositing: sfondo ⊕ scie (blend screen/difference → colori nuovi,
 *      rilievo inciso) + strumenti NITIDI sopra + grading vintage + grana
 */

const MODELS = [
  "/models/electric-guitar.glb",
  "/models/flute.glb",
  "/models/harp.glb",
  "/models/midi-controller.glb",
  "/models/piano.glb",
  "/models/trumpet2.glb",
];
MODELS.forEach((m) => useGLTF.preload(m));

// griglia regolare a mattoncini (righe sfalsate di mezzo passo) che copre
// TUTTO lo schermo in verticale; ogni slot deriva a sinistra con wrap infinito
const ROWS = 4;
const COLS = 6;
const DRIFT_COUNT = ROWS * COLS;
const DRIFT_SPEED = 0.3; // unità/sec verso sinistra — lento
const TARGET_SIZE = 1.05; // più piccoli → molti di più a schermo
const EDGE_PAD = 1.6; // margine oltre i bordi per il wrap invisibile

// pseudo-random deterministico per slot (niente Math.random → stabile tra i render)
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const rotXRate = (i: number) => (0.05 + ((i * 13) % 5) * 0.02) * (i % 2 ? 1 : -1);
const rotYRate = (i: number) => (0.08 + ((i * 11) % 4) * 0.025) * (i % 3 ? 1 : -1);

const BG_DEPTH = -5;

const psychFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uAspect;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = rot * p * 2.03;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.4;
    float t = uTime * 0.035; // evoluzione molto lenta

    // domain warping: l'onda deforma se stessa → look organico, marmorizzato
    vec2 q = vec2(
      fbm(p + vec2(0.0, 0.0) + t * 0.9),
      fbm(p + vec2(5.2, 1.3) - t * 0.7)
    );
    vec2 r = vec2(
      fbm(p + 3.2 * q + vec2(1.7, 9.2) + t * 0.5),
      fbm(p + 3.2 * q + vec2(8.3, 2.8) - t * 0.4)
    );
    float f = fbm(p + 3.5 * r);

    // palette luminosa e psichedelica (il lato music è quello "bright"):
    // viola vivo, magenta caldo, arancio solare, turchese, acido
    vec3 c1 = vec3(0.26, 0.12, 0.42);
    vec3 c2 = vec3(0.82, 0.22, 0.55);
    vec3 c3 = vec3(1.00, 0.58, 0.16);
    vec3 c4 = vec3(0.16, 0.68, 0.62);
    vec3 c5 = vec3(0.92, 0.95, 0.35);

    vec3 col = mix(c1, c2, smoothstep(0.12, 0.72, f));
    col = mix(col, c3, smoothstep(0.25, 0.9, q.x * q.x) * 0.9);
    col = mix(col, c4, smoothstep(0.35, 0.85, r.y) * 0.75);
    col += c5 * pow(max(f, 0.0), 3.0) * 0.4; // lampi acidi più generosi

    // contrasto morbido + vignettatura leggera interna allo shader
    col = col * col * (3.0 - 2.0 * col);
    col = pow(col, vec3(0.92)); // alza leggermente i mezzitoni
    float vig = 1.0 - 0.28 * dot(vUv - 0.5, vUv - 0.5) * 2.6;
    col *= vig;

    // in linear space: il compositing riapplica il gamma alla fine
    col = pow(col, vec3(2.2));

    gl_FragColor = vec4(col, 1.0);
  }
`;

const psychVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// vertex per i quad fullscreen dei passaggi di post-processing
const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * FEEDBACK delle scie: ogni frame la storia viene ricampionata deformata
 * (deriva lenta + fluttuazione liquida multi-scala + separazione RGB) e
 * decade pianissimo mentre cicla la tinta → scie lunghissime e arcobaleno.
 * Gli strumenti correnti vengono "dipinti" nel buffer.
 */
const feedbackFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uInst;
  uniform sampler2D uPrev;
  uniform float uTime;
  uniform float uPersist;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  vec3 hueShift(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
  }

  void main() {
    vec2 uv = vUv;

    // deriva lentissima verso destra (le scie restano dietro agli strumenti)
    vec2 drag = vec2(-0.0012, 0.00018 * sin(uTime * 0.4));

    // fluttuazione liquida multi-scala: le scie si sciolgono in modo organico
    vec2 swirl =
      (vec2(
        noise(uv * 2.3 + uTime * 0.05),
        noise(uv * 2.3 - uTime * 0.043 + 3.7)
      ) - 0.5) * 0.0075 +
      (vec2(
        noise(uv * 6.1 + uTime * 0.07),
        noise(uv * 6.1 - uTime * 0.06 + 8.2)
      ) - 0.5) * 0.0028;

    vec2 puv = uv + drag + swirl;

    // separazione RGB della storia → frange arcobaleno che si accumulano
    float sep = 0.0035;
    vec3 prev;
    prev.r = texture2D(uPrev, puv + vec2(sep, 0.0)).r;
    prev.g = texture2D(uPrev, puv).g;
    prev.b = texture2D(uPrev, puv - vec2(sep, 0.0)).b;
    float pa = texture2D(uPrev, puv).a;

    // ciclo di tinta + decadimento LENTO → scie lunghe quasi quanto lo schermo
    prev = hueShift(prev, 0.055) * 0.997;
    pa *= 0.9965;

    vec4 inst = texture2D(uInst, uv);
    vec3 rgb = mix(prev * uPersist, inst.rgb, inst.a * 0.92);
    float a = max(pa * uPersist, inst.a);

    gl_FragColor = vec4(rgb, a);
  }
`;

/**
 * COMPOSITING finale: sfondo ⊕ scie con blend screen/difference (i colori si
 * combinano creando tinte nuove), rilievo "inciso" sulle scie, strumenti
 * nitidi sopra, grading pellicola vintage, quantizzazione + grana colorata.
 */
const composeFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uBg;
  uniform sampler2D uTrail;
  uniform sampler2D uInst;
  uniform float uTime;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec2 uv = vUv;
    vec3 bg = texture2D(uBg, uv).rgb;
    vec4 tr = texture2D(uTrail, uv);
    vec4 inst = texture2D(uInst, uv);

    // quanto pesano le scie in questo pixel
    float tl = clamp(dot(tr.rgb, vec3(0.3333)) * 1.5, 0.0, 1.0);

    // blend trippy col fondo: screen (schiarisce) + difference (inverte,
    // crea colori acidi che non esistono in nessuno dei due layer)
    vec3 scr = 1.0 - (1.0 - bg) * (1.0 - tr.rgb);
    vec3 dif = abs(bg - tr.rgb * 1.4);
    vec3 col = mix(bg, mix(scr, dif, 0.5), tl * 0.92);

    // rilievo inciso: derivata direzionale della scia → effetto embossed
    vec3 trOff = texture2D(uTrail, uv + vec2(0.0022, -0.0022)).rgb;
    col += (tr.rgb - trOff) * 1.1;

    // strumenti NITIDI sopra tutto
    col = mix(col, inst.rgb, inst.a);

    // linear → display, poi look pellicola vintage spinto
    col = pow(max(col, 0.0), vec3(1.0 / 2.2));
    col = col * 0.93 + 0.05;
    col = clamp(col, 0.0, 1.0);
    col = col * col * (3.0 - 2.0 * col);

    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, 1.55);
    col += (1.0 - smoothstep(0.0, 0.5, l)) * vec3(-0.045, 0.03, 0.065);
    col += smoothstep(0.55, 1.0, l) * vec3(0.075, 0.035, -0.05);

    // quantizzazione leggera + grana colorata fine → texture analogica
    vec3 q = floor(col * 20.0 + 0.5) / 20.0;
    col = mix(col, q, 0.3);
    vec2 gs = gl_FragCoord.xy;
    float tt = floor(uTime * 24.0) * 1.37;
    vec3 grain = vec3(
      hash(gs + tt),
      hash(gs + tt * 1.7 + 7.1),
      hash(gs - tt + 13.7)
    ) - 0.5;
    col += grain * 0.10 * (0.35 + 0.65 * l);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

function PsychBackground() {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { width, height } = useThree((s) =>
    s.viewport.getCurrentViewport(s.camera, BG_POS),
  );

  useFrame((_, dt) => {
    const m = matRef.current;
    if (!m) return;
    m.uniforms.uTime.value += dt;
    m.uniforms.uAspect.value = width / height;
  });

  return (
    <mesh position={[0, 0, BG_DEPTH]} scale={[width * 1.06, height * 1.06, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={psychVertex}
        fragmentShader={psychFragment}
        uniforms={{ uTime: { value: 0 }, uAspect: { value: 1 } }}
        depthWrite={false}
      />
    </mesh>
  );
}

const BG_POS = new THREE.Vector3(0, 0, BG_DEPTH);

/** Un singolo strumento: normalizzato in dimensione, deriva a sinistra e ruota. */
function Drifter({ url, index }: { url: string; index: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(url);

  // clona e normalizza: stessi ~TARGET_SIZE per tutti, centrati sull'origine
  const object = useMemo(() => {
    const clone = scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const scale = TARGET_SIZE / Math.max(size.x, size.y, size.z, 0.0001);
    const center = box.getCenter(new THREE.Vector3());
    clone.scale.setScalar(scale);
    clone.position.copy(center).multiplyScalar(-scale);
    return clone;
  }, [scene]);

  useFrame(({ clock, viewport }) => {
    const g = groupRef.current;
    if (!g) return;
    const t = clock.elapsedTime;
    const row = Math.floor(index / COLS);
    const col = index % COLS;

    // la griglia garantisce la copertura, ma ogni slot è fortemente
    // "sporcato": jitter su x/y, velocità propria → niente effetto lattice
    const span = viewport.width + EDGE_PAD * 2;
    const spacingX = span / COLS;
    const xJit = (rand(index, 1) - 0.5) * spacingX * 0.9;
    const speed = DRIFT_SPEED * (0.85 + rand(index, 2) * 0.3);
    const raw =
      col * spacingX + (row % 2) * spacingX * 0.5 + xJit - t * speed;
    const x = ((raw % span) + span) % span - span / 2;

    // y: banda della riga ± oltre metà riga → alcuni sbordano su alto/basso
    const rowH = viewport.height / ROWS;
    const yJit = (rand(index, 3) - 0.5) * rowH * 1.15;
    const y = (row + 0.5) * rowH - viewport.height / 2 + yJit;

    g.position.set(x, y, (rand(index, 4) - 0.5) * 1.6);
    g.rotation.x = t * rotXRate(index) + index * 1.7;
    g.rotation.y = t * rotYRate(index) + index * 0.9;
  });

  return (
    <group ref={groupRef}>
      <primitive object={object} />
    </group>
  );
}

function Instruments() {
  return (
    <>
      {Array.from({ length: DRIFT_COUNT }, (_, i) => {
        const row = Math.floor(i / COLS);
        const col = i % COLS;
        // shift di 2 per riga: mai lo stesso modello in colonna
        const url = MODELS[(col + row * 2) % MODELS.length];
        return <Drifter key={i} url={url} index={i} />;
      })}
    </>
  );
}

type Pipeline = {
  orthoCam: THREE.OrthographicCamera;
  fbMat: THREE.ShaderMaterial;
  composeMat: THREE.ShaderMaterial;
  fbScene: THREE.Scene;
  outScene: THREE.Scene;
};

function buildPipeline(): Pipeline {
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fbMat = new THREE.ShaderMaterial({
    vertexShader: quadVertex,
    fragmentShader: feedbackFragment,
    uniforms: {
      uInst: { value: null },
      uPrev: { value: null },
      uTime: { value: 0 },
      uPersist: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const composeMat = new THREE.ShaderMaterial({
    vertexShader: quadVertex,
    fragmentShader: composeFragment,
    uniforms: {
      uBg: { value: null },
      uTrail: { value: null },
      uInst: { value: null },
      uTime: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const fbScene = new THREE.Scene();
  fbScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fbMat));
  const outScene = new THREE.Scene();
  outScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), composeMat));
  return { orthoCam, fbMat, composeMat, fbScene, outScene };
}

/**
 * Pipeline di rendering (prende il controllo del render loop):
 * sfondo → RT, strumenti → RT trasparente, feedback ping-pong delle scie,
 * compositing finale → schermo.
 */
function Effects({
  bgScene,
  instScene,
}: {
  bgScene: THREE.Scene;
  instScene: THREE.Scene;
}) {
  const { gl, camera } = useThree();
  // HalfFloat: il feedback ripetuto su 8 bit produrrebbe banding nelle scie
  const bgRT = useFBO({ type: THREE.HalfFloatType });
  const instRT = useFBO({ type: THREE.HalfFloatType });
  const accumA = useFBO({ type: THREE.HalfFloatType });
  const accumB = useFBO({ type: THREE.HalfFloatType });

  const pipelineRef = useRef<Pipeline | null>(null);
  const flip = useRef(false);
  const frames = useRef(0);

  useEffect(() => {
    const p = buildPipeline();
    pipelineRef.current = p;
    return () => {
      pipelineRef.current = null;
      p.fbMat.dispose();
      p.composeMat.dispose();
      p.fbScene.children.forEach((m) => (m as THREE.Mesh).geometry.dispose());
      p.outScene.children.forEach((m) => (m as THREE.Mesh).geometry.dispose());
    };
  }, []);

  useFrame((_, dt) => {
    const p = pipelineRef.current;
    if (!p) return;
    frames.current += 1;

    gl.setClearColor(0x000000, 0);

    // 1) sfondo psichedelico → RT
    gl.setRenderTarget(bgRT);
    gl.render(bgScene, camera);

    // 2) SOLO strumenti su fondo trasparente → RT
    gl.setRenderTarget(instRT);
    gl.render(instScene, camera);

    // 3) feedback ping-pong: storia deformata + strumenti correnti
    const prev = flip.current ? accumA : accumB;
    const next = flip.current ? accumB : accumA;
    p.fbMat.uniforms.uInst.value = instRT.texture;
    p.fbMat.uniforms.uPrev.value = prev.texture;
    p.fbMat.uniforms.uTime.value += dt;
    // i primi frame partono senza storia (il buffer è vuoto)
    p.fbMat.uniforms.uPersist.value = frames.current < 3 ? 0 : 1;
    gl.setRenderTarget(next);
    gl.render(p.fbScene, p.orthoCam);

    // 4) compositing finale → schermo
    p.composeMat.uniforms.uBg.value = bgRT.texture;
    p.composeMat.uniforms.uTrail.value = next.texture;
    p.composeMat.uniforms.uInst.value = instRT.texture;
    p.composeMat.uniforms.uTime.value += dt;
    gl.setRenderTarget(null);
    gl.render(p.outScene, p.orthoCam);

    flip.current = !flip.current;
  }, 1);

  return null;
}

/** Monta sfondo e strumenti in due scene separate (via portal) + pipeline. */
function PipelineRoot() {
  const bg = useMemo(() => new THREE.Scene(), []);
  const inst = useMemo(() => new THREE.Scene(), []);

  return (
    <>
      {createPortal(<PsychBackground />, bg)}
      {createPortal(
        <>
          <ambientLight intensity={1.25} />
          <directionalLight position={[4, 6, 6]} intensity={2.2} />
          {/* luce di riempimento magenta per il tono psichedelico */}
          <directionalLight
            position={[-6, -3, 4]}
            intensity={1.0}
            color="#ff5ec8"
          />
          <Suspense fallback={null}>
            <Instruments />
          </Suspense>
        </>,
        inst,
      )}
      <Effects bgScene={bg} instScene={inst} />
    </>
  );
}

export default function MusicScene() {
  return (
    // pointer-events-none: la scena è puramente decorativa; i click devono
    // passare alla sezione sottostante (il sistema eventi di R3F li bloccherebbe)
    <div className="pointer-events-none h-full w-full">
      <Canvas
        camera={{ position: [0, 0, 9], fov: 50 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false }}
      >
        <PipelineRoot />
      </Canvas>
    </div>
  );
}
