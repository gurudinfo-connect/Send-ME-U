export const expiryFor: (key: any, now?: number) => string | null | undefined;
export function sessionActive(s: any, now?: number, lastUpdate?: any): boolean;
export function visibleLocation(o: { session: any; location: any; now?: number }): any;
export function validCoords(lat: number, lng: number, accuracy?: number | null): boolean;
