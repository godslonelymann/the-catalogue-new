// Icon paths from catalogue-prototype.html, plus a few for the new screens.
const paths = {
  brand: '<rect x="4" y="5" width="6" height="14" rx="1"/><rect x="13" y="5" width="6" height="14" rx="1"/><path d="M6 9h2m7 0h2"/>',
  store: '<path d="M3 9l2-5h14l2 5v2a3 3 0 0 1-4.5 2.6 3 3 0 0 1-4.5-1 3 3 0 0 1-4.5 1A3 3 0 0 1 3 11zm2 5v6h14v-6M10 20v-4h4v4"/>',
  pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  logout: '<path d="M10 17l5-5-5-5m5 5H3m9-8h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.4 15.4 4.1 4.1"/>',
  down: '<path d="m4 7 6 6 4-4 6 6m-6 0h6V9"/>',
  box: '<path d="M4 7l8-4 8 4v10l-8 4-8-4zm0 0 8 4 8-4m-8 4v10M8 5l8 4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  external: '<path d="M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  warning: '<path d="M12 4 2.8 19.5h18.4Zm0 6v4.5m0 2.5v.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6Z"/><path d="m9 12 2 2 4-4"/>',
  device: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8m-4-4v4"/>',
  google: '<path d="M20.5 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.6-3.9 2.6-6.5Z"/><path d="M12 21c2.4 0 4.5-.8 5.9-2.2L15 16.6c-.8.5-1.8.9-3 .9a5.2 5.2 0 0 1-4.9-3.6h-3v2.3A9 9 0 0 0 12 21Z"/><path d="M7.1 13.9a5.4 5.4 0 0 1 0-3.5V8.1h-3a9 9 0 0 0 0 8.1Z"/><path d="M12 6.6c1.3 0 2.5.5 3.4 1.3l2.6-2.5A9 9 0 0 0 4.1 8.1l3 2.3A5.2 5.2 0 0 1 12 6.6Z"/>',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = "icon" }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: paths[name] }}
    />
  );
}
