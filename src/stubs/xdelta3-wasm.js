// @1sat/actions lazily imports xdelta3-wasm for ORDFS delta patches, which 1satsocial never uses.
// Its WASM asset doesn't resolve under Turbopack, so alias it to this stub.
export function init() {
  throw new Error("xdelta3-wasm is not bundled in 1satsocial");
}
const xdelta3 = { init };
export default xdelta3;
