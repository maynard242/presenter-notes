// Vercel serverless function entrypoint.
// Re-exports the Express app (which is itself a (req, res) handler) as default
// so it can be invoked by @vercel/node without calling app.listen().
export { default } from "./app";
