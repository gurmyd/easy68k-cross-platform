// The texts of the reload offer (ARCHITECTURE-PLUS P3.3.10), exactly as the document gives them.
// Owner: N8.

/** The toast for an open, unmodified document whose file was changed outside this window. */
export const changedOutsideText = (name: string): string => `"${name}" was changed outside this window.`;

/** The toast's action: reloads the document (DocumentService.reload). */
export const RELOAD_ACTION = 'Reload';
