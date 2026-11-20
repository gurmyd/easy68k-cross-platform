// Placeholder entry point written by W0 (scaffolding). W3 owns this file and
// replaces it with the real start-up (ARCHITECTURE.md 9.1, section 8).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('index.html has no #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
