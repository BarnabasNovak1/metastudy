// In-app navigation guard.
//
// NOTE: This is currently a no-op. React Router's useBlocker only works inside a
// data router (createBrowserRouter/RouterProvider), and this app uses the plain
// <BrowserRouter>. The previous implementation tried require("react-router-dom")
// inside a hook - require() doesn't exist in the browser ESM bundle, so it always
// silently failed.
//
// Callers already guard navigation themselves via beforeunload + capture-phase
// anchor click interception. If the app migrates to a data router, reimplement
// this with useBlocker(when) and call onBlock(blocker.proceed, blocker.reset)
// when blocker.state === "blocked".
export function useNavGuard(
  _when: boolean,
  _onBlock: (proceed: () => void, reset: () => void) => void
) {
  // no-op: see note above
}
