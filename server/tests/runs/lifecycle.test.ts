import { describe, expect, it } from "vitest";
import {
  classifyRunCloseStatus,
  resolveAcpStageTimeoutMs,
  resolveActiveInactivityTimeoutMs,
  resolveChatRunArtifactQuietPeriodMs,
  resolveChatRunInactivityTimeoutMs,
  resolveChatRunShutdownGraceMs
} from "../../src/runs/lifecycle.js";

describe("run lifecycle timeout resolution", () => {
  it("uses Open Design-style defaults for chat run watchdogs", () => {
    expect(resolveChatRunInactivityTimeoutMs({})).toBe(10 * 60 * 1000);
    expect(resolveChatRunArtifactQuietPeriodMs({})).toBe(60 * 1000);
    expect(resolveChatRunShutdownGraceMs({})).toBe(3000);
  });

  it("reads configured positive timeout values from the environment", () => {
    expect(
      resolveChatRunInactivityTimeoutMs({
        AGENT_NEXUS_CHAT_RUN_INACTIVITY_TIMEOUT_MS: "1200"
      })
    ).toBe(1200);
    expect(
      resolveChatRunArtifactQuietPeriodMs({
        AGENT_NEXUS_CHAT_RUN_ARTIFACT_QUIET_PERIOD_MS: "250"
      })
    ).toBe(250);
    expect(
      resolveChatRunShutdownGraceMs({
        AGENT_NEXUS_CHAT_RUN_SHUTDOWN_GRACE_MS: "50"
      })
    ).toBe(50);
    expect(
      resolveAcpStageTimeoutMs({
        AGENT_NEXUS_ACP_STAGE_TIMEOUT_MS: "9000"
      })
    ).toBe(9000);
  });

  it("treats non-positive inactivity and ACP stage timeouts as disabled", () => {
    expect(
      resolveChatRunInactivityTimeoutMs({
        AGENT_NEXUS_CHAT_RUN_INACTIVITY_TIMEOUT_MS: "0"
      })
    ).toBeNull();
    expect(
      resolveChatRunInactivityTimeoutMs({
        AGENT_NEXUS_CHAT_RUN_INACTIVITY_TIMEOUT_MS: "-1"
      })
    ).toBeNull();
    expect(resolveAcpStageTimeoutMs({})).toBeNull();
    expect(
      resolveAcpStageTimeoutMs({
        AGENT_NEXUS_ACP_STAGE_TIMEOUT_MS: "0"
      })
    ).toBeNull();
  });

  it("falls back to defaults for invalid chat timeout values", () => {
    expect(
      resolveChatRunInactivityTimeoutMs({
        AGENT_NEXUS_CHAT_RUN_INACTIVITY_TIMEOUT_MS: "not-a-number"
      })
    ).toBe(10 * 60 * 1000);
    expect(
      resolveChatRunArtifactQuietPeriodMs({
        AGENT_NEXUS_CHAT_RUN_ARTIFACT_QUIET_PERIOD_MS: "NaN"
      })
    ).toBe(60 * 1000);
    expect(
      resolveChatRunShutdownGraceMs({
        AGENT_NEXUS_CHAT_RUN_SHUTDOWN_GRACE_MS: "nope"
      })
    ).toBe(3000);
  });
});

describe("resolveActiveInactivityTimeoutMs", () => {
  it("uses the artifact quiet period after an artifact has been registered", () => {
    expect(
      resolveActiveInactivityTimeoutMs({
        inactivityTimeoutMs: 600000,
        artifactQuietPeriodMs: 60000,
        artifactRegistered: true
      })
    ).toBe(60000);
  });

  it("keeps the normal inactivity timeout until an artifact is registered", () => {
    expect(
      resolveActiveInactivityTimeoutMs({
        inactivityTimeoutMs: 600000,
        artifactQuietPeriodMs: 60000,
        artifactRegistered: false
      })
    ).toBe(600000);
  });
});

describe("classifyRunCloseStatus", () => {
  it("treats cancellation as canceled even if the process exits cleanly", () => {
    expect(
      classifyRunCloseStatus({
        cancelRequested: true,
        code: 0,
        signal: null,
        acpCleanCompletion: false,
        artifactQuietShutdownRequested: false,
        artifactProducedThisRun: false,
        turnCompletedCleanly: false
      })
    ).toBe("canceled");
  });

  it("treats exit code 0 as success", () => {
    expect(
      classifyRunCloseStatus({
        cancelRequested: false,
        code: 0,
        signal: null,
        acpCleanCompletion: false,
        artifactQuietShutdownRequested: false,
        artifactProducedThisRun: false,
        turnCompletedCleanly: false,
        parserTerminalStatus: null
      })
    ).toBe("succeeded");
  });

  it("lets a parser-reported terminal failure override a clean process exit", () => {
    expect(
      classifyRunCloseStatus({
        cancelRequested: false,
        code: 0,
        signal: null,
        acpCleanCompletion: false,
        artifactQuietShutdownRequested: false,
        artifactProducedThisRun: false,
        turnCompletedCleanly: false,
        parserTerminalStatus: "failed"
      })
    ).toBe("failed");
  });

  it("treats ACP clean completion followed by SIGTERM as success", () => {
    expect(
      classifyRunCloseStatus({
        cancelRequested: false,
        code: null,
        signal: "SIGTERM",
        acpCleanCompletion: true,
        artifactQuietShutdownRequested: false,
        artifactProducedThisRun: false,
        turnCompletedCleanly: false
      })
    ).toBe("succeeded");
  });

  it("treats artifact quiet shutdown as success", () => {
    expect(
      classifyRunCloseStatus({
        cancelRequested: false,
        code: null,
        signal: "SIGTERM",
        acpCleanCompletion: false,
        artifactQuietShutdownRequested: true,
        artifactProducedThisRun: true,
        turnCompletedCleanly: false
      })
    ).toBe("succeeded");
  });

  it("allows a non-zero exit after artifact output to succeed", () => {
    expect(
      classifyRunCloseStatus({
        cancelRequested: false,
        code: 1,
        signal: null,
        acpCleanCompletion: false,
        artifactQuietShutdownRequested: false,
        artifactProducedThisRun: true,
        turnCompletedCleanly: false
      })
    ).toBe("succeeded");
  });

  it("treats clean terminal turn completion as success", () => {
    expect(
      classifyRunCloseStatus({
        cancelRequested: false,
        code: null,
        signal: "SIGTERM",
        acpCleanCompletion: false,
        artifactQuietShutdownRequested: false,
        artifactProducedThisRun: false,
        turnCompletedCleanly: true
      })
    ).toBe("succeeded");
  });

  it("classifies other exits as failed", () => {
    expect(
      classifyRunCloseStatus({
        cancelRequested: false,
        code: 2,
        signal: null,
        acpCleanCompletion: false,
        artifactQuietShutdownRequested: false,
        artifactProducedThisRun: false,
        turnCompletedCleanly: false
      })
    ).toBe("failed");
  });
});
