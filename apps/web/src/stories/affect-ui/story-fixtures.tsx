/** Original, local-only artwork for story fixtures; no external image requests. */
export function sampleImage(label: string, background = '#1d4ed8') {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="300" viewBox="0 0 240 300"><rect width="240" height="300" rx="16" fill="${background}"/><circle cx="180" cy="60" r="80" fill="white" opacity=".12"/><text x="120" y="160" text-anchor="middle" fill="white" font-family="system-ui" font-size="28">${label}</text></svg>`)}`;
}
