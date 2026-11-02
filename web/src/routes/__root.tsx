import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => <Outlet />,
  // Last safety net: if anything throws while rendering, show this instead of a blank page.
  errorComponent: () => (
    <main>
      <h1>Bill Splitter</h1>
      <p className="error">Something went wrong. Please reload the page.</p>
    </main>
  ),
})
