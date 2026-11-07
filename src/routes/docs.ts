import { Hono } from "hono";
import type { AppEnv } from "../types";
import externalApiDoc from "../../docs/external-api.md";
import openApiSpec from "../../docs/openapi.yaml";

/**
 * Serves the API docs over plain HTTP, no auth — the external platform team
 * needs to read them without a portal account. The files in docs/ are the
 * single source; this just republishes them at stable URLs. The interactive
 * reference (Scalar) is a static page at /docs/ (public/docs/).
 */
export const docs = new Hono<AppEnv>();

docs.get("/docs/external-api.md", (c) =>
  c.text(externalApiDoc, 200, { "content-type": "text/markdown; charset=utf-8" }),
);

// OpenAPI spec backing the Scalar reference at /docs/.
docs.get("/docs/openapi.yaml", (c) =>
  c.text(openApiSpec, 200, { "content-type": "application/yaml; charset=utf-8" }),
);

export default docs;
