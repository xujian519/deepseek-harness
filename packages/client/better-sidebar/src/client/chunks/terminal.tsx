/**
 * Lazy chunk entry: the interactive terminal (xterm + fit addon). Built as
 * `lib/client-terminal.js` and registered under
 * `dsh-better-sidebar/terminal` — fetched only when a terminal tab is first
 * opened (see chunk-loader.ts and the chunk bundles in tsdown.config.ts).
 * Never import this module from the core bundle: it pulls xterm (and its
 * stylesheet) into the startup path.
 */
export { TerminalView } from '../TerminalView.tsx'
