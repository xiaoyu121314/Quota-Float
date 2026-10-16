import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DesignPlayground } from "./components/DesignPlayground";
import { SettingsPanel } from "./components/SettingsPanel";
import { ContextMenuWindow } from "./components/ContextMenuWindow";
import "./styles.css";

const search = new URLSearchParams(window.location.search);
const showDesigner = search.has("designer") || search.has("design");
const showSettings = search.has("settings");
const showContextMenu = search.has("contextMenu");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{showContextMenu ? <ContextMenuWindow /> : showDesigner ? <DesignPlayground /> : showSettings ? <SettingsPanel /> : <App />}</React.StrictMode>,
);
