export function rgbToHsv(red, green, blue) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;
  
    if (delta !== 0) {
      if (max === r) hue = 60 * (((g - b) / delta) % 6);
      if (max === g) hue = 60 * ((b - r) / delta + 2);
      if (max === b) hue = 60 * ((r - g) / delta + 4);
    }
    if (hue < 0) hue += 360;
  
    return {
      h: hue,
      s: max === 0 ? 0 : (delta / max) * 100,
      v: max * 100,
    };
  }
  
export function classifyColor({ h, s, v }) {
    if (v < 18) return 'Black';
    if (s < 12 && v > 84) return 'White';
    if (s < 18) return 'Grey';
    if ((h >= 0 && h < 14) || h >= 345) return 'Red';
    if (h >= 14 && h < 42 && v < 62) return 'Brown';
    if (h >= 14 && h < 42) return 'Orange';
    if (h >= 42 && h < 72) return 'Yellow';
    if (h >= 72 && h < 170) return 'Green';
    if (h >= 170 && h < 255) return 'Blue';
    if (h >= 255 && h < 292) return 'Purple';
    if (h >= 292 && h < 345) return 'Pink';
    return 'Grey';
}
