/** True when this machine can talk to Creator OS / Zernio. Never log the value. */
export function creatorOsPublishKeyConfigured(): boolean {
  return Boolean(
    (process.env.CREATOR_OS_API_KEY || "").trim() ||
      (process.env.ZERNIO_API_KEY || "").trim(),
  );
}

/** Forks should use the profile-scoped key from creatoros.ca, not a borrowed master key. */
export function creatorOsForkKeyConfigured(): boolean {
  return Boolean((process.env.CREATOR_OS_API_KEY || "").trim());
}
