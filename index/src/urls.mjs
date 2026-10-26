// The one place URLs are built. Used by the resolver, the copy command and the catalog generator,
// so they cannot disagree. The host is only the `cdn` base of an index.json set entry.

const PART = /^part\d+$/;

function join(base, ...rest) {
  return [base.replace(/\/+$/, ''), ...rest].join('/');
}

/** Base URL (ending in a slash) of the package that holds a file, for a file's `package` field. */
export function packageCdn(entry, pkg, version = entry.version) {
  let cdn = entry.cdn, from = entry.package, to = entry.package;
  if (pkg?.startsWith('masters')) {
    const part = pkg.slice('masters'.length).replace(/^-/, '');
    cdn = entry.mastersCdn;
    from = entry.mastersPackage;
    to = part ? (entry.mastersParts ?? []).find((p) => p.endsWith(`-${part}`)) ?? `${from}-${part}` : from;
  } else if (pkg) {
    if (!PART.test(pkg)) throw new Error(`unknown package "${pkg}"`);
    to = (entry.parts ?? []).find((p) => p.endsWith(`-${pkg}`)) ?? `${from}-${pkg}`;
  }
  if (version !== entry.version) cdn = cdn.replace(`@${entry.version}/`, `@${version}/`);
  // Hosts that fold volume packages into one tree (see CDN contingency) have no package name in the base.
  return from !== to && cdn.includes(`${from}@`) ? cdn.replace(`${from}@`, `${to}@`) : cdn;
}

/**
 * URL of a manifest file entry. With `base` (a self-hosted or copied tree, laid out as `<base>/<set>/<path>`)
 * the package is irrelevant; otherwise the package's CDN base is used.
 */
export function fileUrl(entry, file, { setId, base, version } = {}) {
  if (base) return join(base, setId, file.path);
  return packageCdn(entry, file.package, version ?? entry.version) + file.path;
}
