"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[app:error]", error);

  const redacted = /omitted in production/i.test(error.message);
  const isDb =
    !redacted &&
    (/ECONNREFUSED|connect|postgres|DATABASE|unavailable/i.test(error.message) ||
      /ECONNREFUSED|connect|postgres|DATABASE/i.test(String(error.cause ?? "")));

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-lg font-semibold">This page couldn&apos;t load</div>
      <p className="muted max-w-md text-[13px]">
        {isDb ? (
          <>
            Postgres isn&apos;t reachable from the app. In a terminal run{" "}
            <span className="mono">brew services start postgresql@16</span>, then{" "}
            <span className="mono">npm run db:setup</span> and{" "}
            <span className="mono">npm run dev</span>. Open{" "}
            <span className="mono">http://127.0.0.1:3000</span> (not a remote preview).
          </>
        ) : redacted ? (
          <>
            Something went wrong loading this page. Try <strong>Reload</strong>. To see sample
            data, open{" "}
            <a className="underline" href="/onboarding">
              Workspaces
            </a>{" "}
            and tap <strong>Open the demo</strong>.
          </>
        ) : (
          <>
            Try Reload. If it keeps happening, refresh the page or open Workspaces and switch
            folders.
          </>
        )}
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
