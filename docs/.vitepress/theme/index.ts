import DefaultTheme from "vitepress/theme";
import Mermaid from "./Mermaid.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("Mermaid", Mermaid);
  },
};
