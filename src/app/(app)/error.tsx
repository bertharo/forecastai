"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[app:error]", error);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-lg font-semibold">This page couldn&apos;t load</div>
      <p className="muted max-w-md text-[13px]">
        If this persists, restart the app with <span className="mono">npm run dev</span> and ensure
        Postgres is up (<span className="mono">brew services start postgresql@16</span>).
      </p>
      <pre
        className="mono max-w-lg overflow-auto whitespace-pre-wrap p-2 text-left text-[11px]"
        style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
      >
        {[error.message, error.digest ? `digest=${error.digest}` : null]
          .filter(Boolean)
          .join("\n")}
      </pre>
      <button type="button" className="btn" onClick={() => reset()}>
        Reload
      </button>
    </div>
  );
}
