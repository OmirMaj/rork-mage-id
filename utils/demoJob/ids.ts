// utils/demoJob/ids.ts — stable ids for the owner's Demo Job (pure).
//
// Every record the Demo Job builder writes has an id worked out from the demo
// project's id and a short key ("co:3", "task:l4-drywall"). That is what makes
// creation resumable and removal complete on ANY device: nothing has to be
// remembered, because the same project id always gives the same child ids.
//
// The ids are UUID-shaped (the server's id columns are uuid) and are NOT
// random: two hashes of "namespace|key" fill the 128 bits. They are not secret
// and nothing relies on them being unguessable.

/** One 53-bit string hash (cyrb53), returned as two 32-bit halves. */
function hash64(text: string, seed: number): [number, number] {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1 >>> 0, h2 >>> 0];
}

const hex8 = (n: number): string => n.toString(16).padStart(8, '0');

/** A UUID-shaped id that is always the same for the same namespace and key. */
export function demoId(namespace: string, key: string): string {
  const text = `${namespace}|${key}`;
  const [a, b] = hash64(text, 0x9e3779b1);
  const [c, d] = hash64(text, 0x85ebca6b);
  const h = hex8(a) + hex8(b) + hex8(c) + hex8(d);
  // Version nibble 4 and variant nibble 8, so every UUID check accepts it.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * The demo project's own id. One per account and per "generation": the builder
 * raises the generation each time a demo is removed, so a job made again after
 * removal never reuses the id of the one that was deleted.
 */
export function demoProjectId(userId: string, generation: number): string {
  return demoId('mageid-demo-job', `${userId}|${generation}`);
}

/** An id-maker bound to one demo project. */
export function childIds(projectId: string): (key: string) => string {
  return (key: string) => demoId(projectId, key);
}
