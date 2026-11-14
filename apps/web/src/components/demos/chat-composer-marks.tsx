/** Small local marks for the reference demo; no remote images are loaded. */
export function GmailMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 19V6l9 7 9-7v13" stroke="#4285f4" strokeWidth="4" strokeLinejoin="round" />
      <path d="M3 19V6l5 4" stroke="#ea4335" strokeWidth="4" strokeLinejoin="round" />
      <path d="m8 10 4 3 4-3" stroke="#ea4335" strokeWidth="4" />
      <path d="m16 10 5-4" stroke="#fbbc04" strokeWidth="4" />
      <path d="M21 10v9" stroke="#34a853" strokeWidth="4" />
    </svg>
  );
}

export function SlackMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g fill="#36c5f0">
        <rect x="2" y="8" width="9" height="4" rx="2" />
        <rect x="7" y="3" width="4" height="4" rx="2" />
      </g>
      <g fill="#2eb67d">
        <rect x="12" y="2" width="4" height="9" rx="2" />
        <rect x="17" y="7" width="4" height="4" rx="2" />
      </g>
      <g fill="#ecb22e">
        <rect x="13" y="12" width="9" height="4" rx="2" />
        <rect x="13" y="17" width="4" height="4" rx="2" />
      </g>
      <g fill="#e01e5a">
        <rect x="8" y="13" width="4" height="9" rx="2" />
        <rect x="3" y="13" width="4" height="4" rx="2" />
      </g>
    </svg>
  );
}

export function ClickUpMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="4" aria-hidden="true">
      <path d="m4 10 8-7 8 7" stroke="#f44ba4" />
      <path d="M4 15q8 10 16 0" stroke="#8055f9" />
      <path d="m12 3 8 7" stroke="#ffad35" />
      <path d="M12 20q4 0 8-5" stroke="#36b9f0" />
    </svg>
  );
}

export function ClaudeMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#c66845" strokeWidth="1.5" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <path key={index} d="M12 2v8" transform={`rotate(${index * 30} 12 12)`} />
      ))}
    </svg>
  );
}
