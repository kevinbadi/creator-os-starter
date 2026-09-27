// Theme-aware heatmap palettes (light + dark). Index 0 = empty, 1..4 =
// ascending intensity. Kept in a plain module so both the server card and the
// client grid can import them.
//
//   green  — GitHub contribution ramp (legacy)
//   teal   — views/analytics ramp (legacy)
//   cyan   — matches the New Customers chart's cyan series
//            (#67e8f9 → #22d3ee → #0891b2)
//   silver — matches the chart's silver series (#e5e7eb → #b8bcc4 → #9ca3af)
// The Overview calendar + views heatmaps use silver/cyan per Kevin
// (2026-07-11: "match the cyan and silver color scheme of the new
// customers chart").

export const PALETTES: Record<"green" | "teal" | "cyan" | "silver", string[]> = {
  green: [
    "bg-[#ebedf0] dark:bg-[#2a2a2e]", // 0 empty
    "bg-[#9be9a8] dark:bg-[#0e4429]",
    "bg-[#40c463] dark:bg-[#006d32]",
    "bg-[#30a14e] dark:bg-[#26a641]",
    "bg-[#216e39] dark:bg-[#39d353]",
  ],
  teal: [
    "bg-[#ebedf0] dark:bg-[#2a2a2e]", // 0 empty
    "bg-[#b7ede8] dark:bg-[#0c3d3a]",
    "bg-[#5fd3c7] dark:bg-[#0f5c56]",
    "bg-[#1fae9f] dark:bg-[#149b8e]",
    "bg-[#0f766e] dark:bg-[#2dd4bf]",
  ],
  cyan: [
    "bg-[#ebedf0] dark:bg-[#2a2a2e]", // 0 empty
    "bg-[#a5f3fc] dark:bg-[#083344]",
    "bg-[#67e8f9] dark:bg-[#155e75]",
    "bg-[#22d3ee] dark:bg-[#0891b2]",
    "bg-[#0891b2] dark:bg-[#22d3ee]",
  ],
  silver: [
    "bg-[#ebedf0] dark:bg-[#2a2a2e]", // 0 empty
    "bg-[#d8dce3] dark:bg-[#4b4e55]",
    "bg-[#b8bcc4] dark:bg-[#71757e]",
    "bg-[#8e939c] dark:bg-[#9ca3af]",
    "bg-[#5f646d] dark:bg-[#d8dce3]",
  ],
};

export type HeatmapPalette = keyof typeof PALETTES;

/** Back-compat: the original single palette. */
export const LEVEL_CLASSES = PALETTES.green;
