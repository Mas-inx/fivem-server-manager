/** Shared quit state, so the close-to-tray handler never blocks an intentional quit. */
export const lifecycle = { quitting: false }
