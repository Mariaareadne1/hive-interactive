// Small line icons, drawn for this UI at 20px on a 20-unit grid.

interface IconProps {
  name: IconName;
}

export type IconName =
  | 'draw' | 'move' | 'undo' | 'redo' | 'camera' | 'help' | 'menu'
  | 'rotateL' | 'rotateR' | 'duplicate' | 'trash' | 'close'
  | 'water' | 'wind' | 'rain' | 'sun' | 'seed' | 'palette' | 'bee' | 'bloom';

const paths: Record<IconName, string> = {
  draw: 'M4 15.5c2.5-.2 3.6-2.8 5.6-6.2C11.2 6.6 13 4.6 15.6 4.5M13.4 4.4l2.4.1-.2 2.3',
  move: 'M10 3v14M3 10h14M10 3l-2 2M10 3l2 2M10 17l-2-2M10 17l2-2M3 10l2-2M3 10l2 2M17 10l-2-2M17 10l-2 2',
  undo: 'M7.5 6.5 4 10l3.5 3.5M4.5 10H12a4 4 0 0 1 0 8h-1',
  redo: 'M12.5 6.5 16 10l-3.5 3.5M15.5 10H8a4 4 0 0 0 0 8h1',
  camera: 'M3.5 7.5h3l1.3-2h4.4l1.3 2h3v8h-13zM10 13.6a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6',
  help: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15M7.9 7.8a2.2 2.2 0 1 1 3 2c-.6.3-.9.8-.9 1.4v.5M10 14.2v.1',
  menu: 'M4.5 10h.1M10 10h.1M15.5 10h.1',
  rotateL: 'M5 8.5A6 6 0 1 1 4.6 12M5 4.5v4h4',
  rotateR: 'M15 8.5a6 6 0 1 0 .4 3.5M15 4.5v4h-4',
  duplicate: 'M7 7h9v9H7zM4 13V4h9',
  trash: 'M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6',
  close: 'M5 5l10 10M15 5 5 15',
  water: 'M10 3.5c2.6 3.4 4.2 5.8 4.2 8a4.2 4.2 0 0 1-8.4 0c0-2.2 1.6-4.6 4.2-8zM8 12.5a2 2 0 0 0 2 2',
  wind: 'M3 8h9.5a2.3 2.3 0 1 0-2.3-2.3M3 12h12a2.5 2.5 0 1 1-2.5 2.5M3 10h6',
  rain: 'M5.5 11.5a3.5 3.5 0 0 1 .6-7 4.5 4.5 0 0 1 8.6 1.5 2.8 2.8 0 0 1-.2 5.5zM7 14l-1 2.5M10.5 14l-1 2.5M14 14l-1 2.5',
  sun: 'M10 13.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4M10 2.8v1.6M10 15.6v1.6M2.8 10h1.6M15.6 10h1.6M4.9 4.9l1.1 1.1M14 14l1.1 1.1M4.9 15.1 6 14M14 6l1.1-1.1',
  seed: 'M10 16.5v-6M10 10.5c0-3 2-5 5-5 0 3-2 5-5 5zM10 12.5c0-2.4-1.6-4-4-4 0 2.4 1.6 4 4 4z',
  palette: 'M10 3.5a6.5 6.5 0 1 0 0 13c1 0 1.5-.6 1.5-1.3 0-1-.9-1.2-.9-2s.6-1.2 1.4-1.2h1.6a2.9 2.9 0 0 0 2.9-2.9C16.5 6 13.6 3.5 10 3.5M6.5 9.5h.1M8.6 6.6h.1M12 6.6h.1',
  bee: 'M10 6.5a3.4 4.4 0 1 0 0 8.8 3.4 4.4 0 0 0 0-8.8M6.8 10h6.4M7.1 12.6h5.8M10 6.5c-.5-1.5-1.5-2.5-2.8-2.8M10 6.5c.5-1.5 1.5-2.5 2.8-2.8M7 8.5C4.5 7 3 7.5 3.4 9.4s2.2 1.8 3.6 1M13 8.5c2.5-1.5 4-1 3.6.9s-2.2 1.8-3.6 1',
  bloom: 'M10 10.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2M10 7.3C9 5.5 9.2 3.8 10 3c.8.8 1 2.5 0 4.3M11.6 8.9c1.9-.7 3.5-.3 4.1.6-.9.7-2.6.9-4.1 0M8.4 8.9c-1.9-.7-3.5-.3-4.1.6.9.7 2.6.9 4.1 0M10 10.5v6',
};

export function Icon({ name }: IconProps) {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d={paths[name]} fill="none" stroke="currentColor" strokeWidth={name === 'menu' ? 2.6 : 1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
