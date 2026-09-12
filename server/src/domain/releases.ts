/**
 * Versions, and what is new since an account last looked (§18.12).
 *
 * Pure on purpose: the client imports this through `@domain` to decide whether
 * the Yenilikler dialog opens, and the server uses it to keep an account's mark
 * from ever moving backwards, so the two agree on what "newer" means. A string
 * comparison does not: `1.10.0` sorts before `1.9.0` as text and after it as a
 * version.
 */

/** `major.minor.patch`, with or without the `v` a git tag would carry. */
export const VERSION_PATTERN = /^v?\d+\.\d+\.\d+$/;

export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

/** The three numbers, however the version was written. */
function parts(version: string): number[] {
  return version.replace(/^v/, '').split('.').map(Number);
}

/** Negative when `a` is older, positive when newer, zero when the same. */
export function compareVersions(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Newer than what was last seen. Anything is newer than nothing. */
export function isNewer(version: string, lastSeen: string | null): boolean {
  return lastSeen === null || compareVersions(version, lastSeen) > 0;
}

export interface ReleaseLike {
  version: string;
  /** Worth opening the dialog for on its own. A release of nothing but fixes is not. */
  announce: boolean;
}

/** The releases an account has not seen, newest first, whatever order they came in. */
export function unseenReleases<T extends ReleaseLike>(
  releases: readonly T[],
  lastSeen: string | null,
): T[] {
  return releases
    .filter((r) => isNewer(r.version, lastSeen))
    .sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Whether what is unseen is worth interrupting for: at least one release among
 * it asked to be announced. Fix-only releases ride along in the list once the
 * dialog is open, but never open it.
 */
export function shouldAnnounce(releases: readonly ReleaseLike[], lastSeen: string | null): boolean {
  return unseenReleases(releases, lastSeen).some((r) => r.announce);
}

/** The newest version in the catalogue, or null when it is empty. */
export function newestVersion(releases: readonly ReleaseLike[]): string | null {
  let newest: string | null = null;
  for (const r of releases) {
    if (newest === null || compareVersions(r.version, newest) > 0) newest = r.version;
  }
  return newest;
}
