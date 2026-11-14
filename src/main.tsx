import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import { routes } from './routes';

const router = createBrowserRouter(routes);

declare global {
  interface Window {
    __baze?: Record<string, unknown>;
  }
}
window.__baze = { ...window.__baze, routes: router.routes };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
