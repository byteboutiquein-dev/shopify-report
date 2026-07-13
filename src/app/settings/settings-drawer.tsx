"use client";

import { useState, type ReactNode } from "react";
import { Settings, X } from "lucide-react";

type SettingsDrawerProps = {
  children: ReactNode;
  isReady: boolean;
};

export function SettingsDrawer({ children, isReady }: SettingsDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="settings-drawer">
      <button className="drawer-open-button" type="button" onClick={() => setIsOpen(true)}>
        <Settings aria-hidden="true" size={18} />
        <span>Settings</span>
        <span className={isReady ? "badge ready" : "badge missing"}>{isReady ? "Ready" : "Needs config"}</span>
      </button>

      {isOpen ? (
        <>
          <button className="drawer-scrim" type="button" aria-label="Close settings" onClick={() => setIsOpen(false)} />
          <aside className="settings-drawer-panel" aria-label="Settings and logs">
            <div className="drawer-header">
              <div>
                <p className="eyebrow">Controls</p>
                <h2>Settings & Logs</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Close settings" onClick={() => setIsOpen(false)}>
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            {children}
          </aside>
        </>
      ) : null}
    </div>
  );
}
