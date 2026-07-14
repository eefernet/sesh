import { describe, expect, it } from "vitest";
import { parseKittyTheme } from "./themes";

describe("Kitty theme import", () => {
  it("maps colors and reports unsupported settings", () => { const {theme,ignored}=parseKittyTheme("foreground #fafafa\nbackground #101010\ncolor4 #55aaff\ntab_bar_style powerline","Ocean"); expect(theme.name).toBe("Ocean"); expect(theme.palette.background).toBe("#101010"); expect(theme.palette.ansi[4]).toBe("#55aaff"); expect(ignored).toContain("tab_bar_style"); });
});
