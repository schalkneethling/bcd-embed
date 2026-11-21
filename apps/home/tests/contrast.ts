// Contrast ratios from the Web Content Accessibility Guidelines (WCAG) 2.2, "Contrast (Minimum)"
// and "Non-text Contrast". The tests read each colour from the browser's computed style, so the
// ratios describe the colours the page really paints and not the values the stylesheet names.

/** A colour with each channel as a number from 0 to 255. */
export type Rgb = readonly [red: number, green: number, blue: number];

const CHANNEL_PATTERN =
  /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/;

/**
 * Reads the string `getComputedStyle` returns for an opaque colour, such as `rgb(18, 18, 18)`.
 * It throws for any other form, including a colour with transparency, so a test cannot measure a
 * colour that depends on whatever sits behind it.
 */
export const parseRgb = (value: string): Rgb => {
  const match = CHANNEL_PATTERN.exec(value.trim());
  if (match === null) throw new Error(`Not an rgb() colour: ${value}`);
  const [, red, green, blue, alpha] = match;
  if (alpha !== undefined && Number(alpha.replace("%", "")) !== (alpha.endsWith("%") ? 100 : 1)) {
    throw new Error(`Not an opaque colour: ${value}`);
  }
  return [Number(red), Number(green), Number(blue)];
};

/** Relative luminance, as WCAG 2.2 defines it. */
export const relativeLuminance = ([red, green, blue]: Rgb): number => {
  const linear = (channel: number): number => {
    const scaled = channel / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
};

/** The contrast ratio of two colours, from 1 (identical) to 21 (black on white). */
export const contrastRatio = (first: Rgb, second: Rgb): number => {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};
