import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { LandingPage } from './components/LandingPage';

const StudioWorkspace = lazy(() =>
  import('./components/StudioWorkspace').then((m) => ({ default: m.StudioWorkspace })),
);

interface ErrorBoundaryState {
  error: Error | null;
}

class StudioErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#090b0e] text-[#f2f2ef] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#101318] border border-white/[0.12] rounded-xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 text-[#e53935]">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h1 className="text-base font-semibold text-zinc-100">
                OpenTarmac encountered a rendering error
              </h1>
            </div>
            <p className="text-xs font-mono text-zinc-400 bg-[#0b0d10] border border-white/[0.08] rounded-md p-3 break-words">
              {this.state.error.message}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  window.location.hash = '';
                  window.location.reload();
                }}
                className="studio-press px-3.5 py-2 rounded-md bg-[#e53935] hover:bg-[#ef4444] text-white text-xs font-medium"
              >
                Reload app
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [inStudio, setInStudio] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.location.hash === '#studio' : false,
  );
  const [launchQuery, setLaunchQuery] = useState<string | undefined>(undefined);

  useEffect(() => {
    const syncHash = () => {
      setInStudio(window.location.hash === '#studio');
    };
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  const handleLaunchStudio = useCallback((initialSearchQuery?: string) => {
    setLaunchQuery(initialSearchQuery);
    if (window.location.hash !== '#studio') {
      window.location.hash = '#studio';
    }
    setInStudio(true);
  }, []);

  const handleBackHome = useCallback(() => {
    if (window.location.hash) {
      window.location.hash = '';
    }
    setInStudio(false);
  }, []);

  if (!inStudio) {
    return (
      <StudioErrorBoundary>
        <LandingPage onLaunchStudio={handleLaunchStudio} />
      </StudioErrorBoundary>
    );
  }

  return (
    <StudioErrorBoundary>
      <Suspense
        fallback={
          <div className="h-screen w-screen bg-[#0b0d10] text-zinc-300 flex items-center justify-center gap-2 text-xs">
            <Loader2 className="w-4 h-4 animate-spin text-[#e53935]" />
            <span>Loading OpenTarmac Studio...</span>
          </div>
        }
      >
        <StudioWorkspace initialQuery={launchQuery} onBackHome={handleBackHome} />
      </Suspense>
    </StudioErrorBoundary>
  );
}
