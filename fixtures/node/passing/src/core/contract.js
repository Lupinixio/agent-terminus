// The only part of the core the dashboard may use.
let paused = false;

export function readStatus() {
  return { paused };
}

export function requestPause() {
  paused = true;
}
