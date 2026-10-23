// src/renderer/src/App.tsx
import { Workspace } from './pages/Workspace';
import { ToastProvider } from './components/ui/Toast';

export default function App() {
  return (
    <ToastProvider>
      <Workspace />
    </ToastProvider>
  );
}
