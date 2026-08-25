import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastProvider } from './components/Toaster';
import './index.css';

/**
 * Follows the operating system's light/dark setting, and keeps following it.
 *
 * No toggle: this is a tool one person runs on their own machine, and a
 * preference that has to be set twice is worse than one that is never asked
 * about.
 */
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches);
applyTheme();
dark.addEventListener('change', applyTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
