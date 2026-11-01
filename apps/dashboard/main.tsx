import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Product } from "./Product";
import "@cloudflare/kumo/styles/standalone";
import "./styles.css";
import "./product.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Product />
  </StrictMode>,
);
