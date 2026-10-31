import { createBrowserRouter, Link, RouterProvider } from 'react-router';
import { RequireSession } from './components/AppShell';
import { Empty } from './components/ui';
import { ControlDetailPage } from './pages/ControlDetailPage';
import { ControlsPage } from './pages/ControlsPage';
import { HowItWorksPage } from './pages/HowItWorksPage';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { RegisterPage } from './pages/RegisterPage';
import { RetestPage } from './pages/RetestPage';
import { RiskDetailPage } from './pages/RiskDetailPage';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/how-it-works', element: <HowItWorksPage /> },
  {
    element: <RequireSession />,
    children: [
      { path: '/', element: <OverviewPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/risks/:id', element: <RiskDetailPage /> },
      { path: '/controls', element: <ControlsPage /> },
      { path: '/controls/:id', element: <ControlDetailPage /> },
      { path: '/retest', element: <RetestPage /> },
      {
        path: '*',
        element: (
          <div className="page">
            <Empty
              title="Page not found"
              action={
                <Link className="btn" to="/">
                  Back to overview
                </Link>
              }
            >
              The address may be mistyped, or the item may no longer exist.
            </Empty>
          </div>
        ),
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
