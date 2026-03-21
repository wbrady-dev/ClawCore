import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { Menu, Section, Separator, t, useInterval, type MenuItem } from "../components.js";
import { getApiPort, getModelPort, type ServiceStatus } from "../../platform.js";
import { readServiceLogTail } from "../../service-logs.js";
import { checkAutoStartupAsync, isPortReachable } from "../../runtime-status.js";
import { subscribeTasks } from "../../tasks.js";

// Module-level cache
let cachedServicesSvc: ServiceStatus = { models: { running: false }, clawcore: { running: false } };
let cachedServicesAutoStart = false;

export function ServicesScreen({
  onBack,
  onAction,
}: {
  onBack: () => void;
  onAction: (action: string) => void;
}) {
  const [tick, setTick] = useState(0);
  const [autoStart, setAutoStart] = useState(cachedServicesAutoStart);
  const [services, setServices] = useState<ServiceStatus>(cachedServicesSvc);

  useInterval(() => setTick((value) => value + 1), 3000);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [modelsUp, clawcoreUp, autoStartState] = await Promise.all([
        isPortReachable(getModelPort()),
        isPortReachable(getApiPort()),
        checkAutoStartupAsync(),
      ]);

      if (cancelled) return;
      const serviceState: ServiceStatus = {
        models: { running: modelsUp },
        clawcore: { running: clawcoreUp },
      };
      cachedServicesSvc = serviceState;
      cachedServicesAutoStart = autoStartState;
      setServices(serviceState);
      setAutoStart(autoStartState);
    })();

    return () => { cancelled = true; };
  }, [tick]);

  useEffect(() => subscribeTasks(() => {
    setTick((value) => value + 1);
  }), []);

  const gameModeOn = !services.models.running && !services.clawcore.running;
  const modelLogLines = readServiceLogTail("models", 3);
  const apiLogLines = readServiceLogTail("clawcore", 3);
  const anyRunning = services.models.running || services.clawcore.running;

  const items: MenuItem[] = [];
  if (anyRunning) {
    items.push({ label: "Restart services", value: "services-restart" });
    items.push({ label: "Stop services", value: "services-stop" });
    items.push({ label: "Game mode on", value: "services-game-on", description: "Stop models and free VRAM" });
  } else {
    items.push({ label: "Start services", value: "services-start" });
    items.push({ label: "Game mode off", value: "services-game-off", description: "Start models again" });
  }

  items.push({
    label: autoStart ? "Disable auto-start" : "Enable auto-start",
    value: autoStart ? "services-auto-off" : "services-auto-on",
  });
  items.push({ label: "Back", value: "__back__", color: t.dim });

  return (
    <Box flexDirection="column">
      <Section title="Services" />
      <Text>{"  " + (services.models.running ? t.ok("●") : t.err("○")) + ` Models (port ${getModelPort()})`}</Text>
      <Text>{"  " + (services.clawcore.running ? t.ok("●") : t.err("○")) + ` ClawCore API (port ${getApiPort()})`}</Text>
      <Text>{"  " + t.dim("Auto-start: ") + (autoStart ? t.ok("enabled") : t.dim("disabled"))}</Text>
      <Text>{"  " + t.dim("Game mode: ") + (gameModeOn ? t.warn("on") : t.dim("off"))}</Text>

      <Section title="Recent Model Logs" />
      {modelLogLines.length > 0 ? modelLogLines.map((line, index) => (
        <Text key={`models:${index}`}>{"  " + t.dim(line)}</Text>
      )) : (
        <Text>{"  " + t.dim("No model log output yet")}</Text>
      )}

      <Section title="Recent API Logs" />
      {apiLogLines.length > 0 ? apiLogLines.map((line, index) => (
        <Text key={`api:${index}`}>{"  " + t.dim(line)}</Text>
      )) : (
        <Text>{"  " + t.dim("No API log output yet")}</Text>
      )}

      <Separator />
      <Menu
        items={items}
        onSelect={(value) => {
          if (value === "__back__") onBack();
          else onAction(value);
        }}
      />
    </Box>
  );
}
