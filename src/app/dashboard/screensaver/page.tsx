"use client";

import { Component as StarshipShader } from "@/components/ui/starship-shader";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ScreensaverPage() {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push("/dashboard");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <StarshipShader />
    </div>
  );
}
