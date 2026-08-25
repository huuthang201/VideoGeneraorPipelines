/**
 * Font imports resolve to a string - a `data:` URI, because of the
 * `asset/inline` rule the bundler adds for .ttf. Declared here because
 * TypeScript has no idea what webpack does with a binary import.
 */
declare module '*.ttf' {
  const src: string;
  export default src;
}
