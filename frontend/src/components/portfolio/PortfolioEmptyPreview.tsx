export default function PortfolioEmptyPreview({ kind }: { kind: "image" | "video" }) {
  return (
    <span className={`amp-portfolio-empty-preview is-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 184 116" fill="none" focusable="false">
        <ellipse cx="92" cy="106" rx="66" ry="2" fill="#e6ebf2" />
        <g className="amp-portfolio-empty-frame">
          {kind === "image" ? <>
            <rect x="44" y="14" width="96" height="88" rx="6" fill="white" stroke="#c8d2de" />
            <rect x="52" y="22" width="80" height="54" rx="2" fill="#edf2f7" />
            <circle cx="113" cy="36" r="6" fill="#d0b56b" />
            <path d="m52 62 22-24 29 38H52V62Z" fill="#b9cadb" />
            <path d="m82 76 24-29 26 22v7H82Z" fill="#d7e2ed" />
            <path d="M53 85h50M53 92h30" stroke="#c8d2de" strokeWidth="3" strokeLinecap="round" />
          </> : <>
            <rect x="28" y="26" width="128" height="76" rx="6" fill="white" stroke="#c8d2de" />
            <rect x="36" y="34" width="112" height="46" rx="3" fill="#e8f1f1" />
            <circle cx="92" cy="57" r="12" fill="#547d80" />
            <path d="m89 51 9 6-9 6V51Z" fill="white" />
            <path d="M37 91h110" stroke="#dce7e7" strokeWidth="3" strokeLinecap="round" />
            <path d="M37 91h51" stroke="#547d80" strokeWidth="3" strokeLinecap="round" />
            <circle cx="88" cy="91" r="3" fill="#547d80" />
          </>}
        </g>
      </svg>
    </span>
  );
}
