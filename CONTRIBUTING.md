# Contributing to multiemu

Thanks for wanting to help! English or Spanish is fine everywhere.

- **Bugs and ideas:** open an issue with one of the [templates](https://github.com/SKYACDX/multiemu/issues/new/choose). Never attach or link ROMs, BIOS or firmware.
- **Code:** fork, make a branch, and open a pull request against `master`. Keep it to one change, and say how you tested it (which phone, which system). [README.md](README.md#build-from-source) explains how to build; `./gradlew assembleDev` gives a build that installs next to the published app.
- **Emulator cores:** changes to melonDS, mGBA or Azahar go in `patches/` as patch files, not in `third_party/` (which isn't versioned). Changes to the Game Boy core in `core/gb` should come with a test in `core/gb/tests`.
- **Style:** match the code around your change. Comments explain *why*, not what.
- **License:** contributions are accepted under the project's license, [GPL-3.0-or-later](LICENSE).
