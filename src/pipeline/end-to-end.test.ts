import { describe, expect, it } from 'vitest';
import { srgbToLab } from './color';
import { buildHistogram, percentilesToCuts, suggestPercentiles } from './histogram';
import { buildZoneColours, renderFlat, renderZones } from './render';
import { thresholdL, ZONE_DARK } from './threshold';

/** A synthetic photo: sky gradient, a dark foreground mass, and a mid-value subject. */
function synthetic(width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const sky = 235 - Math.round((y / height) * 90);
      const inSubject =
        Math.hypot(x - width * 0.4, y - height * 0.55) < Math.min(width, height) * 0.22;
      const inForeground = y > height * 0.82;
      const noise = ((x * 7 + y * 13) % 17) - 8;

      let r: number;
      let g: number;
      let b: number;
      if (inForeground) {
        r = 40 + noise;
        g = 44 + noise;
        b = 32 + noise;
      } else if (inSubject) {
        r = 128 + noise;
        g = 96 + noise;
        b = 70 + noise;
      } else {
        r = sky - 30;
        g = sky - 10;
        b = sky;
      }
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = 255;
    }
  }
  return out;
}

describe('whole pipeline on a synthetic photo', () => {
  it('opens on a study with three readable zones, and reports its own timings', () => {
    const width = 1024;
    const height = 768;
    const rgba = synthetic(width, height);

    const t0 = performance.now();
    const lab = srgbToLab(rgba);
    const t1 = performance.now();
    const hist = buildHistogram(lab.L, 256);
    const t2 = performance.now();
    const suggestion = suggestPercentiles(lab.L, width, height);
    const t3 = performance.now();
    const zoneColours = buildZoneColours(lab.a, lab.b, [12, 50, 88]);
    const t4 = performance.now();

    const labels = new Uint8Array(width * height);
    const out = new Uint8ClampedArray(rgba.length);
    const cuts = percentilesToCuts(hist, suggestion);

    const cheap: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      thresholdL(lab.L, cuts, labels);
      renderZones(labels, zoneColours, out);
      cheap.push(performance.now() - start);
    }
    const greyStart = performance.now();
    renderFlat(labels, [12, 50, 88], out);
    const greyTime = performance.now() - greyStart;

    const counts = [0, 0, 0];
    for (let i = 0; i < labels.length; i++) {
      counts[labels[i]!]!++;
    }
    const share = counts.map((n) => ((n / labels.length) * 100).toFixed(1) + '%');

    console.log(
      [
        `srgbToLab           ${(t1 - t0).toFixed(1)}ms`,
        `buildHistogram      ${(t2 - t1).toFixed(1)}ms`,
        `suggestPercentiles  ${(t3 - t2).toFixed(1)}ms`,
        `buildZoneColours    ${(t4 - t3).toFixed(1)}ms`,
        `cheap pass (tinted) median ${cheap.sort((a, b) => a - b)[5]!.toFixed(1)}ms`,
        `cheap pass (grey)   ${greyTime.toFixed(1)}ms`,
        `suggestion          dark ${suggestion.dark}% light ${suggestion.light}%`,
        `cuts                L ${cuts.dark.toFixed(1)} / ${cuts.light.toFixed(1)}`,
        `zone shares         dark ${share[0]} mid ${share[1]} light ${share[2]}`,
      ].join('\n'),
    );

    // The suggestion has to be usable untouched: all three zones present, darks restrained, and
    // the mid values holding a real share of the picture (SPEC.md §6.4).
    const [dark, mid, light] = counts.map((n) => n / labels.length) as [number, number, number];
    expect(dark).toBeGreaterThan(0.02);
    expect(dark).toBeLessThan(0.3);
    expect(mid).toBeGreaterThan(0.2);
    expect(light).toBeGreaterThan(0.1);

    // The darks belong to the foreground band, which is the darkest thing in the frame. Asserted
    // as "almost every dark pixel is in the band" rather than "almost all of the band is dark":
    // the band's own noise straddles the boundary, and that is the study working as intended.
    const foregroundStart = Math.floor(height * 0.82) * width;
    const darksInForeground = labels
      .subarray(foregroundStart)
      .reduce((n, label) => (label === ZONE_DARK ? n + 1 : n), 0);
    expect(darksInForeground / counts[ZONE_DARK]!).toBeGreaterThan(0.9);

    // The tinted render keeps the photo's hue: it must not come out neutral like the flat one.
    const tinted = new Uint8ClampedArray(rgba.length);
    renderZones(labels, zoneColours, tinted);
    let chromatic = 0;
    for (let p = 0; p < tinted.length; p += 4) {
      if (tinted[p] !== tinted[p + 2]) {
        chromatic++;
      }
    }
    expect(chromatic / (tinted.length / 4)).toBeGreaterThan(0.5);
  });
});
