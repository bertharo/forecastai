"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const full = [error.message, error.digest ? `digest=${error.digest}` : null]
    .filter(Boolean)
    .join("\n");
  const isDb =
    /ECONNREFUSED|connect|postgres|DATABASE|unavailable/i.test(full) ||
    /ECONNREFUSED|connect|postgres|DATABASE/i.test(String(error.cause ?? ""));

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-lg font-semibold">This page couldn&apos;t load</div>
      <p className="muted max-w-md text-[13px]">
        {isDb ? (
          <>
            Postgres isn&apos;t reachable. Start it with{" "}
            <span className="mono">brew services start postgresql@16</span>, then
            ensure the <span className="mono">meter</span> database is seeded (
            <span className="mono">npm run db:setup</span>).
          </>
        ) : (
          <>A server error occurred. Reload to try again.</>
        )}
      </p>
      <pre
        className="mono max-w-lg overflow-auto whitespace-pre-wrap p-2 text-left text-[11px]"
        style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
      >
        {full}
      </pre>
      <button type="button" className="btn" onClick={() => reset()}>
        Reload
      </button>
    </div>
  );
}
