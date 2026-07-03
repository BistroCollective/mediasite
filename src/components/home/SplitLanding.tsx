"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  homeVisuals,
  musicMenu,
  mediaMenu,
  collectiveBlurb,
  type VisualContent,
  type MenuItem,
} from "@/config/site-content";

// la scena 3D usa WebGL/three.js: caricata solo client-side, fuori dal bundle iniziale
const MusicScene = dynamic(() => import("./MusicScene"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#100322]" />,
});

type Side = "music" | "media";

// posizione del divisore (frazione della larghezza dello schermo)
const IDLE = 0.5;
const HOVER_NUDGE = 0.015; // piccolo movimento del divisore in hover
const MUSIC_OPEN = 0.85; // music espansa: divisore all'85% (resta un 15% di media)
const MEDIA_OPEN = 0.15; // media espansa: divisore al 15%

export default function SplitLanding() {
  const [hovered, setHovered] = useState<Side | null>(null);
  const [expanded, setExpanded] = useState<Side | null>(null);

  const mediaLayerRef = useRef<HTMLDivElement>(null);
  const dividerSvgRef = useRef<SVGSVGElement>(null);
  const dividerPathRef = useRef<SVGPathElement>(null);
  const logoWrapRef = useRef<HTMLDivElement>(null);
  const logoCdRef = useRef<HTMLDivElement>(null);
  const logoTextRef = useRef<HTMLDivElement>(null);

  // stato letto dal loop di animazione senza ri-render
  const stateRef = useRef({ hovered, expanded });
  useEffect(() => {
    stateRef.current = { hovered, expanded };
  }, [hovered, expanded]);

  // su dispositivi touch il parallax col mouse non ha senso: lo disattiviamo
  const isTouchRef = useRef(false);
  useEffect(() => {
    isTouchRef.current = window.matchMedia(
      "(hover: none), (pointer: coarse)",
    ).matches;
  }, []);

  const anim = useRef({
    pos: IDLE, // posizione attuale del divisore
    logoX: IDLE, // il logo segue il divisore con un po' di ritardo
    amp: 1, // ampiezza dell'onda (cresce leggermente in hover)
    px: 0, // parallax corrente (lerp verso il mouse)
    py: 0,
    mouseNX: 0, // posizione mouse normalizzata [-1, 1]
    mouseNY: 0,
    t: 0,
  });

  useEffect(() => {
    const svg = dividerSvgRef.current;
    const resize = () => {
      svg?.setAttribute("width", String(window.innerWidth));
      svg?.setAttribute("height", String(window.innerHeight));
      svg?.setAttribute(
        "viewBox",
        `0 0 ${window.innerWidth} ${window.innerHeight}`,
      );
    };
    resize();
    window.addEventListener("resize", resize);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(null);
    };
    window.addEventListener("keydown", onKey);

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - last, 50);
      last = now;
      const a = anim.current;
      const s = stateRef.current;
      const W = window.innerWidth;
      const H = window.innerHeight;

      // target del divisore: 50% a riposo, nudge in hover, 85/15 da espanso
      let target = IDLE;
      if (s.expanded === "music") target = MUSIC_OPEN;
      else if (s.expanded === "media") target = MEDIA_OPEN;
      else if (s.hovered === "music") target = IDLE + HOVER_NUDGE;
      else if (s.hovered === "media") target = IDLE - HOVER_NUDGE;

      const ease = (tau: number) => 1 - Math.exp(-dt / tau);
      a.pos += (target - a.pos) * ease(260);
      a.amp += ((s.hovered && !s.expanded ? 1.45 : 1) - a.amp) * ease(320);
      a.logoX += (a.pos - a.logoX) * ease(70); // quasi incollato al divisore
      a.px += (a.mouseNX - a.px) * ease(160);
      a.py += (a.mouseNY - a.py) * ease(160);
      a.t += dt;

      // onda lentissima, stile lava lamp: tre sinusoidi sovrapposte
      const baseX = a.pos * W;
      const t = a.t;
      const N = 28;
      let d = "";
      for (let i = 0; i <= N; i++) {
        const y = (H / N) * i;
        const x =
          baseX +
          (Math.sin(y * 0.0012 - t * 0.00021) * 38 +
            Math.sin(y * 0.0043 + t * 0.00034) * 24 +
            Math.sin(y * 0.0089 + t * 0.00052) * 8) *
            a.amp;
        d += i === 0 ? `M ${x.toFixed(1)} 0` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      dividerPathRef.current?.setAttribute("d", d);

      // la sezione MEDIA (sopra) viene ritagliata lungo l'onda
      if (mediaLayerRef.current) {
        const clip = `path("${d} L ${W + 80} ${H} L ${W + 80} 0 Z")`;
        mediaLayerRef.current.style.clipPath = clip;
        mediaLayerRef.current.style.setProperty("-webkit-clip-path", clip);
      }

      // logo appoggiato sul divisore + parallax (il CD si muove meno della scritta)
      if (logoWrapRef.current)
        logoWrapRef.current.style.left = `${(a.logoX * 100).toFixed(3)}%`;
      if (logoCdRef.current)
        logoCdRef.current.style.transform = `translate(${(a.px * 7).toFixed(2)}px, ${(a.py * 7).toFixed(2)}px)`;
      if (logoTextRef.current)
        logoTextRef.current.style.transform = `translate(${(a.px * 20).toFixed(2)}px, ${(a.py * 20).toFixed(2)}px)`;

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const sideAt = (clientX: number): Side =>
    clientX < anim.current.pos * window.innerWidth ? "music" : "media";

  const onMouseMove = (e: React.MouseEvent) => {
    // touch: niente parallax né hover (i "mousemove" sintetici dei tap
    // lascerebbero il logo storto e l'hover appiccicato)
    if (isTouchRef.current) return;
    const a = anim.current;
    a.mouseNX = (e.clientX / window.innerWidth) * 2 - 1;
    a.mouseNY = (e.clientY / window.innerHeight) * 2 - 1;
    const side = sideAt(e.clientX);
    const next = stateRef.current.expanded ? null : side;
    if (next !== hovered) setHovered(next);
  };

  const onClick = (e: React.MouseEvent) => {
    const side = sideAt(e.clientX);
    if (expanded === side) return;
    setExpanded(side);
    setHovered(null);
  };

  return (
    <div
      className="moody relative h-[100svh] w-full cursor-pointer select-none overflow-hidden bg-black"
      onMouseMove={onMouseMove}
      onMouseLeave={() => {
        setHovered(null);
        // il mouse è uscito: il logo torna dolcemente centrato (parallax a zero)
        anim.current.mouseNX = 0;
        anim.current.mouseNY = 0;
      }}
      onClick={onClick}
    >
      {/* ── sezione MUSIC (sinistra, psichedelica) ── */}
      <section className="absolute inset-0" aria-label="Sezione Music">
        <div
          className={`h-full w-full transition-[filter] duration-500 ${
            hovered === "music"
              ? "brightness-[1.18] saturate-[1.2]"
              : "brightness-100"
          }`}
        >
          {homeVisuals.music.type === "scene" ? (
            <MusicScene />
          ) : (
            <Visual content={homeVisuals.music} />
          )}
        </div>
        {/* gradiente d'ombra dal basso, per ancorare la sezione */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-[linear-gradient(to_top,rgba(4,2,10,0.55),transparent)]" />
        <span className="absolute bottom-7 left-7 font-mono text-xs font-semibold uppercase tracking-[0.6em] text-white/65 mix-blend-screen">
          Music
        </span>
      </section>

      {/* ── sezione MEDIA (destra, dark) — sta sopra, ritagliata dall'onda ── */}
      <section
        ref={mediaLayerRef}
        className="absolute inset-0"
        style={{ clipPath: "inset(0 0 0 50%)" }}
        aria-label="Sezione Media"
      >
        <Visual
          content={homeVisuals.media}
          className={`saturate-[0.7] contrast-[1.08] transition-[filter] duration-500 ${
            hovered === "media" ? "brightness-[1.35]" : "brightness-100"
          }`}
        />
        {/* più scuro verso il bordo destro: mood cinematografico */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.3),rgba(0,0,0,0.62))]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-[linear-gradient(to_top,rgba(0,0,0,0.5),transparent)]" />
        <span className="absolute bottom-7 right-7 font-mono text-xs font-semibold uppercase tracking-[0.6em] text-white/60">
          Media
        </span>
      </section>

      {/* ── divisore a onda ── */}
      <svg
        ref={dividerSvgRef}
        className="pointer-events-none absolute inset-0 mix-blend-difference"
        aria-hidden
      >
        <path
          ref={dividerPathRef}
          fill="none"
          stroke="white"
          strokeOpacity={0.75}
          strokeWidth={1.5}
          style={{ filter: "drop-shadow(0 0 7px rgba(255,255,255,0.55))" }}
        />
      </svg>

      {/* ── logo BISTRO: CD + scritta, parallax su due livelli.
           z-16: sopra grana/vignetta (z-15) → si stacca dal fondo filmico,
           ma sempre sotto i menu laterali (z-20) ── */}
      <div
        ref={logoWrapRef}
        className="pointer-events-none absolute top-1/2 z-[16]"
        style={{ left: "50%" }}
      >
        <div className="relative w-[clamp(220px,34vw,430px)] -translate-x-1/2 -translate-y-1/2">
          <div ref={logoCdRef}>
            <Image
              src="/assets/logo-cd.png"
              alt=""
              width={1488}
              height={1488}
              preload
              className="h-auto w-full drop-shadow-[0_18px_45px_rgba(0,0,0,0.55)]"
            />
          </div>
          <div ref={logoTextRef} className="absolute inset-0">
            <Image
              src="/assets/logo-bistro.png"
              alt="Bistro"
              width={1488}
              height={1488}
              preload
              className="h-auto w-full drop-shadow-[0_10px_22px_rgba(0,0,0,0.45)]"
            />
          </div>
        </div>
      </div>

      {/* ── menu laterale MUSIC (da sinistra) ── */}
      <SideMenu
        side="music"
        open={expanded === "music"}
        items={musicMenu}
        onClose={() => setExpanded(null)}
      />

      {/* ── menu laterale MEDIA (da destra) ── */}
      <SideMenu
        side="media"
        open={expanded === "media"}
        items={mediaMenu}
        onClose={() => setExpanded(null)}
      />
    </div>
  );
}

/** Sfondo dinamico: immagine oggi, video domani — si cambia in site-content.ts */
function Visual({
  content,
  className = "",
}: {
  content: VisualContent;
  className?: string;
}) {
  if (content.type === "video") {
    return (
      <video
        src={content.src}
        poster={content.poster}
        autoPlay
        muted
        loop
        playsInline
        className={`h-full w-full object-cover ${className}`}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- sfondo full-bleed configurabile (anche video), niente ottimizzazione statica
    <img
      src={content.src}
      alt={content.alt ?? ""}
      className={`h-full w-full object-cover ${className}`}
    />
  );
}

function SideMenu({
  side,
  open,
  items,
  onClose,
}: {
  side: Side;
  open: boolean;
  items: MenuItem[];
  onClose: () => void;
}) {
  const isMusic = side === "music";
  return (
    <aside
      onClick={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      aria-hidden={!open}
      className={`absolute inset-y-0 z-20 flex w-[min(400px,86vw)] cursor-auto flex-col justify-between px-10 py-12 transition-transform duration-700 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
        isMusic
          ? `left-0 bg-[#ece4d0]/95 text-neutral-900 backdrop-blur-md ${open ? "translate-x-0" : "-translate-x-[103%]"}`
          : `right-0 bg-[#0a0a0c]/90 text-neutral-100 backdrop-blur-md ${open ? "translate-x-0" : "translate-x-[103%]"}`
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`font-mono text-xs uppercase tracking-[0.5em] ${isMusic ? "text-neutral-500" : "text-neutral-400"}`}
        >
          Bistro — {side}
        </span>
        <button
          type="button"
          aria-label="Chiudi menu"
          onClick={onClose}
          className={`flex h-9 w-9 items-center justify-center rounded-full border text-lg transition-colors ${
            isMusic
              ? "border-neutral-300 hover:bg-neutral-900 hover:text-white"
              : "border-neutral-700 hover:bg-white hover:text-black"
          }`}
        >
          ×
        </button>
      </div>

      <nav aria-label={`Menu ${side}`}>
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li
              key={item.label}
              className={`transition-all duration-500 ${
                open ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
              }`}
              style={{ transitionDelay: open ? `${180 + i * 70}ms` : "0ms" }}
            >
              <a
                href={item.href}
                className={`group flex items-baseline gap-4 py-1 text-4xl font-bold tracking-tight transition-transform duration-300 hover:translate-x-2 ${
                  isMusic
                    ? "hover:bg-[linear-gradient(90deg,#e6402e,#f5a623,#2ea86b,#3a6ff0,#b3479e)] hover:bg-clip-text hover:text-transparent"
                    : "text-neutral-300 hover:text-white"
                }`}
              >
                <span
                  className={`font-mono text-xs font-normal ${isMusic ? "text-neutral-400" : "text-neutral-500"}`}
                >
                  0{i + 1}
                </span>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <p
        className={`max-w-[28ch] text-xs leading-relaxed ${isMusic ? "text-neutral-500" : "text-neutral-400"}`}
      >
        {collectiveBlurb}
      </p>
    </aside>
  );
}
