/**
 * Print IPC channel owned by the main-renderer preload. A separate file
 * keeps this preload free of shared chunks, which sandboxed preloads
 * cannot require.
 */

export const PRINT_TO_PDF_CHANNEL = 'dsh-desktop:print-to-pdf'
