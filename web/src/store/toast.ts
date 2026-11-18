import { create } from "zustand";

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: "info" | "success" | "warning" | "error";
}

interface ToastStore {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

let seq = 0;
export const useToast = create<ToastStore>((set, get) => ({
  toasts: [],
  push(t) {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    window.setTimeout(() => get().dismiss(id), 4200);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

export const toast = (title: string, body?: string, tone: Toast["tone"] = "info") => useToast.getState().push({ title, body, tone });
