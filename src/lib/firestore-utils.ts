import { db } from '../../firebase';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  writeBatch, 
  collection, 
  query, 
  where, 
  getDocs,
  limit,
  DocumentReference,
  DocumentData
} from 'firebase/firestore';

// ==================== CACHING LAYER ====================
// In-memory cache for frequently accessed documents
const docCache = new Map<string, { data: DocumentData; ts: number }>();
const CACHE_TTL = 30000; // 30 seconds

// ==================== USER PROFILE CACHE ====================
// Dedicated cache for user profiles (most frequently accessed)
interface UserProfileCache {
  username?: string;
  photo_url?: string | null;
  photoURL?: string | null;
  plan?: string;
  ts: number;
}
const userProfileCache = new Map<string, UserProfileCache>();
const USER_CACHE_TTL = 60000; // 1 minute for user profiles

export function getCachedUserProfile(uid: string): UserProfileCache | null {
  const cached = userProfileCache.get(uid);
  if (cached && Date.now() - cached.ts < USER_CACHE_TTL) {
    return cached;
  }
  userProfileCache.delete(uid);
  return null;
}

export function setCachedUserProfile(uid: string, data: Partial<UserProfileCache>): void {
  // Limit cache size to 100 users
  if (userProfileCache.size > 100) {
    const oldest = [...userProfileCache.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, 20);
    oldest.forEach(([k]) => userProfileCache.delete(k));
  }
  userProfileCache.set(uid, { ...data, ts: Date.now() });
}

// Batch fetch user profiles with caching
// PRIVACY: reads from the server-maintained public_profiles mirror
// (users/{uid} docs are owner-only readable)
export async function batchFetchUserProfiles(
  uids: string[]
): Promise<Map<string, { username?: string; photo_url?: string | null }>> {
  const results = new Map<string, { username?: string; photo_url?: string | null }>();
  const toFetch: string[] = [];
  
  // Check cache first
  for (const uid of uids) {
    const cached = getCachedUserProfile(uid);
    if (cached) {
      results.set(uid, { username: cached.username, photo_url: cached.photo_url || cached.photoURL });
    } else {
      toFetch.push(uid);
    }
  }
  
  // Fetch uncached in batches of 10 (Firestore 'in' query limit)
  if (toFetch.length > 0) {
    const uniqueToFetch = [...new Set(toFetch)];
    for (let i = 0; i < uniqueToFetch.length; i += 10) {
      const batch = uniqueToFetch.slice(i, i + 10);
      try {
        const q = query(collection(db, 'public_profiles'), where('__name__', 'in', batch));
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const data = d.data() as any;
          const profile = {
            username: data.username || undefined,
            photo_url: data.photo_url || data.photoURL || null,
          };
          results.set(d.id, profile);
          setCachedUserProfile(d.id, profile);
        });
        // Mark missing users
        batch.forEach((uid) => {
          if (!results.has(uid)) {
            results.set(uid, { username: undefined, photo_url: null });
          }
        });
      } catch (e) {
        console.error('Batch user fetch error:', e);
      }
    }
  }
  
  return results;
}

export function getCachedDoc(path: string): DocumentData | null {
  const cached = docCache.get(path);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }
  docCache.delete(path);
  return null;
}

export function setCachedDoc(path: string, data: DocumentData): void {
  // Limit cache size
  if (docCache.size > 50) {
    const oldest = [...docCache.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, 10);
    oldest.forEach(([k]) => docCache.delete(k));
  }
  docCache.set(path, { data, ts: Date.now() });
}

export function invalidateCache(pathPrefix: string): void {
  for (const key of docCache.keys()) {
    if (key.startsWith(pathPrefix)) {
      docCache.delete(key);
    }
  }
}

// ==================== BATCHED WRITES ====================
// Queue for batching multiple writes together
interface BatchedWrite {
  ref: DocumentReference;
  data: DocumentData;
  merge: boolean;
}

let writeQueue: BatchedWrite[] = [];
let batchTimeout: ReturnType<typeof setTimeout> | null = null;
const BATCH_DELAY = 100; // 100ms delay to collect writes

export async function queueWrite(
  ref: DocumentReference, 
  data: DocumentData, 
  merge = true
): Promise<void> {
  writeQueue.push({ ref, data, merge });
  
  if (!batchTimeout) {
    batchTimeout = setTimeout(flushWrites, BATCH_DELAY);
  }
}

export async function flushWrites(): Promise<void> {
  if (writeQueue.length === 0) return;
  
  const toWrite = [...writeQueue];
  writeQueue = [];
  batchTimeout = null;
  
  try {
    if (toWrite.length === 1) {
      // Single write, no need for batch
      const { ref, data, merge } = toWrite[0];
      await setDoc(ref, data, { merge });
    } else {
      // Batch multiple writes (max 500 per batch)
      const batches: BatchedWrite[][] = [];
      for (let i = 0; i < toWrite.length; i += 500) {
        batches.push(toWrite.slice(i, i + 500));
      }
      
      await Promise.all(batches.map(async (batchItems) => {
        const batch = writeBatch(db);
        batchItems.forEach(({ ref, data, merge }) => {
          if (merge) {
            batch.set(ref, data, { merge: true });
          } else {
            batch.set(ref, data);
          }
        });
        await batch.commit();
      }));
    }
  } catch (error) {
    console.error('Batch write failed:', error);
    throw error;
  }
}

// ==================== OPTIMIZED READS ====================
// Fetch with cache
export async function fetchDocCached(path: string): Promise<DocumentData | null> {
  const cached = getCachedDoc(path);
  if (cached) return cached;
  
  try {
    const snap = await getDoc(doc(db, path));
    if (snap.exists()) {
      const data = snap.data();
      setCachedDoc(path, data);
      return data;
    }
    return null;
  } catch (error) {
    console.error('Fetch error:', error);
    return null;
  }
}

// Batch fetch multiple documents
export async function batchFetchDocs(paths: string[]): Promise<Map<string, DocumentData | null>> {
  const results = new Map<string, DocumentData | null>();
  const toFetch: string[] = [];
  
  // Check cache first
  for (const path of paths) {
    const cached = getCachedDoc(path);
    if (cached) {
      results.set(path, cached);
    } else {
      toFetch.push(path);
    }
  }
  
  // Fetch uncached documents in parallel
  if (toFetch.length > 0) {
    const fetches = await Promise.all(
      toFetch.map(async (path) => {
        try {
          const snap = await getDoc(doc(db, path));
          const data = snap.exists() ? snap.data() : null;
          if (data) setCachedDoc(path, data);
          return { path, data };
        } catch {
          return { path, data: null };
        }
      })
    );
    
    fetches.forEach(({ path, data }) => {
      results.set(path, data);
    });
  }
  
  return results;
}

// ==================== REQUEST DEDUPLICATION ====================
// Prevent duplicate concurrent requests
const pendingRequests = new Map<string, Promise<any>>();

export async function deduplicatedFetch<T>(
  key: string, 
  fn: () => Promise<T>
): Promise<T> {
  const existing = pendingRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  
  const promise = fn().finally(() => {
    pendingRequests.delete(key);
  });
  
  pendingRequests.set(key, promise);
  return promise;
}

// ==================== DEBOUNCED UPDATES ====================
// Debounce rapid updates to the same document
const updateTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingUpdates = new Map<string, DocumentData>();

export function debouncedUpdate(
  ref: DocumentReference,
  data: DocumentData,
  delay = 500
): void {
  const key = ref.path;
  
  // Merge with pending updates
  const existing = pendingUpdates.get(key) || {};
  pendingUpdates.set(key, { ...existing, ...data });
  
  // Clear existing timer
  const existingTimer = updateTimers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  
  // Set new timer
  updateTimers.set(key, setTimeout(async () => {
    const toUpdate = pendingUpdates.get(key);
    pendingUpdates.delete(key);
    updateTimers.delete(key);
    
    if (toUpdate) {
      try {
        await updateDoc(ref, toUpdate);
        invalidateCache(key);
      } catch (error) {
        console.error('Debounced update failed:', error);
      }
    }
  }, delay));
}

// ==================== PAGINATION HELPERS ====================
export interface PaginationResult<T> {
  items: T[];
  hasMore: boolean;
  lastDoc: any;
}

export async function paginatedQuery<T>(
  collectionPath: string,
  constraints: any[],
  pageSize: number,
  _startAfterDoc?: any
): Promise<PaginationResult<T>> {
  const baseQuery = query(
    collection(db, collectionPath),
    ...constraints,
    limit(pageSize + 1)
  );
  
  const snap = await getDocs(baseQuery);
  const docs = snap.docs;
  const hasMore = docs.length > pageSize;
  const items = docs.slice(0, pageSize).map(d => ({ id: d.id, ...d.data() } as T));
  const lastDoc = docs.length > 0 ? docs[Math.min(docs.length - 1, pageSize - 1)] : null;
  
  return { items, hasMore, lastDoc };
}
