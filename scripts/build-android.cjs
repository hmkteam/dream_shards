#!/usr/bin/env node
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// jarsigner algorithms for signing the Android App Bundle (apksigner cannot sign .aab).
const AAB_SIG_ALG = "SHA256withRSA";
const AAB_DIGEST_ALG = "SHA-256";

// How much to raise versionCode per release build. Google Play requires every
// uploaded artifact to have a strictly higher versionCode than the previous one.
const VERSION_CODE_STEP = 1;
// Used only if version.properties is missing, so the first bump yields versionCode=1.
const VERSION_CODE_FALLBACK_NAME = "1.0.0";

// Gradle names the release APK after outputFileName in android/app/build.gradle;
// the two must match or the built APK is not found (build-android.test.ts).
const APK_OUTPUT_NAME = "dream_shards.apk";
const AAB_OUTPUT_NAME = "dream_shards.aab";

const root = path.resolve(__dirname, "..");
const androidDir = path.join(root, "android");
const versionPropsFile = path.join(androidDir, "version.properties");
const keystorePropsFile = path.join(androidDir, "keystore.properties");
const apkSrc = path.join(androidDir, "app", "build", "outputs", "apk", "release", APK_OUTPUT_NAME);
const aabSrc = path.join(
  androidDir,
  "app",
  "build",
  "outputs",
  "bundle",
  "release",
  "app-release.aab",
);
const buildDir = path.join(root, "build");
const apkDst = path.join(buildDir, APK_OUTPUT_NAME);
const aabDst = path.join(buildDir, AAB_OUTPUT_NAME);

/**
 * Parses the `versionCode` value from a version.properties text body.
 *
 * @param {string} text - Raw contents of version.properties.
 * @returns {number | null} The parsed integer versionCode, or null if absent.
 */
function parseVersionCode(text) {
  const m = text.match(/^versionCode=(\d+)\s*$/m);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Returns a new version.properties body with `versionCode` increased by `step`,
 * preserving every other line (versionName, comments). When no versionCode line
 * exists, one is appended starting from `step`.
 *
 * @param {string} text - Raw contents of version.properties.
 * @param {number} step - Amount to add to the current versionCode.
 * @returns {{ previous: number, next: number, text: string }} Bump result.
 */
function bumpVersionCode(text, step) {
  const current = parseVersionCode(text);
  const previous = current ?? 0;
  const next = previous + step;
  const line = `versionCode=${next}`;

  if (current === null) {
    const base = text.trimEnd();
    return { previous, next, text: base ? `${base}\n${line}\n` : `${line}\n` };
  }
  return { previous, next, text: text.replace(/^versionCode=\d+\s*$/m, line) };
}

/**
 * The versionCode bump of android/version.properties, worked out but not
 * written: the web bundle is built with its `next` before the file is bumped
 * (a failed web build burns no versionCode). A missing file reads as a minimal
 * template, so the build never fails on a fresh checkout where the counter was lost.
 *
 * @returns {{ previous: number, next: number, text: string }} The old and new versionCode, the new file body.
 */
function planVersionBump() {
  const text = fs.existsSync(versionPropsFile)
    ? fs.readFileSync(versionPropsFile, "utf8")
    : `versionName=${VERSION_CODE_FALLBACK_NAME}\n`;
  return bumpVersionCode(text, VERSION_CODE_STEP);
}

/**
 * Runs a command, streaming its output. Any substrings listed in `opts.secrets`
 * are masked in the echoed command line so signing passwords never leak into logs.
 *
 * @param cmd - Executable to run.
 * @param args - Argument list.
 * @param opts - spawnSync options, plus an optional `secrets` array to redact from the log.
 */
function run(cmd, args, opts = {}) {
  const { secrets = [], ...spawnOpts } = opts;
  let shown = `${cmd} ${args.join(" ")}`;
  for (const secret of secrets) {
    if (secret) shown = shown.split(secret).join("****");
  }
  console.log(`\n> ${shown}`);
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...spawnOpts,
  });
  if (res.status !== 0) {
    console.error(`\nFAILED: ${cmd} (exit ${res.status})`);
    process.exit(res.status || 1);
  }
}

function readSdkDir() {
  const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const propsPath = path.join(androidDir, "local.properties");
  if (fs.existsSync(propsPath)) {
    const m = fs.readFileSync(propsPath, "utf8").match(/^sdk\.dir=(.+)$/m);
    if (m) return m[1].trim();
  }
  const fallback = path.join(os.homedir(), "Library", "Android", "sdk");
  if (fs.existsSync(fallback)) return fallback;
  throw new Error(
    "Android SDK location not found (set ANDROID_HOME or sdk.dir in android/local.properties).",
  );
}

function findApksigner(sdkDir) {
  const btDir = path.join(sdkDir, "build-tools");
  const versions = fs
    .readdirSync(btDir)
    .filter((v) => /^\d+/.test(v))
    .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  for (const v of versions) {
    const bin = path.join(btDir, v, process.platform === "win32" ? "apksigner.bat" : "apksigner");
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error(`apksigner not found under ${btDir}`);
}

/**
 * Resolves the `jarsigner` executable, preferring the JDK pinned for the Gradle
 * build (gradle.properties → org.gradle.java.home) so the AAB is signed with the
 * same JVM that builds it. Falls back to JAVA_HOME, then to a bare PATH lookup.
 *
 * @returns Absolute path to jarsigner, or the bare command name to resolve via PATH.
 */
function findJarsigner() {
  const binName = process.platform === "win32" ? "jarsigner.exe" : "jarsigner";
  const candidates = [];
  const propsPath = path.join(androidDir, "gradle.properties");
  if (fs.existsSync(propsPath)) {
    const m = fs.readFileSync(propsPath, "utf8").match(/^org\.gradle\.java\.home=(.+)$/m);
    if (m) candidates.push(m[1].trim());
  }
  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);
  for (const jdkHome of candidates) {
    const bin = path.join(jdkHome, "bin", binName);
    if (fs.existsSync(bin)) return bin;
  }
  return binName;
}

/**
 * @typedef {Object} SigningProperties
 * @property {string} storeFile - Keystore path as written in keystore.properties.
 * @property {string} storePass - Keystore password.
 * @property {string} alias - Key alias.
 * @property {string} keyPass - Key password (defaults to the keystore password).
 */

/**
 * @typedef {Object} SigningConfig
 * @property {string} keystore - Absolute path to the keystore file.
 * @property {string} storePass - Keystore password.
 * @property {string} alias - Key alias.
 * @property {string} keyPass - Key password.
 */

/**
 * Parses a keystore.properties body. `keyPassword` may be omitted when the key
 * shares the keystore password (the default for keys made by `keytool` with a
 * PKCS12 store).
 *
 * @param {string} text - Raw contents of keystore.properties.
 * @returns {SigningProperties} The parsed signing properties.
 * @throws {Error} When storeFile, storePassword or keyAlias is missing.
 */
function parseKeystoreProperties(text) {
  const get = (key) => {
    const m = text.match(new RegExp(`^${key}=(.+)$`, "m"));
    return m ? m[1].trim() : undefined;
  };

  const storeFile = get("storeFile");
  const storePass = get("storePassword");
  const alias = get("keyAlias");
  const keyPass = get("keyPassword") || storePass;
  if (!storeFile || !storePass || !alias) {
    throw new Error(
      "android/keystore.properties must define storeFile, storePassword and keyAlias.",
    );
  }
  return { storeFile, storePass, alias, keyPass };
}

/**
 * Loads the upload-key signing config from android/keystore.properties
 * (gitignored). `storeFile` is resolved relative to the android/ directory
 * unless absolute. There is deliberately no fallback to the debug key: Google
 * Play rejects debug-signed artifacts, so a build without the upload key fails
 * up front instead of producing an AAB that cannot be uploaded.
 *
 * @returns {SigningConfig} The release signing config.
 * @throws {Error} When keystore.properties or the keystore it names is missing.
 */
function readReleaseSigning() {
  if (!fs.existsSync(keystorePropsFile)) {
    throw new Error(
      "Release signing is not configured: android/keystore.properties not found.\n" +
        "Google Play rejects debug-signed builds, so `npm run build` needs the upload key.\n" +
        "Copy it from ~/.claude/skills/archive-project/keys/ (see SKILL.md, «Ключ подписи»).",
    );
  }

  const { storeFile, storePass, alias, keyPass } = parseKeystoreProperties(
    fs.readFileSync(keystorePropsFile, "utf8"),
  );
  const keystore = path.isAbsolute(storeFile) ? storeFile : path.join(androidDir, storeFile);
  if (!fs.existsSync(keystore)) {
    throw new Error(`Keystore not found at ${keystore} (storeFile in keystore.properties).`);
  }
  return { keystore, storePass, alias, keyPass };
}

/**
 * Signs an APK in place using apksigner.
 *
 * @param apksigner - Path to the apksigner executable.
 * @param signing - Signing config.
 * @param artifact - Path to the .apk to sign in place.
 */
function signApk(apksigner, signing, artifact) {
  run(
    apksigner,
    [
      "sign",
      "--ks",
      signing.keystore,
      "--ks-pass",
      `pass:${signing.storePass}`,
      "--ks-key-alias",
      signing.alias,
      "--key-pass",
      `pass:${signing.keyPass}`,
      artifact,
    ],
    { secrets: [signing.storePass, signing.keyPass] },
  );
}

/**
 * Signs an Android App Bundle in place using jarsigner (apksigner does not
 * support .aab artifacts). Play App Signing accepts an AAB signed with the
 * upload key via JAR signing.
 *
 * @param jarsigner - Path to the jarsigner executable.
 * @param signing - Signing config.
 * @param artifact - Path to the .aab to sign in place.
 */
function signAab(jarsigner, signing, artifact) {
  run(
    jarsigner,
    [
      "-sigalg",
      AAB_SIG_ALG,
      "-digestalg",
      AAB_DIGEST_ALG,
      "-keystore",
      signing.keystore,
      "-storepass",
      signing.storePass,
      "-keypass",
      signing.keyPass,
      artifact,
      signing.alias,
    ],
    { secrets: [signing.storePass, signing.keyPass] },
  );
}

function reportArtifact(label, dst) {
  const sizeMb = (fs.statSync(dst).size / (1024 * 1024)).toFixed(2);
  console.log(`  ${label}: ${dst} (${sizeMb} MB)`);
}

/**
 * Orchestrates the full release build: signing check → sync → version bump →
 * gradle → sign → collect. Signing is resolved first so a missing upload key
 * fails in a second, without a wasted build or a burnt versionCode.
 */
function main() {
  let signing;
  try {
    signing = readReleaseSigning();
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exit(1);
  }
  console.log(`Signing with the upload key "${signing.alias}" from android/keystore.properties.`);

  // The bundle shows the build it ships in (debug dialog «Сборка»): the
  // versionCode this build is about to take.
  const bump = planVersionBump();
  // Web bundle: projects with a bundler define `build:web` (it must write into
  // capacitor.config.json → webDir). Static games (webDir is the source folder)
  // have nothing to build.
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg.scripts && pkg.scripts["build:web"]) {
    run("npm", ["run", "build:web"], {
      cwd: root,
      env: { ...process.env, VITE_BUILD_NUMBER: String(bump.next) },
    });
  }
  run("npx", ["cap", "sync", "android"], { cwd: root });

  fs.writeFileSync(versionPropsFile, bump.text);
  console.log(`\nversionCode: ${bump.previous} → ${bump.next}`);

  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  run(
    gradlew,
    [
      "clean",
      "assembleRelease",
      "bundleRelease",
      "-x",
      "lintVitalAnalyzeRelease",
      "-x",
      "lintVitalRelease",
    ],
    { cwd: androidDir },
  );

  if (!fs.existsSync(apkSrc)) {
    console.error(`\nAPK not found at ${apkSrc}`);
    process.exit(1);
  }
  if (!fs.existsSync(aabSrc)) {
    console.error(`\nAAB not found at ${aabSrc}`);
    process.exit(1);
  }

  const sdkDir = readSdkDir();
  const apksigner = findApksigner(sdkDir);
  const jarsigner = findJarsigner();

  signApk(apksigner, signing, apkSrc);
  signAab(jarsigner, signing, aabSrc);

  fs.mkdirSync(buildDir, { recursive: true });
  fs.copyFileSync(apkSrc, apkDst);
  fs.copyFileSync(aabSrc, aabDst);

  console.log(`\nDone (release build, versionCode ${bump.next}, signed with the upload key):`);
  reportArtifact("APK", apkDst);
  reportArtifact("AAB", aabDst);
}

module.exports = {
  parseVersionCode,
  bumpVersionCode,
  parseKeystoreProperties,
  VERSION_CODE_STEP,
  APK_OUTPUT_NAME,
  AAB_OUTPUT_NAME,
};

if (require.main === module) {
  main();
}
