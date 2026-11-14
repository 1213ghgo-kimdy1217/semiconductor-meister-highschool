import type { RouteObject } from 'react-router';
import Console from './pages/Console';
import PrintSpecimens from './pages/PrintSpecimens';
import TeamRecords from './pages/TeamRecords';

export const routes: RouteObject[] = [
  { path: '/', element: <Console /> },
  { path: '/print', element: <PrintSpecimens /> },
  { path: '/team', element: <TeamRecords /> },
  { path: '*', element: <Console /> },
];

