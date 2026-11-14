import type { RouteObject } from 'react-router';
import Console from './pages/Console';
import PrintSpecimens from './pages/PrintSpecimens';

export const routes: RouteObject[] = [
  { path: '/', element: <Console /> },
  { path: '/print', element: <PrintSpecimens /> },
  { path: '*', element: <Console /> },
];
