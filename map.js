// map.js — map data loading and bearing utilities
// JSON is imported directly by Vite — edit data/map.json and the page hot-reloads.

import _mapData from './data/map.json';

export function loadMap() {
  return _mapData;
}

export function getLocation(locationId) {
  const loc = _mapData.locations[locationId];
  return loc ? { id: locationId, ...loc } : null;
}

export function getDestination(destId) {
  return _mapData.destinations.find(d => d.id === destId) || null;
}

export function getAllLocations() {
  return Object.entries(_mapData.locations).map(([id, loc]) => ({ id, ...loc }));
}

// Returns an array of route objects for the given scan location
export function getRoutes(locationId) {
  const location = getLocation(locationId);
  if (!location || !location.routes) return [];

  return Object.entries(location.routes).map(([destId, route]) => {
    const dest = getDestination(destId);
    return {
      id:       destId,
      name:     dest?.name     ?? destId,
      floor:    dest?.floor    ?? '?',
      hint:     dest?.hint     ?? '',
      color:    dest?.color    ?? '#ffffff',
      bearing:  route.bearing,
      distance: route.distance,
      steps:    route.steps,
    };
  });
}

// Normalize a bearing difference to the range [-180, 180]
// so arrows always take the shortest rotation path.
export function normalizeAngle(degrees) {
  return ((degrees % 360) + 540) % 360 - 180;
}

// Degrees to radians
export function toRad(deg) {
  return (deg * Math.PI) / 180;
}
