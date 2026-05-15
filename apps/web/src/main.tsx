import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Toaster } from "@/components/ui/sonner";
import "./styles.css";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
    <Toaster />
  </StrictMode>,
);
