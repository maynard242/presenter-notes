// Vercel serverless function entrypoint.
// Re-exports the Express app (which is itself a (req, res) handler) as default
// so it can be invoked by @vercel/node without calling app.listen().
export { default } from "./app";

// Vercel reads this export from the function file at deploy time. Replaces
// the `functions` block in vercel.json, which was incompatible with newer
// Vercel CLI versions that validate `functions` patterns pre-build (api/
// is gitignored and only created during the build).
export const maxDuration = 30;
