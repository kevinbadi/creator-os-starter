export const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "X",
  x: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  threads: "Threads",
};

export function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
}
