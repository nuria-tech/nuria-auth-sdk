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

/**
 * Extracts the user avatar URL from one or more claim/verify objects.
 * Handles multiple field name variants: avatar_url, avatarUrl, picture, photo.
 * Returns an empty string when none are present.
 */
export function extractAvatarUrl(
  ...sources: Array<Record<string, unknown> | null | undefined>
): string {
  for (const tokenData of sources) {
    const raw =
      tokenData?.avatar_url ??
      tokenData?.avatarUrl ??
      tokenData?.picture ??
      tokenData?.photo ??
      '';
    const value = String(raw ?? '').trim();
    if (value) return value;
  }
  return '';
}

/**
 * Extracts the user's display name from one or more claim/verify objects.
 * Falls back across the usual field variants: subject_name, subjectName,
 * given_name, name, and finally the local part of the email.
 */
export function extractDisplayName(
  ...sources: Array<Record<string, unknown> | null | undefined>
): string {
  for (const tokenData of sources) {
    const raw =
      tokenData?.subject_name ??
      tokenData?.subjectName ??
      tokenData?.given_name ??
      tokenData?.name ??
      '';
    const value = String(raw ?? '').trim();
    if (value) return value;
  }
  for (const tokenData of sources) {
    const email = String(tokenData?.subject_email ?? tokenData?.email ?? '').trim();
    if (email) {
      const localPart = email.split('@')[0] ?? '';
      if (localPart) return localPart;
    }
  }
  return '';
}

/**
 * Returns display initials for a name. Splits on whitespace and takes the
 * first letter of up to `max` words, uppercased. If the name has a single
 * word, returns only its first letter.
 *
 * Examples:
 *  getInitials('Lucas Passos') // 'LP'
 *  getInitials('Lucas')        // 'L'
 *  getInitials('')             // ''
 */
export function getInitials(name: string | null | undefined, max = 2): string {
  const source = String(name ?? '').trim();
  if (!source) return '';
  return source
    .split(/\s+/)
    .slice(0, Math.max(1, max))
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
