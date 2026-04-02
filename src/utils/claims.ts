function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Extracts a deduplicated list of roles from one or more claim/verify objects.
 * Handles multiple claim formats: roles, role, permissions, permission, scope,
 * scopes, and the Microsoft WS-Federation role claim URI.
 */
export function extractRoles(
  ...sources: Array<Record<string, unknown> | null | undefined>
): string[] {
  const fromClaims = sources
    .flatMap((tokenData) => [
      tokenData?.roles,
      tokenData?.role,
      tokenData?.permissions,
      tokenData?.permission,
      tokenData?.scope,
      tokenData?.scopes,
      tokenData?.[
        'http://schemas.microsoft.com/ws/2008/06/identity/claims/role'
      ],
    ])
    .flatMap(toStringArray);
  return Array.from(new Set(fromClaims));
}

/**
 * Extracts the company origin identifier from one or more claim/verify objects.
 * Returns the first non-empty value found across the known field name variants.
 */
export function extractCompanyOrigin(
  ...sources: Array<Record<string, unknown> | null | undefined>
): string {
  let raw: unknown = '';
  for (const tokenData of sources) {
    raw =
      tokenData?.company_origin ??
      tokenData?.companyOrigin ??
      tokenData?.company_id ??
      tokenData?.companyId ??
      tokenData?.origin_company ??
      tokenData?.company ??
      raw;
    if (String(raw ?? '').trim()) break;
  }
  return String(raw ?? '').trim();
}
