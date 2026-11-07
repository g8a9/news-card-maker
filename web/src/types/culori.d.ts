// The slice of culori/fn this app uses. (The published package ships no types, and adding
// @types/* packages at the repo root changes how other workspaces resolve their globals.)
declare module 'culori/fn' {
  export interface Color {
    mode: string;
    alpha?: number;
    [channel: string]: unknown;
  }
  export interface Rgb extends Color {
    mode: 'rgb';
    r: number;
    g: number;
    b: number;
  }
  export interface Oklch extends Color {
    mode: 'oklch';
    l: number;
    c: number;
    h?: number;
  }
  export const modeRgb: unknown;
  export const modeOklch: unknown;
  export const modeLrgb: unknown;
  export function useMode(definition: unknown): unknown;
  export function parse(input: string): Color | undefined;
  export function converter(mode: 'rgb'): (color: Color | string) => Rgb | undefined;
  export function converter(mode: 'oklch'): (color: Color | string) => Oklch | undefined;
  export function formatHex(color: Color | string): string;
  export function wcagContrast(a: Color | string, b: Color | string): number;
  export function clampChroma(color: Color, mode?: string): Color;
}
