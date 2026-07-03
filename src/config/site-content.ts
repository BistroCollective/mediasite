// Contenuti dinamici del sito — cambiare qui immagini/video e voci di menu,
// senza toccare i componenti.

export type VisualContent = {
  type: "image" | "video";
  src: string;
  alt?: string;
  /** poster per i video (opzionale) */
  poster?: string;
};

/**
 * Sfondi delle due sezioni della homepage.
 * Per passare a un video: { type: "video", src: "/assets/mio-video.mp4" }
 */
export const homeVisuals: Record<"music" | "media", VisualContent> = {
  music: {
    type: "image",
    src: "/assets/music-bg.jpg",
    alt: "Synth e tastiere in studio",
  },
  media: {
    type: "image",
    src: "/assets/media-bg.jpg",
    alt: "Riprese video sul set",
  },
};

export type MenuItem = { label: string; href: string };

// Le pagine non esistono ancora: i link sono placeholder ("#").
// Quando creeremo le pagine basterà aggiornare gli href qui.
export const musicMenu: MenuItem[] = [
  { label: "Servizi", href: "#" },
  { label: "Progetti", href: "#" },
  { label: "Artisti", href: "#" },
  { label: "Eventi", href: "#" },
  { label: "Contatti", href: "#" },
];

export const mediaMenu: MenuItem[] = [
  { label: "Servizi", href: "#" },
  { label: "Galleria", href: "#" },
  { label: "Contatti", href: "#" },
];

export const collectiveBlurb =
  "Collettivo Bistro è una cooperativa autogestita che unisce creatività, produzione e cultura, attiva tra Romagna e Lombardia.";

export const collectiveTagline =
  "Produzione · Mix · Recordings — Music Videos & Photo Sessions — Live Events & Culture";
