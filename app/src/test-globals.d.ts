/* React's act() gate: DOM tests set it around each mount; the browser never
   defines it. Declared here so tests assign it without casting globalThis. */
declare var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
