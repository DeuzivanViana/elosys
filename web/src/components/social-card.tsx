import {
  FaFacebook, FaInstagram, FaXTwitter, FaYoutube, FaTiktok, FaLinkedin,
  FaWhatsapp, FaTelegram, FaGlobe, FaVideo, FaLink,
} from "react-icons/fa6";
import type { IconType } from "react-icons";
import type { SocialMediaLink } from "@/lib/queries";

const PLATFORM_ICON: Record<string, IconType> = {
  facebook: FaFacebook,
  instagram: FaInstagram,
  x: FaXTwitter,
  youtube: FaYoutube,
  tiktok: FaTiktok,
  linkedin: FaLinkedin,
  whatsapp: FaWhatsapp,
  telegram: FaTelegram,
  kwai: FaVideo,
  website: FaGlobe,
  other: FaLink,
};

// Each platform's own brand color (not the app's palette) — the whole point
// is these read as "the real Facebook/Instagram/X icon", not a themed one.
// X is the one exception: its actual mark is black-or-white depending on
// what it sits on (there's no single "X brand color"), so it uses the
// theme's own foreground instead of a fixed hex — otherwise a hardcoded
// white icon disappears on a light card in light mode (or vice versa).
const PLATFORM_COLOR: Record<string, string> = {
  facebook: "#1877F2",
  instagram: "#E4405F",
  x: "var(--fg-1)",
  youtube: "#FF0000",
  tiktok: "#FE2C55",
  linkedin: "#0A66C2",
  whatsapp: "#25D366",
  telegram: "#26A5E4",
  kwai: "#FF6600",
  website: "var(--muted)",
  other: "var(--muted)",
};

const HANDLE_PLATFORMS = new Set(["facebook", "instagram", "x", "youtube", "tiktok", "linkedin", "telegram", "kwai"]);

function labelFor(platform: string, url: string): string {
  try {
    const u = new URL(url);
    const segment = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop();
    if (segment && HANDLE_PLATFORMS.has(platform)) return `@${decodeURIComponent(segment)}`;
    return u.hostname.replace(/^www\./, "") + (segment ? `/${decodeURIComponent(segment)}` : "");
  } catch {
    return url;
  }
}

/** One declared social/site link — platform's own brand-colored icon, the
 * handle/URL, and the year it was declared. A card, not a bare icon: click
 * goes straight to the account. */
export function SocialCard({ social }: { social: SocialMediaLink }) {
  const Icon = PLATFORM_ICON[social.platform] ?? FaLink;
  const color = PLATFORM_COLOR[social.platform] ?? "var(--muted)";
  return (
    <a href={social.url} target="_blank" rel="noreferrer" className="social-card">
      <Icon size={22} color={color} className="social-card__icon" />
      <div className="min-w-0 flex-1">
        <div className="social-card__label">{labelFor(social.platform, social.url)}</div>
        <div className="social-card__year">declarado em {social.year}</div>
      </div>
    </a>
  );
}
