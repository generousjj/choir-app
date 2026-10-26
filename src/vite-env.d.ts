/// <reference types="vite/client" />
declare module '*.mjs' {
  const factory: (opts: Record<string, unknown>) => Promise<unknown>;
  export default factory;
}
