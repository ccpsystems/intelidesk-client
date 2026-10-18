#!/usr/bin/env node
// Aplica la marca Intelidesk a un checkout de RustDesk (con submódulos).
//
//   node apply-branding.mjs <ruta-rustdesk>                  parchea el código (se ejecuta en CI tras el checkout)
//   node apply-branding.mjs <ruta-rustdesk> --setup-workflow  prepara .github/workflows/flutter-build.yml del fork
//                                                              para que ejecute este script y compile solo escritorio
//
// La configuración se lee de brand.json (junto a este script) y puede sobrescribirse con variables
// de entorno: INTELIDESK_RENDEZVOUS_SERVER, INTELIDESK_PUBLIC_KEY, INTELIDESK_API_SERVER.
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const [, , target, flag] = process.argv;
// --targets=windows,android,macos,linux elige las plataformas a compilar (por defecto: windows,macos,linux).
// --only=windows equivale a --targets=windows.
const targetsArg = process.argv.find((a) => a.startsWith("--targets="))?.slice(10);
const targets = new Set(
  (process.argv.includes("--only=windows") ? "windows" : (targetsArg ?? "windows,macos,linux")).split(",").map((t) => t.trim()),
);
if (!target) {
  console.error("Uso: node apply-branding.mjs <ruta-rustdesk> [--setup-workflow]");
  process.exit(1);
}
const root = resolve(target);
const brand = JSON.parse(readFileSync(resolve(here, "brand.json"), "utf8"));
brand.rendezvousServer = process.env.INTELIDESK_RENDEZVOUS_SERVER || brand.rendezvousServer;
brand.publicKey = process.env.INTELIDESK_PUBLIC_KEY || brand.publicKey;
brand.apiServer = process.env.INTELIDESK_API_SERVER || brand.apiServer;

let failures = 0;

// Reemplaza en un archivo y falla si el patrón no aparece (para detectar cambios en RustDesk).
function patch(rel, replacements, { optional = false } = {}) {
  const file = resolve(root, rel);
  if (!existsSync(file)) {
    if (!optional) {
      console.error(`✗ No existe ${rel}`);
      failures++;
    }
    return;
  }
  let src = readFileSync(file, "utf8");
  for (const [from, to] of replacements) {
    const found = typeof from === "string" ? src.includes(from) : from.test(src);
    if (!found) {
      console.error(`✗ ${rel}: no se encontró ${from}`);
      failures++;
      continue;
    }
    src = typeof from === "string" ? src.split(from).join(to) : src.replace(from, to);
  }
  writeFileSync(file, src);
  console.log(`✓ ${rel}`);
}

const rsString = (s) => JSON.stringify(s); // literal de cadena válido en Rust

function brandSources() {
  if (brand.rendezvousServer.includes("CAMBIAR") || brand.publicKey.includes("CAMBIAR")) {
    console.error("✗ Configura rendezvousServer, publicKey y apiServer en brand.json o en variables de entorno");
    process.exit(1);
  }

  // Nombre de la app, organización, servidor y clave por defecto
  patch("libs/hbb_common/src/config.rs", [
    [/pub static ref ORG: RwLock<String> = RwLock::new\("[^"]*"\.to_owned\(\)\);/, `pub static ref ORG: RwLock<String> = RwLock::new(${rsString(brand.org)}.to_owned());`],
    [/pub static ref APP_NAME: RwLock<String> = RwLock::new\("[^"]*"\.to_owned\(\)\);/, `pub static ref APP_NAME: RwLock<String> = RwLock::new(${rsString(brand.appName)}.to_owned());`],
    [/pub const RENDEZVOUS_SERVERS: &\[&str\] = &\[[^\]]*\];/, `pub const RENDEZVOUS_SERVERS: &[&str] = &[${rsString(brand.rendezvousServer)}];`],
    [/pub const RS_PUB_KEY: &str = "[^"]*";/, `pub const RS_PUB_KEY: &str = ${rsString(brand.publicKey)};`],
  ]);

  // API por defecto: el panel Intelidesk en lugar de admin.rustdesk.com
  patch("src/common.rs", [[/^(\s*)"https:\/\/admin\.rustdesk\.com"\.to_owned\(\)(\r?)$/m, `$1${rsString(brand.apiServer)}.to_owned()$2`]]);

  // Metadatos del ejecutable de Windows y del paquete
  patch("Cargo.toml", [
    [/LegalCopyright = "[^"]*"/, `LegalCopyright = ${rsString(brand.copyright)}`],
    [/ProductName = "RustDesk"/, `ProductName = ${rsString(brand.appName)}`],
    [/FileDescription = "[^"]*"/, `FileDescription = ${rsString(brand.description)}`],
    [/(\[package\.metadata\.bundle\]\r?\nname = )"RustDesk"/, `$1${rsString(brand.appName)}`],
  ]);
  // macOS: el paquete pasa a llamarse <appName>.app (PRODUCT_NAME). En tiempo de ejecución RustDesk ya
  // adapta los plist de launchd con correct_app_name(); aquí solo se corrigen las rutas fijas de compilación.
  const appBundle = `${brand.appName}.app`;
  for (const rel of [
    "build.py",
    "res/osx-dist.sh",
    "flutter/macos/Runner.xcodeproj/project.pbxproj",
    "flutter/macos/Runner.xcodeproj/xcshareddata/xcschemes/Runner.xcscheme",
  ]) {
    patch(rel, [[/RustDesk\.app/g, appBundle]]);
  }
  patch("build.py", [[/RustDesk Installer/g, `${brand.appName} Installer`]]);

  // Empaquetador autoextraíble del .exe de Windows (libs/portable): son los datos que muestra Propiedades
  patch("libs/portable/Cargo.toml", [
    [/LegalCopyright = "[^"]*"/, `LegalCopyright = ${rsString(brand.copyright)}`],
    [/ProductName = "RustDesk"/, `ProductName = ${rsString(brand.appName)}`],
    [/FileDescription = "[^"]*"/, `FileDescription = ${rsString(brand.description)}`],
  ]);
  patch("flutter/windows/runner/Runner.rc", [
    [/VALUE "CompanyName", "[^"]*"/, `VALUE "CompanyName", ${rsString(brand.company)}`],
    [/VALUE "FileDescription", "[^"]*"/, `VALUE "FileDescription", ${rsString(brand.description)}`],
    [/VALUE "LegalCopyright", "[^"]*"/, `VALUE "LegalCopyright", ${rsString(brand.copyright)}`],
    [/VALUE "ProductName", "[^"]*"/, `VALUE "ProductName", ${rsString(brand.appName)}`],
  ]);
  patch("flutter/macos/Runner/Configs/AppInfo.xcconfig", [
    [/PRODUCT_NAME = .*/, `PRODUCT_NAME = ${brand.appName}`],
    [/PRODUCT_BUNDLE_IDENTIFIER = .*/, `PRODUCT_BUNDLE_IDENTIFIER = ${brand.bundleId}`],
    [/PRODUCT_COPYRIGHT = .*/, `PRODUCT_COPYRIGHT = ${brand.copyright}`],
  ]);

  // iOS (app del técnico): identificador, equipo de Apple, nombre visible, esquema de URL e íconos.
  // La firma (manual, App Store) la configura el workflow intelidesk-ios.yml.
  patch("flutter/ios/Runner.xcodeproj/project.pbxproj", [
    [/PRODUCT_BUNDLE_IDENTIFIER = com\.carriez\.flutterHbb;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${brand.bundleId};`],
    [/DEVELOPMENT_TEAM = HZF9JMC8YN;/g, `DEVELOPMENT_TEAM = ${brand.appleTeamId};`],
    // Solo iPhone: una app universal obliga a publicar capturas de iPad (en iPad corre en modo iPhone)
    [/TARGETED_DEVICE_FAMILY = "1,2";/g, "TARGETED_DEVICE_FAMILY = 1;"],
  ]);
  patch("flutter/ios/Runner/Info.plist", [
    [/(<key>CFBundleDisplayName<\/key>\s*<string>)RustDesk(<\/string>)/, `$1${brand.appName}$2`],
    [/(<key>CFBundleName<\/key>\s*<string>)RustDesk(<\/string>)/, `$1${brand.appName}$2`],
    [/<string>com\.carriez\.rustdesk<\/string>/, `<string>${brand.bundleId}</string>`],
    [/(<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>)rustdesk(<\/string>)/, `$1${brand.appName.toLowerCase()}$2`],
  ]);
  // Sin notificaciones push: la App ID no tiene esa capacidad y Apple avisa si el permiso sobra
  patch("flutter/ios/Runner/Runner.entitlements", [[/\s*<key>aps-environment<\/key>\s*<string>development<\/string>/, ""]]);
  const iosGen = resolve(here, "assets/generated/ios");
  if (existsSync(iosGen)) {
    for (const f of readdirSync(iosGen)) copyFileSync(resolve(iosGen, f), resolve(root, "flutter/ios/Runner/Assets.xcassets/AppIcon.appiconset", f));
    console.log("✓ íconos iOS");
  } else {
    console.error("✗ Faltan los íconos de iOS; ejecuta \"pnpm icons\" en client/scripts");
    failures++;
  }

  // Enlaces de "Acerca de", privacidad y descargas: a la web de Intelidesk en lugar de rustdesk.com
  // (Apple y Google revisan que la app no lleve a otra marca). Los enlaces a la documentación técnica se mantienen.
  const site = brand.website.replace(/\/$/, "");
  const links = [
    [/https:\/\/rustdesk\.com\/privacy\.html/g, `${site}/privacidad`],
    [/https:\/\/rustdesk\.com\/download/g, `${site}/descargar`],
    [/https:\/\/rustdesk\.com\/pricing/g, site],
    [/(['"])https:\/\/rustdesk\.com\/?\1/g, `$1${site}$1`],
  ];
  const linkFiles = {
    "flutter/lib/common.dart": [3],
    "flutter/lib/mobile/pages/settings_page.dart": [0, 3],
    "flutter/lib/mobile/pages/connection_page.dart": [1],
    "flutter/lib/desktop/pages/connection_page.dart": [2],
    "flutter/lib/desktop/pages/desktop_home_page.dart": [1],
    "flutter/lib/desktop/pages/desktop_setting_page.dart": [0, 3],
    "flutter/lib/desktop/pages/install_page.dart": [0],
  };
  for (const [file, idx] of Object.entries(linkFiles)) patch(file, idx.map((i) => links[i]));
  patch("flutter/lib/mobile/pages/settings_page.dart", [[/Text\('rustdesk\.com'/g, `Text(${rsString(new URL(site).host)}`]]);

  // Android: identificador de la app (el namespace de Kotlin no cambia), nombre visible e íconos
  if (brand.androidAppId) {
    patch("flutter/android/app/build.gradle", [[/applicationId "com\.carriez\.flutter_hbb"/, `applicationId ${rsString(brand.androidAppId)}`]]);
  }
  // Símbolos de depuración del código nativo dentro del .aab (Play los usa para los informes de fallos)
  patch("flutter/android/app/build.gradle", [
    [/(buildTypes \{\r?\n(\s*)release \{\r?\n)/, "$1$2    ndk { debugSymbolLevel 'SYMBOL_TABLE' }\n"],
  ]);
  // Google Play (protección automática) exige minSdk 24 o superior
  if (brand.androidMinSdk) {
    patch("flutter/android/app/build.gradle", [[/minSdkVersion \d+/, `minSdkVersion ${Number(brand.androidMinSdk)}`]]);
  }
  patch("flutter/android/app/src/main/AndroidManifest.xml", [
    [/android:label="RustDesk"/, `android:label=${rsString(brand.appName)}`],
    [/android:label="RustDesk Input"/, `android:label=${rsString(`${brand.appName} Input`)}`],
  ]);
  patch("flutter/android/app/src/main/res/values/strings.xml", [[/<string name="app_name">RustDesk<\/string>/, `<string name="app_name">${brand.appName}</string>`]]);
  const androidGen = resolve(here, "assets/generated/android");
  if (existsSync(androidGen)) {
    for (const d of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
      for (const f of ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png", "ic_stat_logo.png"]) {
        copyFileSync(resolve(androidGen, `mipmap-${d}`, f), resolve(root, `flutter/android/app/src/main/res/mipmap-${d}`, f));
      }
    }
    console.log("✓ íconos Android");
  } else {
    console.error("✗ Faltan los íconos de Android; ejecuta \"pnpm icons\" en client/scripts");
    failures++;
  }

  // Color principal de la interfaz (el azul de RustDesk #0071FF -> color de la marca)
  if (brand.accentColor) {
    const hex = brand.accentColor.replace("#", "").toUpperCase();
    patch("flutter/lib/common.dart", [
      [/0071FF/gi, hex],
      [/Color\(0xFF2C8CFF\)/g, `Color(0xFF${hex})`],
      [/primary: Colors\.blue,/g, "primary: MyTheme.accent,"],
    ]);
    patch("flutter/lib/desktop/pages/server_page.dart", [[/0071ff/gi, hex.toLowerCase()]]);
    patch("flutter/android/app/src/main/res/values/colors.xml", [[/#FF0071FF/gi, `#FF${hex}`]]);
  }

  // Íconos (generados con client/scripts: pnpm icons)
  const gen = resolve(here, "assets/generated");
  const icons = {
    "icon.png": ["res/icon.png"],
    "128x128.png": ["res/128x128.png"],
    "128x128@2x.png": ["res/128x128@2x.png"],
    "64x64.png": ["res/64x64.png"],
    "32x32.png": ["res/32x32.png"],
    "mac-icon.png": ["res/mac-icon.png"],
    "icon.ico": ["res/icon.ico", "flutter/windows/runner/resources/app_icon.ico"],
  };
  for (const [src, dests] of Object.entries(icons)) {
    if (!existsSync(resolve(gen, src))) {
      console.error(`✗ Falta ${src}; ejecuta "pnpm icons" en client/scripts`);
      failures++;
      continue;
    }
    for (const d of dests) copyFileSync(resolve(gen, src), resolve(root, d));
  }
  copyFileSync(resolve(here, "assets/icon.svg"), resolve(root, "flutter/assets/icon.svg"));
  console.log("✓ íconos");

  // macOS: .icns a partir de mac-icon.png (solo en runners macOS, que tienen iconutil)
  if (process.platform === "darwin") {
    const set = resolve(root, "intelidesk.iconset");
    execFileSync("mkdir", ["-p", set]);
    for (const s of [16, 32, 128, 256, 512]) {
      execFileSync("sips", ["-z", String(s), String(s), resolve(gen, "mac-icon.png"), "--out", `${set}/icon_${s}x${s}.png`]);
      execFileSync("sips", ["-z", String(s * 2), String(s * 2), resolve(gen, "mac-icon.png"), "--out", `${set}/icon_${s}x${s}@2x.png`]);
    }
    execFileSync("iconutil", ["-c", "icns", set, "-o", resolve(root, "flutter/macos/Runner/AppIcon.icns")]);
    console.log("✓ AppIcon.icns");
  }
}

// Jobs de flutter-build.yml que nunca se compilan para Intelidesk
const ALWAYS_SKIP = [
  "build-for-windows-sciter",
  "build-rustdesk-ios",
  "publish-signed-update-metadata",
  "build-rustdesk-linux-drm",
  "build-rustdesk-linux-sciter",
  "build-appimage",
  "build-flatpak",
  "build-rustdesk-web",
];
// Jobs de cada plataforma elegible con --targets
const TARGET_JOBS = {
  windows: ["build-for-windows-flutter"],
  macos: ["build-for-macOS"],
  linux: ["build-rustdesk-linux", "generate-sbom"],
  android: ["build-rustdesk-android", "build-rustdesk-android-universal"],
};

function setupWorkflow() {
  const rel = ".github/workflows/flutter-build.yml";
  const file = resolve(root, rel);
  let text = readFileSync(file, "utf8");
  const unknown = [...targets].filter((t) => !TARGET_JOBS[t]);
  if (unknown.length) {
    console.error(`✗ Plataformas desconocidas: ${unknown.join(", ")}`);
    process.exit(1);
  }
  const skipJobs = [...ALWAYS_SKIP, ...Object.entries(TARGET_JOBS).flatMap(([t, jobs]) => (targets.has(t) ? [] : jobs))];
  // Windows ARM64 (runners windows-11-arm) no se compila: tarda y casi nadie lo usa
  const arm = /\r?\n {10}- \{\r?\n {14}target: aarch64-pc-windows-msvc,[\s\S]*?\r?\n {12}\}/;
  if (arm.test(text)) text = text.replace(arm, "");
  // Variante ARM64 del componente auxiliar RustDeskTempTopMostWindow
  const armHelper = /\r?\n {10}- \{\r?\n {14}target: windows-11-arm,[\s\S]*?\r?\n {12}\}/;
  if (armHelper.test(text)) text = text.replace(armHelper, "");
  if (/^\s+target: (aarch64-pc-windows-msvc|windows-11-arm),/m.test(text)) {
    console.error("✗ No se pudo quitar Windows ARM64 de la matriz");
    failures++;
  }
  // Pasos de macOS del workflow que buscan el paquete por su nombre fijo
  if (targets.has("macos")) text = text.replace(/RustDesk\.app/g, `${brand.appName}.app`);
  // Notarización: los runners de macOS de GitHub no llegan de forma estable a la API de notarización
  // de Apple (DNS, TLS, timeouts). El job de macOS solo firma y publica el .dmg; un job en Linux
  // (notarize-macos) lo notariza con rcodesign, espera hasta 1 h con reintentos, lo grapa y lo reemplaza.
  if (targets.has("macos")) {
    const notarize =
      /^(\s*)rcodesign notary-submit --api-key-path \$\{\{ github\.workspace \}\}\/rustdesk\.json\s+--staple rustdesk-\$\{\{ env\.VERSION \}\}\.dmg\s*$/m;
    if (notarize.test(text)) text = text.replace(notarize, (_m, ind) => `${ind}# notarización: job notarize-macos (Linux)`);
    else if (!text.includes("job notarize-macos")) {
      console.error("✗ No se encontró el paso de notarización de macOS");
      failures++;
    }
    const notarizeJob = [
      "  notarize-macos:",
      "    name: notarize macOS ${{ matrix.arch }}",
      "    needs: [build-for-macOS]",
      "    if: ${{ !cancelled() && inputs.upload-artifact }}",
      "    runs-on: ubuntu-latest",
      "    strategy:",
      "      fail-fast: false",
      "      matrix:",
      "        arch: [x86_64, aarch64]",
      "    steps:",
      "      - name: Import notarize key",
      "        uses: timheuer/base64-to-file@adaa40c0c581f276132199d4cf60afa07ce60eac # v1.2",
      "        with:",
      "          fileName: notarize.json",
      "          fileDir: ${{ runner.temp }}",
      "          encodedString: ${{ secrets.MACOS_NOTARIZE_JSON }}",
      "",
      "      - name: Notarize, staple and replace DMG",
      "        shell: bash",
      "        env:",
      "          GH_TOKEN: ${{ github.token }}",
      "        run: |",
      "          set -u",
      "          KEY=\"$RUNNER_TEMP/notarize.json\"",
      "          DMG=\"rustdesk-${VERSION}-${{ matrix.arch }}.dmg\"",
      "          curl -sSfL -o rc.tgz https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F0.22.0/apple-codesign-0.22.0-x86_64-unknown-linux-musl.tar.gz",
      "          tar -xzf rc.tgz && RC=$(find . -name rcodesign -type f | head -1) && chmod +x \"$RC\"",
      "          gh release download \"$TAG_NAME\" -R \"$GITHUB_REPOSITORY\" -p \"$DMG\" -D . --clobber",
      "          SUB=\"\"",
      "          for i in 1 2 3; do SUB=$(\"$RC\" notary-submit --api-key-path \"$KEY\" \"$DMG\" 2>&1 | tee /dev/stderr | sed -n 's/.*created submission ID: *//p' | tail -1); [ -n \"$SUB\" ] && break; sleep 30; done",
      "          [ -n \"$SUB\" ] || { echo \"No se pudo enviar a notarizar\"; exit 1; }",
      "          OK=0",
      "          for i in 1 2 3 4 5 6; do \"$RC\" notary-wait --api-key-path \"$KEY\" --max-wait-seconds 3600 \"$SUB\" && OK=1 && break; echo \"reintentando espera ($i)\"; sleep 30; done",
      "          \"$RC\" notary-log --api-key-path \"$KEY\" \"$SUB\" | tee notary-log.json || true",
      "          [ \"$OK\" = 1 ] && grep -q '\"status\": \"Accepted\"' notary-log.json || { echo \"Apple no aceptó la notarización\"; exit 1; }",
      "          for i in 1 2 3; do \"$RC\" staple \"$DMG\" && break; sleep 30; done",
      "          gh release upload \"$TAG_NAME\" -R \"$GITHUB_REPOSITORY\" \"$DMG\" --clobber",
      "",
    ].join("\n");
    const beforeJob = /\n  publish_unsigned:\s*\r?\n/;
    if (!text.includes("  notarize-macos:")) {
      if (beforeJob.test(text)) text = text.replace(beforeJob, (m) => `\n${notarizeJob}${m}`);
      else {
        console.error("✗ No se encontró dónde insertar el job notarize-macos");
        failures++;
      }
    }
  }
  // Android: además del APK universal, un .aab firmado con la llave de subida para Google Play.
  // Se inserta al final del job build-rustdesk-android-universal (justo antes del siguiente job).
  if (targets.has("android") && !text.includes("Build signed Intelidesk AAB")) {
    const aabSteps = [
      "      - name: Build signed Intelidesk AAB (Google Play)",
      "        if: env.ANDROID_SIGNING_KEY != null && env.UPLOAD_ARTIFACT == 'true'",
      "        shell: bash",
      "        env:",
      "          JAVA_HOME: /usr/lib/jvm/java-17-openjdk-amd64",
      "          KEY_B64: ${{ secrets.ANDROID_SIGNING_KEY }}",
      "          KEY_ALIAS: ${{ secrets.ANDROID_ALIAS }}",
      "          STORE_PW: ${{ secrets.ANDROID_KEY_STORE_PASSWORD }}",
      "          KEY_PW: ${{ secrets.ANDROID_KEY_PASSWORD }}",
      "        run: |",
      "          export PATH=/usr/lib/jvm/java-17-openjdk-amd64/bin:$PATH",
      "          pushd flutter",
      "          flutter build appbundle --release --target-platform android-arm64,android-arm,android-x64",
      "          popd",
      "          AAB=flutter/build/app/outputs/bundle/release/app-release.aab",
      "          # Gradle lo firma con la llave de depuración: se quita esa firma y se firma con la de subida",
      "          zip -q -d \"$AAB\" 'META-INF/*' || true",
      "          echo \"$KEY_B64\" | base64 -d > \"$RUNNER_TEMP/upload.jks\"",
      "          jarsigner -keystore \"$RUNNER_TEMP/upload.jks\" -storepass \"$STORE_PW\" -keypass \"$KEY_PW\" -sigalg SHA256withRSA -digestalg SHA-256 \"$AAB\" \"$KEY_ALIAS\"",
      "          rm -f \"$RUNNER_TEMP/upload.jks\"",
      "          jarsigner -verify \"$AAB\" | tail -1",
      "          mkdir -p signed-apk",
      "          mv \"$AAB\" signed-apk/intelidesk-${{ env.VERSION }}.aab",
      "",
      "      - name: Publish Intelidesk AAB",
      "        if: env.ANDROID_SIGNING_KEY != null && env.UPLOAD_ARTIFACT == 'true'",
      "        uses: softprops/action-gh-release@de2c0eb89ae2a093876385947365aca7b0e5f844 # v1",
      "        with:",
      "          prerelease: true",
      "          tag_name: ${{ env.TAG_NAME }}",
      "          files: |",
      "            signed-apk/intelidesk-${{ env.VERSION }}.aab",
      "",
    ].join("\n");
    const nextJob = /\n  build-rustdesk-linux:\s*\r?\n/;
    if (nextJob.test(text)) text = text.replace(nextJob, (m) => `\n${aabSteps}${m}`);
    else {
      console.error("✗ No se encontró dónde insertar la compilación .aab");
      failures++;
    }
  }
  const lines = text.split("\n");
  const jobStart = (l) => /^  ([A-Za-z0-9_-]+):\s*$/.exec(l)?.[1];

  // Jobs omitidos que ya tienen condición propia ("    if:" a nivel de job)
  const hasIf = new Set();
  let job = "";
  for (const l of lines) {
    job = jobStart(l) ?? job;
    if (/^    if:/.test(l)) hasIf.add(job);
  }

  const out = [];
  let added = 0;
  job = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const started = jobStart(line);
    if (started) job = started;
    const skip = skipJobs.includes(job);
    if (skip && /^    if:/.test(line)) {
      out.push("    if: false");
      continue;
    }
    out.push(line);
    if (started && skip && !hasIf.has(job)) out.push("    if: false");
    // Tras cada checkout con submódulos, aplicar la marca
    if (/^          submodules: recursive\s*$/.test(line) && !lines.slice(i, i + 4).some((l) => l.includes("Apply Intelidesk branding"))) {
      out.push(
        "",
        "      - name: Apply Intelidesk branding",
        "        shell: bash",
        "        env:",
        "          INTELIDESK_RENDEZVOUS_SERVER: ${{ vars.INTELIDESK_RENDEZVOUS_SERVER }}",
        "          INTELIDESK_PUBLIC_KEY: ${{ vars.INTELIDESK_PUBLIC_KEY }}",
        "          INTELIDESK_API_SERVER: ${{ vars.INTELIDESK_API_SERVER }}",
        "        run: node intelidesk/apply-branding.mjs .",
      );
      added++;
    }
  }
  writeFileSync(file, out.join("\n"));
  console.log(`✓ ${rel}: paso de marca añadido en ${added} jobs; plataformas: ${[...targets].join(", ")}; ${skipJobs.length} jobs desactivados`);
}

if (flag === "--setup-workflow") setupWorkflow();
else brandSources();

if (failures) {
  console.error(`\n${failures} cambio(s) no se pudieron aplicar: revisa si cambió el código de RustDesk.`);
  process.exit(1);
}
