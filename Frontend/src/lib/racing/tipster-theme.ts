import type { CSSProperties } from "react";
import type { TipsterProfile } from "@/lib/racing/types";

export type TipsterTheme = {
  primary: string;
  secondary: string;
  surface: string;
};

export const defaultTipsterTheme: TipsterTheme = {
  primary: "#FFB000",
  secondary: "#00D4E8",
  surface: "#351657",
};

const hexColorPattern = /^#[0-9A-F]{6}$/;

function normalizedHex(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return hexColorPattern.test(normalized) ? normalized : fallback;
}

export function resolveTipsterTheme(
  tipster: Partial<TipsterProfile> | null | undefined,
): TipsterTheme {
  return {
    primary: normalizedHex(
      tipster?.theme_primary_color,
      defaultTipsterTheme.primary,
    ),
    secondary: normalizedHex(
      tipster?.theme_secondary_color,
      defaultTipsterTheme.secondary,
    ),
    surface: normalizedHex(
      tipster?.theme_surface_color,
      defaultTipsterTheme.surface,
    ),
  };
}

function readableTextColor(background: string) {
  const red = Number.parseInt(background.slice(1, 3), 16);
  const green = Number.parseInt(background.slice(3, 5), 16);
  const blue = Number.parseInt(background.slice(5, 7), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance >= 150 ? "#07111B" : "#FFFFFF";
}

export function tipsterThemePanelStyle(
  tipster: Partial<TipsterProfile> | null | undefined,
): CSSProperties {
  const theme = resolveTipsterTheme(tipster);

  return {
    borderColor: `${theme.primary}99`,
    background: `linear-gradient(135deg, ${theme.surface} 0%, ${theme.surface} 68%, ${theme.primary}26 100%)`,
    boxShadow: `inset 0 1px 0 ${theme.secondary}2E`,
  };
}

export function tipsterThemeCardStyle(
  tipster: Partial<TipsterProfile> | null | undefined,
): CSSProperties {
  const theme = resolveTipsterTheme(tipster);

  return {
    borderColor: `${theme.secondary}66`,
    backgroundColor: `${theme.surface}E6`,
  };
}

export function tipsterThemeButtonStyle(
  tipster: Partial<TipsterProfile> | null | undefined,
): CSSProperties {
  const theme = resolveTipsterTheme(tipster);

  return {
    borderColor: theme.primary,
    backgroundColor: theme.primary,
    color: readableTextColor(theme.primary),
  };
}

export function tipsterThemeAccentStyle(
  tipster: Partial<TipsterProfile> | null | undefined,
): CSSProperties {
  return { color: resolveTipsterTheme(tipster).secondary };
}
