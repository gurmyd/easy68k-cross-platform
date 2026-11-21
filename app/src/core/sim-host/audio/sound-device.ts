// Sound of the simulator (ARCHITECTURE.md 3.7): the standard and the DirectX player of
// trap15-b §11 over an AudioBackend.
//
// STUB written by W1 (wave 0). SH5 replaces the body; the class name, the constructor signature and
// the exported names are contract (section 8, "Stubs"). This stub plays nothing and returns the
// engine's defaults (undefined: D0 is left as it is).
//
// Owner: W1 > SH5.

import type { Bytes, SoundDeviceApi, SoundDeviceDeps } from '../../../contracts';

export type { SoundDeviceDeps } from '../../../contracts';

export class SoundDevice implements SoundDeviceApi {
  readonly busyUntil: number = 0;

  constructor(private readonly deps: SoundDeviceDeps) {}

  playSound(_fileName: Bytes): number | undefined {
    return undefined;
  }
  loadSound(_fileName: Bytes, _waveIndex: number): void {}
  playSoundMem(_waveIndex: number): number | undefined {
    return undefined;
  }
  controlSound(_control: number, _waveIndex: number): number | undefined {
    return undefined;
  }
  playSoundDX(_fileName: Bytes): number | undefined {
    return undefined;
  }
  loadSoundDX(_fileName: Bytes, _waveIndex: number): number | undefined {
    return undefined;
  }
  playSoundMemDX(_waveIndex: number): number | undefined {
    return undefined;
  }
  controlSoundDX(_control: number, _waveIndex: number): number | undefined {
    return undefined;
  }
  resetSounds(): void {}
  resetToStartup(): void {}
}
