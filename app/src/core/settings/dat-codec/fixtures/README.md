# Fixtures of `core/settings/dat-codec` (E4)

Bytes, never converted (`.gitattributes`: `/app/src/**/fixtures/** -text`).

| File                   | What it is                                                                                                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shipped-settings.dat` | `settings.dat` of the official EASy68K v5.16.1 distribution, copied byte for byte from `reference/official-extracted/settings.dat` (the installer `SetupEASy68K.exe`, extracted). 1096 bytes, SHA-256 `01083c5e9ea0db11f036cf470751502a8cfab421cba73b3407ac4c7f3f2c3c90`. Its header says v5.15.04. |
| `shipped-sim68K.dat`   | `sim68K.dat` of the same distribution, from `reference/official-extracted/sim68K.dat`. 761 bytes, SHA-256 `7b89dfb9f62eef5d595a6096a5cea18ec7ec1bd3180d6d3e965965742041fa8d`. Lines 2, 3 and 34 begin with a NUL byte.                                                                              |
| `shipped-template.NEW` | `template.NEW` of the same distribution, from `reference/official-extracted/template.NEW` (identical in the portable zip). 420 bytes, SHA-256 `3bc022b61192b217c1b4e20403c0b6008dae7b752a57846b6887d8cec8a2067e`.                                                                                   |
| `written-settings.dat` | What `writeSettingsDat` writes for the settings `CHANGED_EDITOR` of `settings-dat.test.ts` (every setting away from its default). Checked by hand line by line against editor-ui §11.4 and `optionsS.cpp:134-221`.                                                                                  |
| `written-sim68K.dat`   | What `writeSim68KDat` writes for `CHANGED_SIM` of `sim68k-dat.test.ts`. Checked by hand against sim-ui §14.3 and `SIM68Ku.cpp:1430-1485`.                                                                                                                                                           |

The three shipped files are part of the EASy68K distribution, whose readme places all of its
files under the GNU General Public License; they are redistributed here under that licence.
