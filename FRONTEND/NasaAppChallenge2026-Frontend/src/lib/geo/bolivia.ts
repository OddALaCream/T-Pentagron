import boundary from '../../../public/geo/bolivia.json';

export const boliviaBoundary = boundary;
export const boliviaRings = boundary.geometry.coordinates;

function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i];
    const [px, py] = ring[j];
    if ((y > lat) !== (py > lat) && lng < (px - x) * (lat - y) / (py - y) + x) inside = !inside;
  }
  return inside;
}

export function insideBolivia(lat: number, lng: number): boolean {
  return inRing(lng, lat, boliviaRings[0]) && !boliviaRings.slice(1).some(r => inRing(lng, lat, r));
}
