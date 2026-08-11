import { Hono } from "hono";
import type { AppEnv } from "../types";
import externalApiDoc from "../../docs/external-api.md";

/**
 * Serves docs/external-api.md over plain HTTP, no auth — the external
 * platform team needs to read it without a portal account. The file in the
 * repo is the single source; this just republishes it at a stable URL.
 */
export const docs = new Hono<AppEnv>();

docs.get("/docs/external-api.md", (c) =>
  c.text(externalApiDoc, 200, { "content-type": "text/markdown; charset=utf-8" }),
);

export default docs;
