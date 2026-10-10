export default function CreationDraftPreview({ kind }: { kind: "image" | "video" }) {
  const isVideo = kind === "video";
    return (
      <span className={`amp-creation-media-draft is-${kind}`}>
        <span className="amp-creation-draft-backdrop"><i /><i /><i /></span>
        <span className="amp-creation-draft-window">
          <svg viewBox="0 0 88 54" fill="none" aria-hidden="true">
            <path d="M0 40 24 19l17 14 19-20 28 27v14H0Z" fill="#dce6f8" />
            <circle cx="67" cy="13" r="5" fill="#c3b5eb" />
            {isVideo && <>
              <circle cx="44" cy="27" r="12" fill="#526fd1" />
              <path d="m41 21 9 6-9 6V21Z" fill="white" />
            </>}
          </svg>
        </span>
        <span className="amp-creation-draft-strip"><i /><i /><i />{isVideo && <b />}</span>
      </span>
    );
}
