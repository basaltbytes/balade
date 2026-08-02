import { createContext, useContext, type ReactNode } from "react";
import type { Payload } from "../contract";

const PayloadContext = createContext<Payload | null>(null);

export function PayloadProvider({ value, children }: { value: Payload; children: ReactNode }) {
  return <PayloadContext.Provider value={value}>{children}</PayloadContext.Provider>;
}

export function usePayload(): Payload {
  const payload = useContext(PayloadContext);
  if (!payload) throw new Error("usePayload outside a PayloadProvider");
  return payload;
}
