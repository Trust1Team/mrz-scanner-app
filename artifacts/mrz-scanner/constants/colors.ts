/**
 * Design tokens — Limburg.net brand palette.
 *
 * Primary  : #009CA6  (teal  — nav bar, primary actions, info)
 * Accent   : #84BD00  (lime  — logo, CTAs, success states)
 * Surface  : #FFFFFF / #F0F8F9 (white + very-light-teal cards)
 * Text     : #1A2A2A (dark)  /  #5A6E6E (muted)
 */
const colors = {
  light: {
    text: "#1A2A2A",
    tint: "#009CA6",

    background: "#FFFFFF",
    foreground: "#1A2A2A",

    card: "#FFFFFF",
    cardForeground: "#1A2A2A",

    primary: "#009CA6",
    primaryForeground: "#FFFFFF",

    secondary: "#E8F6F7",
    secondaryForeground: "#1A2A2A",

    muted: "#F0F8F9",
    mutedForeground: "#5A6E6E",

    accent: "#84BD00",
    accentForeground: "#FFFFFF",

    destructive: "#D32F2F",
    destructiveForeground: "#FFFFFF",

    border: "#C5DEE0",
    input: "#F0F8F9",

    success: "#84BD00",
    warning: "#E08A00",
    info: "#009CA6",

    scanOverlay: "rgba(0, 156, 166, 0.15)",
    scanBorder: "#009CA6",
    cameraBackground: "#000000",
  },

  radius: 12,
};

export default colors;
