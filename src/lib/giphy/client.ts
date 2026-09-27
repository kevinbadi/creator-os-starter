import "server-only";

const KEY = process.env.GIPHY_API_KEY ?? "";
export const giphyConfigured = Boolean(KEY);

export type GiphyResult = {
  id: string;
  title: string;
  preview: string; // animated gif for the grid
  mp4: string; // mp4 we actually post (carousel-safe everywhere)
};

function map(data: unknown[]): GiphyResult[] {
  return (data as Record<string, never>[])
    .map((g) => {
      const img = (g as { images?: Record<string, { url?: string; mp4?: string }> })
        .images ?? {};
      return {
        id: String((g as { id?: string }).id ?? ""),
        title: String((g as { title?: string }).title || "GIF"),
        preview: img.fixed_width?.url || img.original?.url || "",
        mp4: img.original?.mp4 || img.fixed_width?.mp4 || "",
      };
    })
    .filter((r) => r.id && r.mp4 && r.preview);
}

export async function searchGiphy(q: string, limit = 24): Promise<GiphyResult[]> {
  if (!KEY) throw new Error("GIPHY_API_KEY is not set");
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${KEY}&q=${encodeURIComponent(
    q,
  )}&limit=${limit}&rating=pg-13&bundle=messaging_non_clips`;
  const r = await fetch(url, { next: { revalidate: 300 } });
  if (!r.ok) throw new Error(`Giphy ${r.status}`);
  const j = await r.json();
  return map(j.data ?? []);
}

export async function trendingGiphy(limit = 24): Promise<GiphyResult[]> {
  if (!KEY) throw new Error("GIPHY_API_KEY is not set");
  const url = `https://api.giphy.com/v1/gifs/trending?api_key=${KEY}&limit=${limit}&rating=pg-13&bundle=messaging_non_clips`;
  const r = await fetch(url, { next: { revalidate: 300 } });
  if (!r.ok) throw new Error(`Giphy ${r.status}`);
  const j = await r.json();
  return map(j.data ?? []);
}
