// A "channel" is one marketing surface in the dashboard — your personal brand,
// a mobile app's socials, or an AI-UGC brand. One channel can aggregate MANY
// Zernio profiles (each profile groups its own connected accounts).

export type ChannelType = "personal" | "app" | "ugc" | "yt-automation";

export type Channel = {
  id: string;
  name: string;
  type: ChannelType;
  /** Accent color for the switcher dot. */
  color?: string;
  /** Zernio profile IDs that feed this channel. May be several. */
  zernioProfileIds: string[];
  /** Optional short subtitle (e.g. app store name, handle). */
  subtitle?: string;
  /** RevenueCat project ID for app channels (revenue/subscriber metrics). */
  revenuecatProjectId?: string;
  /** Per-channel RevenueCat v2 secret key. Falls back to REVENUECAT_API_KEY. */
  revenuecatApiKey?: string;
  /** PostHog project id for web-visitor tracking (app channels with a site). */
  posthogProjectId?: string;
  /** PostHog API host (US/EU cloud or self-hosted). Defaults to US cloud. */
  posthogHost?: string;
};

export const CHANNEL_TYPE_LABEL: Record<ChannelType, string> = {
  personal: "Personal brand",
  app: "Apps",
  ugc: "AI UGC",
  // Standalone venture — not part of Creator OS's app/persona marketing.
  "yt-automation": "YouTube Automation Channels",
};

export const CHANNEL_TYPE_ORDER: ChannelType[] = [
  "personal",
  "app",
  "ugc",
  "yt-automation",
];
