export async function register() {
  // no-op — enables onRequestError in Next.js
}

export async function onRequestError(
  err: { digest?: string } & Error,
  request: { path: string; method: string },
  context: { routePath?: string }
) {
  console.error("[meter:onRequestError]", {
    digest: err.digest,
    message: err.message,
    stack: err.stack,
    path: request.path,
    method: request.method,
    routePath: context.routePath,
  });
}
