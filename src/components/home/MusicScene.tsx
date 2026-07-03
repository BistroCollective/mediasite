"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { Suspense, useMemo, useRef } from "react";

/**
 * Scena 3D della sezione MUSIC:
 * - sfondo psichedelico procedurale (shader con domain warping, evoluzione lenta)
 * - strumenti low-poly che fluttuano verso sinistra, ruotando piano, in loop infinito
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

const BG_POS = new THREE.Vector3(0, 0, BG_DEPTH);

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
        <ambientLight intensity={1.25} />
        <directionalLight position={[4, 6, 6]} intensity={2.2} />
        {/* luce di riempimento magenta per il tono psichedelico */}
        <directionalLight position={[-6, -3, 4]} intensity={1.0} color="#ff5ec8" />
        <Suspense fallback={null}>
          <PsychBackground />
          <Instruments />
        </Suspense>
      </Canvas>
    </div>
  );
}
