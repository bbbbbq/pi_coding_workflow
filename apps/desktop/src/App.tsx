import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OperationsDashboard } from "./components/OperationsDashboard";
import type { SupportedLanguage } from "./i18n";
import { WorkflowEditor } from "./workflow/WorkflowEditor";
import "./App.css";

type AppView = "builder" | "runs";

function App() {
  const { t, i18n } = useTranslation();
  const [activeView, setActiveView] = useState<AppView>("builder");
  const currentLanguage: SupportedLanguage = i18n.resolvedLanguage?.startsWith("zh")
    ? "zh-CN"
    : "en";

  function changeLanguage(language: SupportedLanguage) {
    void i18n.changeLanguage(language);
  }

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand-mark" aria-label="Pi Workflow"><span>π</span></div>

        <nav className="rail-nav" aria-label={t("navigation.primary")}>
          <button
            className={`rail-button ${activeView === "builder" ? "is-active" : ""}`}
            aria-label={t("navigation.workspace")}
            onClick={() => setActiveView("builder")}
            type="button"
          >
            W
          </button>
          <button
            className={`rail-button ${activeView === "runs" ? "is-active" : ""}`}
            aria-label={t("navigation.runs")}
            onClick={() => setActiveView("runs")}
            type="button"
          >
            R
          </button>
          <button className="rail-button" aria-label={t("navigation.policies")} disabled type="button">P</button>
        </nav>

        <button className="rail-button rail-settings" aria-label={t("navigation.settings")} disabled type="button">S</button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t("header.eyebrow")}</p>
            <h1>Pi Workflow</h1>
          </div>

          <div className="topbar-meta">
            <div className="language-switch" role="group" aria-label={t("language.label")}>
              <button
                className={currentLanguage === "en" ? "is-active" : ""}
                onClick={() => changeLanguage("en")}
                type="button"
                aria-pressed={currentLanguage === "en"}
              >EN</button>
              <button
                className={currentLanguage === "zh-CN" ? "is-active" : ""}
                onClick={() => changeLanguage("zh-CN")}
                type="button"
                aria-pressed={currentLanguage === "zh-CN"}
              >中文</button>
            </div>
            <div className="platforms" aria-label={t("header.supportedPlatforms")}>
              <span>macOS</span><span>Windows</span><span>Linux</span>
            </div>
            <div className="runtime-status"><i /> {t("header.ready")}</div>
          </div>
        </header>

        {activeView === "builder" ? <WorkflowEditor /> : <OperationsDashboard />}
      </main>
    </div>
  );
}

export default App;
