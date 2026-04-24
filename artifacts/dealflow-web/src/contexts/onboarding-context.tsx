import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

const STORAGE_KEY = "dealflow.onboarding.v1";

type State = {
  welcomeSeen: boolean;
  completedSteps: string[];
};

type Ctx = State & {
  openWelcome: () => void;
  closeWelcome: () => void;
  isWelcomeOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  isHelpOpen: boolean;
  markStep: (key: string) => void;
  resetOnboarding: () => void;
};

const OnboardingCtx = createContext<Ctx | null>(null);

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { welcomeSeen: false, completedSteps: [] };
    const parsed = JSON.parse(raw);
    return {
      welcomeSeen: Boolean(parsed.welcomeSeen),
      completedSteps: Array.isArray(parsed.completedSteps) ? parsed.completedSteps : [],
    };
  } catch {
    return { welcomeSeen: false, completedSteps: [] };
  }
}

function saveState(s: State) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => loadState());
  const [isWelcomeOpen, setWelcomeOpen] = useState(false);
  const [isHelpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (!state.welcomeSeen) setWelcomeOpen(true);
  }, [state.welcomeSeen]);

  const openWelcome = useCallback(() => setWelcomeOpen(true), []);
  const closeWelcome = useCallback(() => {
    setWelcomeOpen(false);
    setState(s => (s.welcomeSeen ? s : { ...s, welcomeSeen: true }));
  }, []);

  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  const markStep = useCallback((key: string) => {
    setState(s => (s.completedSteps.includes(key) ? s : { ...s, completedSteps: [...s.completedSteps, key] }));
  }, []);

  const resetOnboarding = useCallback(() => {
    setState({ welcomeSeen: false, completedSteps: [] });
    setWelcomeOpen(true);
  }, []);

  return (
    <OnboardingCtx.Provider
      value={{
        welcomeSeen: state.welcomeSeen,
        completedSteps: state.completedSteps,
        openWelcome,
        closeWelcome,
        isWelcomeOpen,
        openHelp,
        closeHelp,
        isHelpOpen,
        markStep,
        resetOnboarding,
      }}
    >
      {children}
    </OnboardingCtx.Provider>
  );
}

export function useOnboarding() {
  const v = useContext(OnboardingCtx);
  if (!v) throw new Error("useOnboarding must be used within OnboardingProvider");
  return v;
}
