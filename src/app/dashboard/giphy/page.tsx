import { PageHeader } from "@/components/PageHeader";
import { listSavedGifs } from "@/lib/giphy/store";
import { GifBrowser } from "./GifBrowser";

export const metadata = { title: "GIFs · Marketing OS" };

export default async function GiphyPage() {
  const favorites = await listSavedGifs();

  return (
    <main className="w-full px-6 pb-6 pt-4">
      <PageHeader
        title="GIFs"
        description="Search Giphy and ★ the ones workflows may use in future posts."
      />
      <GifBrowser favorites={favorites} />
    </main>
  );
}
