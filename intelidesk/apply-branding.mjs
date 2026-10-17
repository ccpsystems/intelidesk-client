#!/usr/bin/env node
// Aplica la marca Intelidesk a un checkout de RustDesk (con submódulos).
//
//   node apply-branding.mjs <ruta-rustdesk>                  parchea el código (se ejecuta en CI tras el checkout)
//   node apply-branding.mjs <ruta-rustdesk> --setup-workflow  prepara .github/workflows/flutter-build.yml del fork
//                                                              para que ejecute este script y compile solo escritorio
//
// La configuración se lee de brand.json (junto a este script) y puede sobrescribirse con variables
// de entorno: INTELIDESK_RENDEZVOUS_SERVER, INTELIDESK_PUBLIC_KEY, INTELIDESK_API_SERVER.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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

  // Android: identificador de la app (el namespace de Kotlin no cambia), nombre visible e íconos
  if (brand.androidAppId) {
    patch("flutter/android/app/build.gradle", [[/applicationId "com\.carriez\.flutter_hbb"/, `applicationId ${rsString(brand.androidAppId)}`]]);
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
