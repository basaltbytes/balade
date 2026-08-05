/* The renderer's only door onto the CLI package: the resolved-payload contract,
   types only. Nothing in `app/` may import CLI runtime code. */
export type * from "../../src/contract/types";
