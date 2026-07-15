export function parseCorsOrigins(value: string | undefined) {
  const origins = new Set<string>();
  for (const item of value?.split(",") ?? []) {
    const candidate = item.trim();
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if ((url.protocol === "http:" || url.protocol === "https:") && url.origin === candidate.replace(/\/$/, "")) {
        origins.add(url.origin);
      }
    } catch {
      // Invalid origins are ignored here and reported by the deployment preflight.
    }
  }
  return [...origins];
}

export function corsOriginAllowed(origin: string | undefined, allowedOrigins: string[]) {
  return !origin || allowedOrigins.includes(origin);
}

export function parseTrustProxy(value: string | undefined): false | number | string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized || normalized === "false" || normalized === "0") return false;
  if (/^\d+$/.test(normalized)) {
    const hops = Number(normalized);
    return hops > 0 && hops <= 10 ? hops : false;
  }
  if (["loopback", "linklocal", "uniquelocal"].includes(normalized)) return normalized;
  return false;
}
