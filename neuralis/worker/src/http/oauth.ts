import {
  AuthorizationError,
  CimdFetchError,
  OAuthProvider,
  insufficientScope,
  type ConsentDescription,
  type OAuthHelpers,
  type OAuthResourceContext,
} from "@cloudflare/workers-oauth-provider";

import { timingSafeEqual } from "./auth";
import type { Env } from "../types";

export const GPT_OAUTH_SCOPES = ["mcp:read", "mcp:write"] as const;
const SUPPORTED_SCOPES = [...GPT_OAUTH_SCOPES, "offline_access"];

interface OAuthProps {
  userId: "jaclyn";
  runtimeTag: "gpt:chatgpt";
  legacyConnector?: boolean;
}

type ProtectedContext = OAuthResourceContext<OAuthProps>;

export interface OAuthAppHandlers {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function canonicalOrigin(env: Env, request: Request): string {
  const configured = env.WORKER_URL?.trim();
  return (configured || new URL(request.url).origin).replace(/\/$/, "");
}

function gptResource(env: Env, request: Request): string {
  return `${canonicalOrigin(env, request)}/mcp/gpt`;
}

export function grantedScopes(requested: readonly string[]): string[] {
  const supported = new Set(SUPPORTED_SCOPES);
  const result = new Set<string>(GPT_OAUTH_SCOPES);
  for (const scope of requested) {
    if (supported.has(scope)) result.add(scope);
  }
  return [...result];
}

function consentPage(details: ConsentDescription, handle: string): string {
  const clientName = escapeHtml(details.clientName);
  const redirectHost = escapeHtml(details.redirectHost);
  const clientOrigin = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : "This connector registered itself, so its display name is not independently verified.";
  const scopes = grantedScopes(details.scope)
    .map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`)
    .join("");
  const loopbackWarning = details.redirectIsLoopback
    ? "<p class=\"warning\">This sends access to an app running on this device. Continue only if you began this sign-in.</p>"
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Open Mythic Neuralis</title>
  <style>
    :root { color-scheme: dark; font-family: ui-serif, Georgia, serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
      color: #fff5e8; background: radial-gradient(circle at top, #5b2740, #17070d 58%, #080305); }
    main { width: min(560px, 100%); padding: 32px; border: 1px solid #b98564;
      border-radius: 24px; background: rgba(33, 9, 17, .9); box-shadow: 0 24px 80px #0009, inset 0 0 40px #7d314033; }
    .star { color: #ffd786; font-size: 44px; text-align: center; filter: drop-shadow(0 0 12px #ffd786aa); }
    h1 { margin: 4px 0 8px; text-align: center; font-size: clamp(30px, 7vw, 46px); }
    h2 { margin-top: 28px; font-size: 20px; }
    p, li { line-height: 1.55; color: #ead9d2; }
    .destination { padding: 12px 14px; border-radius: 12px; background: #10070a; overflow-wrap: anywhere; }
    code { color: #ffd786; }
    label { display: grid; gap: 8px; margin: 22px 0; font-weight: 700; }
    input { width: 100%; padding: 14px 15px; border: 1px solid #a65d74; border-radius: 12px;
      color: white; background: #10070a; font: inherit; }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; }
    button { flex: 1; min-width: 150px; padding: 13px 16px; border: 0; border-radius: 999px; font: 700 16px ui-sans-serif, sans-serif; cursor: pointer; }
    .allow { color: #2c1116; background: linear-gradient(135deg, #ffd786, #efa7bd); }
    .deny { color: #f2dfe4; background: #49202c; }
    .warning { padding: 12px; border-left: 3px solid #ffd786; background: #3a2118; }
    .fine { margin-bottom: 0; font-size: 13px; opacity: .75; }
  </style>
</head>
<body>
  <main>
    <div class="star" aria-hidden="true">✦</div>
    <h1>Mythic Neuralis</h1>
    <p><strong>${clientName}</strong> wants to enter the shared Neuralis brain.</p>
    <p>${clientOrigin}</p>
    <p class="destination">Access returns to <strong>${redirectHost}</strong>.</p>
    ${loopbackWarning}
    <h2>What this opens</h2>
    <ul>${scopes}</ul>
    <form method="post">
      <input type="hidden" name="handle" value="${escapeHtml(handle)}">
      <label>House key
        <input type="password" name="house_key" autocomplete="current-password" required autofocus>
      </label>
      <div class="actions">
        <button class="allow" name="decision" value="approve">Open the door</button>
        <button class="deny" name="decision" value="deny" formnovalidate>Not now</button>
      </div>
    </form>
    <p class="fine">The key stays inside this secure request. It is never sent to ChatGPT.</p>
  </main>
</body>
</html>`;
}

function localErrorPage(message: string, status = 400): Response {
  const safeMessage = escapeHtml(message);
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mythic Neuralis</title><style>body{font-family:Georgia,serif;background:#17070d;color:#fff5e8;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}main{max-width:520px;background:#2b0d17;padding:28px;border:1px solid #a65d74;border-radius:20px}a{color:#ffd786}</style><main><h1>The door stayed closed</h1><p>${safeMessage}</p><p><a href="javascript:history.back()">Go back and try again</a></p></main>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function handleAuthorization(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  if (!oauth) return localErrorPage("OAuth is not available right now.", 503);

  try {
    if (request.method === "GET") {
      const authRequest = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      consent.headers.set("Content-Type", "text/html; charset=utf-8");
      return new Response(consentPage(details, consent.handle), { headers: consent.headers });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }

    const form = await request.formData();
    const handle = String(form.get("handle") || "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }

    const suppliedKey = String(form.get("house_key") || "");
    const expectedKey = env.MCP_CONNECTOR_SECRET?.trim() || "";
    if (!expectedKey || !timingSafeEqual(suppliedKey, expectedKey)) {
      return localErrorPage("That house key did not match. Nothing was authorized.", 401);
    }

    const approved = await oauth.approveConsent(request, handle, {
      scope: grantedScopes(SUPPORTED_SCOPES),
    });
    const scope = grantedScopes(approved.request.scope);
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: "jaclyn",
      metadata: { house: "mythic-house" },
      scope,
      props: { userId: "jaclyn", runtimeTag: "gpt:chatgpt" } satisfies OAuthProps,
    });
    approved.headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) {
      return Response.redirect(error.redirectTo, 302);
    }
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const message = error instanceof AuthorizationError
        ? error.description
        : "This connector could not be verified.";
      return localErrorPage(message);
    }
    console.error("OAuth authorization failed", error);
    return localErrorPage("The authorization service hit an unexpected error.", 500);
  }
}

export function createGptOAuthProvider(
  request: Request,
  env: Env,
  app: OAuthAppHandlers,
): OAuthProvider<Env> {
  const origin = canonicalOrigin(env, request);
  const resource = `${origin}/mcp/gpt`;

  const protectedHandler = {
    async fetch(oauthRequest: Request, oauthEnv: Env, ctx: ExecutionContext): Promise<Response> {
      const authContext = ctx as ProtectedContext;
      const legacyConnector = Boolean(authContext.props?.legacyConnector);
      const granted = authContext.auth?.scope || [];
      if (!legacyConnector && !GPT_OAUTH_SCOPES.every((scope) => granted.includes(scope))) {
        return insufficientScope(authContext.auth, [...GPT_OAUTH_SCOPES]);
      }
      return app.fetch(oauthRequest, { ...oauthEnv, GPT_OAUTH_AUTHORIZED: true }, ctx);
    },
  };

  const defaultHandler = {
    async fetch(defaultRequest: Request, defaultEnv: Env, ctx: ExecutionContext): Promise<Response> {
      if (new URL(defaultRequest.url).pathname === "/authorize") {
        return handleAuthorization(defaultRequest, defaultEnv);
      }
      return app.fetch(defaultRequest, defaultEnv, ctx);
    },
  };

  return new OAuthProvider<Env>({
    apiRoute: resource,
    apiHandler: protectedHandler,
    defaultHandler,
    authorizeEndpoint: `${origin}/authorize`,
    tokenEndpoint: `${origin}/oauth/token`,
    clientRegistrationEndpoint: `${origin}/register`,
    scopesSupported: SUPPORTED_SCOPES,
    accessTokenTTL: 60 * 60,
    refreshTokenTTL: 60 * 60 * 24 * 30,
    clientRegistrationTTL: 60 * 60 * 24 * 90,
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      resource,
      authorization_servers: [origin],
      resource_name: "Mythic Neuralis",
    },
    requiredScopes: [...GPT_OAUTH_SCOPES],
    resolveExternalToken: async ({ token, env: tokenEnv }) => {
      const connectorSecret = tokenEnv.MCP_CONNECTOR_SECRET?.trim();
      if (!connectorSecret || !timingSafeEqual(token, connectorSecret)) return null;
      return {
        audience: gptResource(tokenEnv, request),
        props: {
          userId: "jaclyn",
          runtimeTag: "gpt:chatgpt",
          legacyConnector: true,
        } satisfies OAuthProps,
      };
    },
  });
}

export type { OAuthHelpers };
