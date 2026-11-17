import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/Toast';
import { HealthProvider } from './hooks/useHealth';
import { RecorderProvider } from './hooks/useRecorder';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <HealthProvider>
          <RecorderProvider>
            <App />
          </RecorderProvider>
        </HealthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
