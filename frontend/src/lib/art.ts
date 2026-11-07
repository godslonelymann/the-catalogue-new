// Product illustrations from catalogue-prototype.html, returned as data URLs so that
// sample products have an `imageUrl` like real Shopify products.

export type Shape = "tee" | "cargo" | "hoodie" | "cap" | "shirt" | "shorts";

export interface Palette {
  fill: string;
  light: string;
  ink: string;
  backdrop: string;
}

const shapes: Record<Shape, (ink: string) => string> = {
  tee: ink =>
    `<path d="M91 46l35-15c7 12 19 18 34 18s27-6 34-18l35 15 37 44-36 27-19-23 1 107H108l1-107-19 23-36-27Z"/><path d="M125 32c7 23 27 30 35 30s28-7 35-30M61 88l31 24m167-24-31 24M111 190h99" fill="none" stroke="#fff" opacity=".18"/><path d="m115 92 10 76m80-76-10 76" fill="none" opacity=".52"/><g stroke="none" fill="${ink}" text-anchor="middle"><text x="160" y="103" font-family="Georgia,serif" font-style="italic" font-size="22" font-weight="bold">RACER</text><text x="160" y="116" font-family="system-ui,sans-serif" font-size="6" letter-spacing="2">CLUB  /  1999</text></g><path d="m140 124 11 4 9-4 9 4 11-4m-33 8h26" fill="none" stroke="${ink}" opacity=".7"/>`,
  cargo: ink =>
    `<path d="M116 27h88l13 45 10 138-56 2-11-109-11 109-56-2 10-138Z"/><path d="M114 39h92m-46 0v64m-47-59-7 26m101-26 7 26m-113 129h49m20 0h51" fill="none" stroke="#fff" opacity=".23"/><path d="M102 91h40v43h-43Zm76 0h40l3 43h-43Z"/><path d="M101 102h41m36 0h41m-99-74-1 12m81-12 1 12" fill="none" stroke="#fff" opacity=".28"/><circle cx="160" cy="34" r="2" fill="${ink}" stroke="none"/>`,
  hoodie: ink =>
    `<path d="M120 56c-2-22 15-37 40-38s42 16 40 38l30 16 35 106-34 13-24-57 1 69h-96l1-69-24 57-34-13L90 72Z"/><path d="M120 57c15 13 25 16 40 16s25-3 40-16M124 49c8-14 18-22 36-22s28 8 36 22M160 73v129M114 193h92m-150-22 31 13m177-13-31 13" fill="none" stroke="#fff" opacity=".27"/><path d="M154 149h-26l-10 32h36Zm12 0h26l10 32h-36Z" fill="none"/><path d="M149 69l-4 30m26-30 4 30m-11-18h-8" fill="none" stroke="${ink}" opacity=".8"/>`,
  cap: ink =>
    `<path d="M77 150c9-49 38-77 86-78 42 0 73 32 75 68l-17 22-98 14Z"/><path d="M81 150c31-3 63 5 88 21 12 8 13 14 2 19-25 12-85 3-116-12-13-6-15-14-7-19 9-5 22-8 33-9Z"/><path d="M163 73c-17 16-26 41-28 84m32-85c24 12 40 33 47 65m-157 27c22-7 75 4 105 20m7-13c21-3 49-11 67-27" stroke="#fff" opacity=".25" fill="none"/><ellipse cx="163" cy="72" rx="7" ry="3"/><text x="165" y="133" fill="${ink}" stroke="none" font-family="Georgia,serif" font-style="italic" font-size="15" text-anchor="middle">Weekend</text>`,
  shirt: ink =>
    `<path d="M121 40l19-10h40l19 10 29 11 31 50-36 21-15-24v101h-96V98l-15 24-36-21 31-50Z"/><path d="m140 30 20 22 20-22 19 10-24 34-15-22-15 22-24-34Z"/><path d="M160 53v146m-46-12h92m-138-87 29 17m155-17-29 17m-45-18h21v25h-21Z" fill="none" stroke="${ink}" opacity=".7"/><path d="M132 68v117m-11-96v96m20-94v94m43-111v18m13-23v23m-13 35v58m13-58v58" stroke="#fff" opacity=".22"/><path d="M165 78v1m0 19v1m0 19v1m0 19v1m0 19v1m0 19v1" stroke="#fff" stroke-width="2.6" opacity=".65"/>`,
  shorts: ink =>
    `<path d="M108 55h104l23 120-64 11-11-54-11 54-64-11Z"/><path d="M108 69h104M109 76l-17 94 55 8m64-102 17 94-55 8m-13-102v56" fill="none" stroke="${ink}" opacity=".7"/><path d="M160 74c-18 0-21 13-7 10l7-10c18 0 21 13 7 10l-7-10-6 21m6-21 5 21" fill="none" stroke="${ink}" stroke-width="2"/><path d="m111 88 18-5m80 5-18-5" stroke="#fff" opacity=".3"/>`,
};

export function artUrl(shape: Shape, palette: Palette): string {
  const { fill, light, ink, backdrop } = palette;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 260">` +
    `<defs><linearGradient id="c" x2=".9" y2="1"><stop stop-color="${light}"/><stop offset="1" stop-color="${fill}"/></linearGradient>` +
    `<radialGradient id="g"><stop stop-color="#fff" stop-opacity=".44"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="320" height="260" fill="${backdrop}"/><rect width="320" height="260" fill="url(#g)"/>` +
    `<ellipse cx="160" cy="225" rx="83" ry="8" fill="${fill}" opacity=".12"/>` +
    `<g transform="translate(8 10) scale(.95)" fill="url(#c)" stroke="${fill}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">` +
    shapes[shape](ink) +
    `</g></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
