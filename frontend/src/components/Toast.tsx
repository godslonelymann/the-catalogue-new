import { createContext, use, useCallback, useRef, useState, type ReactNode } from "react";

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((text: string) => {
    clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(""), 3200);
  }, []);

  return (
    <ToastContext value={show}>
      {children}
      <div className="toast" role="status" aria-live="polite">
        {message}
      </div>
    </ToastContext>
  );
}

export const useToast = () => use(ToastContext);
