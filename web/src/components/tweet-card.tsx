import { FaRegComment, FaRetweet, FaRegHeart, FaArrowUpFromBracket } from "react-icons/fa6";
import type { DiscourseSignal } from "@/lib/queries";

function fmtTweetDate(raw: string | null): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

/** A flagged post, laid out like an actual X/Twitter post embed — avatar,
 * name/handle/date row, body text, a purely decorative action row (no
 * counts to show, just the familiar silhouette) — instead of looking like
 * another rule/signal card. The whole thing links out to the real post. */
export function TweetCard({ post, fallbackName }: { post: DiscourseSignal; fallbackName: string }) {
  const name = post.personName ?? fallbackName;
  const initial = (name || post.handle || "?").trim().charAt(0).toUpperCase();

  return (
    <a href={post.url ?? undefined} target="_blank" rel="noreferrer" className="tweet-card">
      <div className="tweet-card__avatar">{initial}</div>
      <div className="tweet-card__main">
        <div className="tweet-card__head">
          <span className="tweet-card__name">{name}</span>
          <span className="tweet-card__handle">@{post.handle}</span>
          <span className="tweet-card__dot">·</span>
          <span className="tweet-card__date">{fmtTweetDate(post.postedAt)}</span>
          {post.severity ? (
            <span
              className={`badge ${post.severity === "high" ? "badge--red" : post.severity === "medium" ? "badge--accent" : ""}`}
              style={{ marginLeft: "auto" }}
            >
              {post.severity}
            </span>
          ) : null}
        </div>
        {post.replyToHandle ? (
          <div className="tweet-card__reply">Respondendo a @{post.replyToHandle}</div>
        ) : null}
        <p className="tweet-card__text">{post.text}</p>
        {post.categories.length > 0 ? (
          <div className="tweet-card__tags">
            {post.categories.map((c) => (
              <span key={c} className="badge">{c}</span>
            ))}
          </div>
        ) : null}
        <div className="tweet-card__actions">
          <span><FaRegComment /></span>
          <span><FaRetweet /></span>
          <span><FaRegHeart /></span>
          <span><FaArrowUpFromBracket /></span>
        </div>
      </div>
    </a>
  );
}
