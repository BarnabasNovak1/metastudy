// Parse only documented GCS/Firebase URL formats. Bucket and owner validation
// is still required before using the Admin SDK, which bypasses Storage rules.
export function parseStorageSource(rawGs, rawUrl) {
  if (rawGs) {
    const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(rawGs);
    if (!match) throw new Error('Invalid gsPath');
    return { bucketName: match[1], objectPath: match[2] };
  }
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('Invalid storage URL');
  }
  if (url.hostname === 'firebasestorage.googleapis.com') {
    const match = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(url.pathname);
    if (match) return { bucketName: match[1], objectPath: decodeURIComponent(match[2]) };
  } else if (url.hostname === 'storage.googleapis.com') {
    const match = /^\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (match) return { bucketName: match[1], objectPath: decodeURIComponent(match[2]) };
  }
  throw new Error('Invalid storage URL');
}

export function validateStorageSource(bucketName, objectPath, uid, allowedBuckets) {
  if (!allowedBuckets.has(bucketName)) return 'Invalid file location';
  if (!uid || !objectPath?.startsWith(`users/${uid}/`)) return 'File must be in your own storage folder';
  return null;
}
