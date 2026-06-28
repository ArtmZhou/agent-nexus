type SettingsPanelProps = {
  selectedAgentId: string | null;
};

const localProfileExample = `{
  "agents": [
    {
      "id": "codex-work",
      "name": "Codex Work",
      "baseAgent": "codex",
      "args": ["--profile", "work"],
      "defaultModel": "gpt-5",
      "env": { "CODEX_HOME": "D:/agent-nexus/codex" }
    }
  ]
}`;

export function SettingsPanel({ selectedAgentId }: SettingsPanelProps) {
  return (
    <section className="settings-panel" aria-label="Settings">
      <div>
        <p className="eyebrow">Configuration</p>
        <h2>Settings</h2>
      </div>

      <div className="settings-grid">
        <div>
          <h3>Config paths</h3>
          <p>
            Set <code>AGENT_NEXUS_AGENTS_CONFIG</code> to point at a local profile file. Without it, Agent Nexus reads
            <code> ~/.agent-nexus/agents.local.json</code>.
          </p>
        </div>
        <div>
          <h3>Executable overrides</h3>
          <p>
            Runtime binaries can be pinned with env vars such as <code>CODEX_BIN</code>, <code>CLAUDE_BIN</code>,
            <code> OPENCODE_BIN</code>, <code>GEMINI_BIN</code>, and <code>CURSOR_AGENT_BIN</code>.
          </p>
        </div>
        <div className="profile-example">
          <h3>Local profile example</h3>
          <pre>{localProfileExample}</pre>
        </div>
        <div>
          <h3>Selected runtime</h3>
          <p>{selectedAgentId ?? "No agent selected"}</p>
        </div>
      </div>
    </section>
  );
}
