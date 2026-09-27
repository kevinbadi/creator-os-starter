import { redirect } from "next/navigation";

// Personal single-user app — no marketing landing page.
// The proxy gates everything; unauthenticated users land on /login.
export default function Home() {
  redirect("/dashboard");
}
