// Contenuti dinamici del sito — cambiare qui immagini/video e voci di menu,
// senza toccare i componenti.

export type VisualContent = {
  /** "scene" = scena 3D procedurale (shader + strumenti fluttuanti) */
  type: "image" | "video" | "scene";
  src?: string;
  alt?: string;
  /** poster per i video (opzionale) */
  poster?: string;
};

/**
 * Sfondi delle due sezioni della homepage.
 * Per passare a un video: { type: "video", src: "/assets/mio-video.mp4" }
 * Per tornare a un'immagine sul lato music: { type: "image", src: "/assets/music-bg.jpg" }
 */
export const homeVisuals: Record<"music" | "media", VisualContent> = {
  music: {
    type: "scene",
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
