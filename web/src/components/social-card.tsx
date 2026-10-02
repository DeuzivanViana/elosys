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

// X uses the theme foreground: a fixed white icon vanishes on light cards.
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
