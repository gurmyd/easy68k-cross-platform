// The hardware model (ARCHITECTURE.md 3.3.3): the thin layer between the engine's hardware form and
// the Hardware panel.
//
// STUB written by W1 (wave 0). SH7 replaces the body; the class name, the constructor signature and
// the exported names are contract (section 8, "Stubs"). This stub runs no timer, posts nothing, and
// builds a view from the engine's controls with every displayed byte zero.
//
// Owner: W1 > SH7.

import type {
  HardwareActions,
  HardwareDeps,
  HardwareModelApi,
  HardwareView,
  HwDevice,
  MapKind,
  MapRow,
  SimEngine,
} from '../../../contracts';

export type { HardwareActions, HardwareDeps, HardwareView } from '../../../contracts';

export class HardwareModel implements HardwareModelApi {
  readonly actions: HardwareActions = {
    clickSwitch(_bit: number): void {},
    pressButton(_bit: number): void {},
    releaseButton(_bit: number): void {},
    requestIrq(_level: number): void {},
    reset(): void {},
    setAutoChecked(_level: number, _on: boolean): void {},
    selectLevel(_level: number): void {},
    setAutoInterval(_ms: number): void {},
    setAddress(_device: HwDevice, _address: number, _commit: boolean): void {},
    setMap(_kind: MapKind, _row: Partial<MapRow>): void {},
    setVisible(_visible: boolean): void {},
  };

  constructor(private readonly deps: HardwareDeps) {}

  view(engine: SimEngine): HardwareView {
    return {
      controls: engine.hardware(),
      seg7Bytes: new Uint8Array(8),
      ledByte: 0,
      buttonsEnabled: true,
      autoLabel: 'Automatic',
      addressConflict: { seg7: false, led: false, sw: false, pb: false },
    };
  }
  subscribe(_listener: () => void): () => void {
    return () => {};
  }
  resetToStartup(): void {}

  /* HostHardware */
  hardwareUpdate(): void {}
  hardwareState(_hardwareEnabled: boolean, _autoIRQ: boolean): void {}
  hardwareTimer(_level: number, _enabled: boolean, _intervalMs: number): void {}
  hardwareShow(): void {}
  hardwareControls(): void {}
}
