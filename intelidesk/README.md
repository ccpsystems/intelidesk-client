# Cliente Intelidesk (RustDesk con tu marca)

El cliente de escritorio es RustDesk con nombre, íconos, servidor y clave de Intelidesk.
No se modifica el núcleo: `apply-branding.mjs` cambia solo constantes, textos e íconos,
y se aplica durante la compilación en GitHub Actions.

## Opción rápida (sin compilar): cliente oficial preconfigurado

Mientras no compiles tu cliente con marca, puedes usar el cliente oficial de RustDesk:

- **Windows:** renombra el instalador oficial con el nombre que aparece en el panel
  (*Instalar cliente → paso 2*). Al abrirlo queda apuntando a tu servidor.
  Comprobado con RustDesk 1.5.0.
- **macOS / Linux:** *Ajustes → Red → Servidor ID/Relay → Importar* y pega la
  cadena de configuración del panel.

## Compilar el cliente con marca

### 1. Prepara el fork (una sola vez)

```bash
# En GitHub: haz fork de https://github.com/rustdesk/rustdesk como <tu-usuario>/intelidesk-client
git clone --recurse-submodules https://github.com/<tu-usuario>/intelidesk-client
cd intelidesk-client
git checkout -b intelidesk 1.5.0          # parte de una versión estable
git submodule update --init --recursive

# Copia esta carpeta "client" del proyecto como "intelidesk" dentro del fork
cp -r /ruta/a/intelidesk/client ./intelidesk
node intelidesk/apply-branding.mjs . --setup-workflow   # añade el paso de marca y desactiva móviles/web
git add intelidesk .github/workflows/flutter-build.yml
git commit -m "Intelidesk: marca y compilación de escritorio"
git push -u origin intelidesk
```

### 2. Configura el servidor en el fork

En **Settings → Secrets and variables → Actions** del fork, en la pestaña **Variables**:

| Variable | Valor |
| --- | --- |
| `INTELIDESK_RENDEZVOUS_SERVER` | `rd.tudominio.com` |
| `INTELIDESK_PUBLIC_KEY` | contenido de `data/hbbs/id_ed25519.pub` del servidor |
| `INTELIDESK_API_SERVER` | `https://panel.tudominio.com` |

El paso *Apply Intelidesk branding* lee esas variables (tienen prioridad sobre
`brand.json`). La clave pública no es secreta: es la misma que reciben todos los clientes.

### 3. Compila

En **Actions → Flutter Nightly Build → Run workflow** (rama `intelidesk`).
Tarda entre 1 y 2 horas. Los instaladores quedan en el release `nightly` del fork.

### 4. Firma (para que Windows y macOS no bloqueen la app)

- **macOS:** secretos `MACOS_P12_BASE64`, `MACOS_P12_PASSWORD`,
  `MACOS_CODESIGN_IDENTITY` (certificado *Developer ID Application* de tu cuenta
  Apple Developer) y `MACOS_NOTARIZE_JSON` para la notarización.
- **Windows:** el workflow original firma con un servicio propio de RustDesk
  (`SIGN_BASE_URL`). Para tu marca, firma el `.exe`/`.msi` con tu certificado
  (Azure Trusted Signing o un certificado OV/EV) usando `signtool`, o agrega ese
  paso al job `build-for-windows-flutter`.

## Cambiar el logo

Reemplaza `assets/icon.svg` (ícono cuadrado) y `assets/mac-icon.svg`
(con margen, estilo macOS) y regenera:

```bash
cd client/scripts && pnpm install && pnpm icons
```

## Licencia

RustDesk es AGPL-3.0. Si distribuyes el cliente modificado, debes publicar el
código fuente de esas modificaciones (el fork público cumple con esto).
El panel y la API de Intelidesk son programas independientes que se comunican
por red y pueden ser privados.
