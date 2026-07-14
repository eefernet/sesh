import type { ThemeDefinition } from "./domain";

const theme = (id: string, name: string, background: string, foreground: string, ansi: string[]): ThemeDefinition => ({
  schemaVersion: 1, id, name, builtIn: true,
  palette: { background, foreground, cursor: foreground, cursorAccent: background, selectionBackground: "#3b82f680", selectionForeground: foreground, ansi },
  fontFamily: "JetBrains Mono, Fira Code, monospace", fontSize: 14, fontWeight: 400, lineHeight: 1.25, letterSpacing: 0,
  cursorStyle: "block", cursorBlink: true, padding: 14, scrollback: 10000, backgroundOpacity: 1, backgroundImageOpacity: 0.15,
});

export const BUILTIN_THEMES = [
  theme("sesh-midnight", "Sesh Midnight", "#0b0f14", "#dce4ee", ["#151b23","#ff6b6b","#7bd88f","#f7c76b","#6ca9ff","#c792ea","#63d8e3","#dce4ee","#68717d","#ff8b8b","#9beaab","#ffda91","#8ebcff","#d9a7f3","#8ce7ee","#ffffff"]),
  theme("sesh-ember", "Ember", "#17110f", "#f1dfd2", ["#261c18","#ef6f5e","#8fbf75","#e6b566","#7aa9d8","#bf85cc","#69b9ad","#e7d5c8","#705d54","#ff8d7b","#aad48f","#f3cb80","#98c2ea","#d9a1e1","#86d3c6","#fff4eb"]),
  theme("sesh-paper", "Paper", "#f5f2ea", "#252a2f", ["#252a2f","#c8463d","#477a4b","#9a6b16","#356aa0","#80528e","#287c80","#d7d2c7","#656b70","#dc5d53","#5d965f","#b98527","#4e84b9","#986aa5","#3e9598","#ffffff"]),
];

export const defaultTheme = BUILTIN_THEMES[0];

export function parseKittyTheme(text: string, name = "Imported Kitty theme"): { theme: ThemeDefinition; ignored: string[] } {
  const next = structuredClone(defaultTheme); next.id = crypto.randomUUID(); next.name = name; next.builtIn = false;
  const ignored: string[] = [];
  const colorKeys: Record<string, keyof ThemeDefinition["palette"]> = { foreground: "foreground", background: "background", cursor: "cursor", cursor_text_color: "cursorAccent", selection_background: "selectionBackground", selection_foreground: "selectionForeground" };
  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim(); if (!line || line.startsWith("#")) return;
    const [key, ...parts] = line.split(/\s+/); const value = parts.join(" ");
    if (key in colorKeys && /^#[0-9a-f]{6,8}$/i.test(value)) (next.palette[colorKeys[key]] as string) = value;
    else if (/^color([0-9]|1[0-5])$/.test(key) && /^#[0-9a-f]{6,8}$/i.test(value)) next.palette.ansi[Number(key.slice(5))] = value;
    else if (key === "font_family") next.fontFamily = value;
    else if (key === "font_size" && Number(value) > 0) next.fontSize = Number(value);
    else if (key === "cursor_shape" && ["block", "beam", "underline"].includes(value.toLowerCase())) next.cursorStyle = value.toLowerCase() === "beam" ? "bar" : value.toLowerCase() as ThemeDefinition["cursorStyle"];
    else ignored.push(key);
  });
  return { theme: next, ignored: [...new Set(ignored)] };
}
