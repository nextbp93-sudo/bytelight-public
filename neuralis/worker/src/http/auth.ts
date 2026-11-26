import type { Env, MCPResponse } from "../types";

const BASIC_AUTH_CLIENT_ID = "neuralis";

export function timingSafeEqual(left: string, right: string): boolean {
  let mismatch = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0;
    const rightCode = index < right.length ? right.charCodeAt(index) : 0;
    mismatch |= leftCode ^ rightCode;
  }

  return mismatch === 0;
}

export function isAuthorizedRequest(request: Request, env: Env): boolean {
  // Service binding bypass — internal worker-to-worker calls
  const internalKey = request.headers.get("X-Internal-Key");
  if (internalKey && env.INTERNAL_KEY && timingSafeEqual(internalKey, env.INTERNAL_KEY)) {
    return true;
  }

  const expectedToken = env.MIND_API_KEY?.trim();
  if (!expectedToken) return false;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return false;

  if (authHeader.startsWith("Basic ")) {
    try {
      const decoded = atob(authHeader.slice(6));
      const separatorIndex = decoded.indexOf(":");
      if (separatorIndex === -1) return false;

      const clientId = decoded.slice(0, separatorIndex);
      const clientSecret = decoded.slice(separatorIndex + 1);
      return (
        timingSafeEqual(clientId, BASIC_AUTH_CLIENT_ID) &&
        timingSafeEqual(clientSecret, expectedToken)
      );
    } catch {
      return false;
    }
  }

  if (authHeader.startsWith("Bearer ")) {
    return timingSafeEqual(authHeader.slice(7).trim(), expectedToken);
  }

  return false;
}

export function isAuthorizedConnectorPath(url: URL, env: Env): boolean {
  const connectorSecret = env.MCP_CONNECTOR_SECRET?.trim();
  if (!connectorSecret) return false;

  const expectedPath = `/mcp/${connectorSecret}`;
  return timingSafeEqual(url.pathname, expectedPath);
}

export function createUnauthorizedMcpResponse(id: string | number | null = 0): Response {
  const response: MCPResponse = {
    jsonrpc: "2.0",
    id,
    error: { code: -32600, message: "Unauthorized" }
  };

  return new Response(JSON.stringify(response), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}
