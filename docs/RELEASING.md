# Releasing Reef

Reef ships as an arm64 macOS DMG attached to a GitHub Release. There are two build paths.

## Build paths

| Command | Output | Signing |
|---------|--------|---------|
| `npm run dist:mac` | `dist/Reef-<ver>-arm64.dmg` | Unsigned (ad-hoc). For local checks. First launch needs right-click → Open. |
| `npm run release:mac` | `dist/Reef-<ver>-arm64.dmg` | Developer ID signed + Apple notarized. Double-click launch. For distribution. |

`release:mac` requires four secrets to be present in the environment. If `APPLE_IDENTITY`
is unset the build silently falls back to the unsigned path (`afterPack.cjs` re-applies ad-hoc signing).

## One-time setup (per machine)

1. Join the Apple Developer Program (individual is fine).
2. Create a **Developer ID Application** certificate and import it into the login Keychain.
   Find its exact name: `security find-identity -v -p codesigning`
   (looks like `Developer ID Application: Your Name (TEAMID)`).
3. In App Store Connect → Users and Access → Integrations → App Store Connect API,
   create a key. Download the `.p8` **once** (it cannot be re-downloaded). Note the Key ID and Issuer ID.
4. Store secrets **outside the repo**:
   - `~/.private/reef/AuthKey_XXXXXXXXXX.p8`
   - `~/.private/reef/release.env`:
     ```bash
     export APPLE_IDENTITY="Developer ID Application: Your Name (TEAMID)"
     export APPLE_API_KEY="$HOME/.private/reef/AuthKey_XXXXXXXXXX.p8"
     export APPLE_API_KEY_ID="XXXXXXXXXX"
     export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
     ```

## Release procedure

1. Bump `package.json` version and add a `RELEASE_NOTES.md` / `RELEASE_NOTES.ja.md` section
   → open a PR → squash-merge to `main` (existing flow).
2. `git checkout main && git pull && git tag -a vX.Y.Z -m "Reef vX.Y.Z — <summary>" && git push origin vX.Y.Z`
3. `source ~/.private/reef/release.env && npm run release:mac`
   (Notarization runs on Apple's servers — a few minutes, up to ~10 on first submission.)
4. `gh release create vX.Y.Z dist/Reef-X.Y.Z-arm64.dmg --title "..." --notes-file <notes> --latest`

## Verification checklist (after `release:mac`)

```
1. codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Reef.app"
   → valid on disk / satisfies its Designated Requirement
2. codesign -dvvv "dist/mac-arm64/Reef.app"
   → Authority=Developer ID Application: ... , TeamIdentifier=<TEAMID>
3. spctl --assess --type execute --verbose "dist/mac-arm64/Reef.app"
   → accepted / source=Notarized Developer ID
4. stapler validate "dist/Reef-X.Y.Z-arm64.dmg"
   → The validate action worked!
5. On a clean Mac (or after: xattr -w com.apple.quarantine "..." on a copy),
   mount the DMG → drag to Applications → double-click → launches with no warning.
```

## Troubleshooting

- Notarization rejected: `xcrun notarytool log <submission-id> --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER"`
- If the log flags an unsigned nested binary, confirm the entitlements in `build/entitlements.mac.plist`
  (especially `com.apple.security.cs.disable-library-validation`) and that hardened runtime is on.
- `APPLE_IDENTITY` must match the Keychain certificate name exactly (including the `(TEAMID)` suffix).
