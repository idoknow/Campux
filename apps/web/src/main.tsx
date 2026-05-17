import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/features/theme/theme";
import "./styles.css";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
      <Toaster />
    </ThemeProvider>
  </StrictMode>,
);
