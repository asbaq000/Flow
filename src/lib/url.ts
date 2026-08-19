/**
 * Link hygiene. Task links are rendered as real anchors, so every URL that
 * reaches the database has to pass through here first — whether it arrived
 * with a brand new task or was added to an existing one later.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;

  // A bare domain is a normal thing to paste; anything with a scheme keeps it,
  // and only http/https survive the check below.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
