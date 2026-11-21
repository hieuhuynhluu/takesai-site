// The animation's arithmetic: a port of the app's math.ts (app/src/features/cutting/progress/). Same names, same
// order. site/tools/start/test-cutting.mjs runs both and fails on any difference: change the two together.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
/** 0 to 1 as t goes from a to b. */
export const seg = (t, a, b) => clamp((t - a) / (b - a));
export const frac = (x) => x - Math.floor(x);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Gravity: only for a thing that falls away. */
export const easeIn = (t) => t * t * t;
/** A unit step through a spring, t seconds in: `response` is its period in seconds and `damping` its damping fraction
 *  (SwiftUI's spring(response:dampingFraction:)). In closed form, so a frame can be drawn for any time. */
export const spring = (t, response = 0.5, damping = 0.82) => {
  if (t <= 0) return 0;
  const w = (2 * Math.PI) / response;
  if (damping >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const wd = w * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
};
