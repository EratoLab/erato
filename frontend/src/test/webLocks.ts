/** Installs a Web Locks stand-in on `navigator` where every name in `held`
 * belongs to another context. Returns a restore function. */
export function fakeWebLocks(held: ReadonlySet<string>): () => void {
  const locks = {
    request: async (
      name: string,
      _options: LockOptions,
      callback: LockGrantedCallback,
    ) => callback(held.has(name) ? null : { name, mode: "exclusive" }),
  };
  Object.defineProperty(globalThis.navigator, "locks", {
    configurable: true,
    value: locks,
  });
  return () => {
    Reflect.deleteProperty(globalThis.navigator, "locks");
  };
}
