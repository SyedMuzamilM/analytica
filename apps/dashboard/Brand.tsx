export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M6 17v-4m6 4V8m6 9V4" />
        </svg>
      </span>
      <span>
        analytica<span className="brand-period">.</span>
      </span>
    </span>
  );
}
