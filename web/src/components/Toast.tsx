import { useEffect } from "react";

export interface ToastProps {
  message: string;
  type?: "success" | "error" | "info";
  duration?: number;
  onClose: () => void;
}

export function Toast({
  message,
  type = "info",
  duration = 3000,
  onClose,
}: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const bgColor =
    type === "success"
      ? "bg-green-600"
      : type === "error"
        ? "bg-red-600"
        : "bg-blue-600";

  return (
    <div
      className={`fixed bottom-4 right-4 px-4 py-3 text-white rounded shadow-lg ${bgColor} z-50 max-w-md`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
