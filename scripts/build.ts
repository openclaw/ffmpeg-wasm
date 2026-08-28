#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const cache = resolve(root, ".cache");
const browserSrcDir = resolve(cache, "FFmpeg-browser");
const lameDir = resolve(cache, "lame");
const libvpxDir = resolve(cache, "libvpx");
const nodeSrcDir = resolve(cache, "FFmpeg");
const prefix = resolve(cache, "prefix");
const dist = resolve(root, "dist");
const browserDist = resolve(dist, "browser");
const ffmpegTag = process.env.FFMPEG_VERSION ?? "n9.0.1";
const lameRef = process.env.LAME_REF ?? "2badea1974ae36cb8312afe99cff1e6b3b5decee";
const libvpxRef = process.env.LIBVPX_REF ?? "v1.17.0";
const jobs = Math.max(1, Math.min(8, availableParallelism()));
const prefixInclude = resolve(prefix, "include");
const prefixLib = resolve(prefix, "lib");

const commonConfigureFlags = [
  "--target-os=none",
  "--arch=x86_32",
  "--enable-cross-compile",
  "--disable-x86asm",
  "--disable-inline-asm",
  "--disable-stripping",
  "--disable-doc",
  "--disable-debug",
  "--disable-autodetect",
  "--disable-all",
  "--disable-network",
  "--disable-iconv",
  "--disable-runtime-cpudetect",
  "--enable-ffmpeg",
  "--enable-ffprobe",
  "--disable-ffplay",
  "--enable-avcodec",
  "--enable-avdevice",
  "--enable-avformat",
  "--enable-avfilter",
  "--enable-swresample",
  "--enable-swscale",
  "--enable-decoder=h264,hevc,mpeg4,vp8,vp9,aac,mp3,flac,vorbis,opus,pcm_s16le,png,mjpeg,wrapped_avframe",
  "--enable-parser=h264,hevc,mpeg4video,vp8,vp9,aac,mpegaudio,opus,vorbis,png,mjpeg",
  "--enable-demuxer=mov,matroska,mp3,wav,flac,ogg,aac,mpegts,hls,image2",
  "--enable-indev=lavfi",
  "--enable-muxer=null,rawvideo,image2,wav,segment,mp3,mov,mp4,webm",
  "--enable-encoder=mpeg4,png,rawvideo,wrapped_avframe,pcm_s16le,libmp3lame,libvpx_vp8,opus",
  "--enable-protocol=file,data,pipe,fd",
  "--enable-filter=scale,format,select,showinfo,signalstats,metadata,null,aresample,aformat,testsrc2,sine",
  "--enable-zlib",
  "--enable-libmp3lame",
  "--enable-libvpx",
  "--cc=emcc",
  "--cxx=em++",
  "--ar=emar",
  "--ranlib=emranlib",
  "--nm=emnm",
  "--pkg-config-flags=--static",
  "--optflags=-Oz",
];

const ffmpegConfigureFlags = [
  ...commonConfigureFlags,
  "--enable-pthreads",
  "--disable-w32threads",
  "--disable-os2threads",
  `--extra-cflags=-Oz -pthread -sUSE_ZLIB=1 -I${prefixInclude}`,
  `--extra-ldflags=-Oz -pthread -sUSE_ZLIB=1 -L${prefixLib}`,
];

const commonExeFlags =
  "-Oz -pthread -sUSE_ZLIB=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sALLOW_MEMORY_GROWTH=1 -sPTHREAD_POOL_SIZE=4 -sPROXY_TO_PTHREAD=1 -sEXIT_RUNTIME=1 -sEXPORTED_RUNTIME_METHODS=FS,callMain";
const nodeExeFlags = [`LDEXEFLAGS=${commonExeFlags} -sENVIRONMENT=node -sNODERAWFS=1`];
const browserExeFlags = [`LDEXEFLAGS=${commonExeFlags} -sENVIRONMENT=web,worker`];

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
}

function run(cmd: string, args: string[], options: RunOptions = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0 && options.allowFailure !== true) {
    process.exit(result.status ?? 1);
  }
}

mkdirSync(cache, { recursive: true });
ensureCheckout(nodeSrcDir, "https://github.com/FFmpeg/FFmpeg.git", ffmpegTag);
ensureCheckout(browserSrcDir, "https://github.com/FFmpeg/FFmpeg.git", ffmpegTag);
ensureCheckout(lameDir, "https://github.com/ffmpegwasm/lame.git", lameRef);
ensureCheckout(libvpxDir, "https://chromium.googlesource.com/webm/libvpx", libvpxRef);

rmSync(prefix, { recursive: true, force: true });
mkdirSync(prefix, { recursive: true });
buildLame();
buildLibvpx();

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
buildFfmpeg(nodeSrcDir, nodeExeFlags);
copyGeneratedTools(nodeSrcDir, dist);

buildFfmpeg(browserSrcDir, browserExeFlags);
mkdirSync(browserDist, { recursive: true });
copyGeneratedTools(browserSrcDir, browserDist);

for (const name of [
  "LICENSE.md",
  "COPYING.LGPLv2.1",
  "COPYING.LGPLv3",
  "COPYING.GPLv2",
  "COPYING.GPLv3",
]) {
  cpSync(resolve(nodeSrcDir, name), resolve(dist, name));
}
cpSync(resolve(libvpxDir, "LICENSE"), resolve(dist, "LICENSE.libvpx"));
cpSync(resolve(libvpxDir, "PATENTS"), resolve(dist, "PATENTS.libvpx"));

function buildLame() {
  run("emmake", ["make", "distclean"], { cwd: lameDir, allowFailure: true });
  run(
    "emconfigure",
    [
      "./configure",
      `--prefix=${prefix}`,
      "--host=i686-linux",
      "--disable-shared",
      "--disable-frontend",
      "--disable-analyzer-hooks",
      "--disable-dependency-tracking",
      "--disable-gtktest",
    ],
    { cwd: lameDir, env: { CFLAGS: "-Oz" } },
  );
  run("emmake", ["make", "-j", String(jobs), "install"], { cwd: lameDir });
}

function buildLibvpx() {
  run("emmake", ["make", "clean"], { cwd: libvpxDir, allowFailure: true });
  run(
    "emconfigure",
    [
      "./configure",
      `--prefix=${prefix}`,
      "--target=generic-gnu",
      "--disable-shared",
      "--enable-static",
      "--disable-examples",
      "--disable-tools",
      "--disable-docs",
      "--disable-unit-tests",
      "--disable-vp9",
      "--disable-vp8-decoder",
      "--enable-vp8-encoder",
      "--disable-multithread",
      "--disable-runtime-cpu-detect",
      "--disable-webm-io",
      "--disable-libyuv",
      // Match the pthread-enabled FFmpeg module's wasm atomics ABI.
      "--extra-cflags=-Oz -pthread",
    ],
    { cwd: libvpxDir },
  );
  run("emmake", ["make", "-j", String(jobs), "install"], { cwd: libvpxDir });
}

function ensureCheckout(dir: string, repo: string, ref: string) {
  if (!existsSync(dir)) {
    run("git", ["clone", "--filter=blob:none", "--no-checkout", repo, dir]);
  }
  run("git", ["fetch", "--depth", "1", "origin", ref], { cwd: dir });
  run("git", ["checkout", "--force", "--detach", "FETCH_HEAD"], { cwd: dir });
}

function buildFfmpeg(srcDir: string, exeFlags: string[]) {
  run("emmake", ["make", "distclean"], { cwd: srcDir, allowFailure: true });
  run("emconfigure", ["./configure", ...ffmpegConfigureFlags], {
    cwd: srcDir,
    env: { PKG_CONFIG_PATH: resolve(prefix, "lib", "pkgconfig") },
  });
  run("emmake", ["make", "-j", String(jobs), "ffmpeg", "ffprobe", ...exeFlags], {
    cwd: srcDir,
  });
}

function copyGeneratedTools(srcDir: string, outputDir: string) {
  mkdirSync(outputDir, { recursive: true });
  for (const name of ["ffmpeg", "ffprobe"]) {
    cpSync(resolve(srcDir, name), resolve(outputDir, `${name}.js`));
    cpSync(resolve(srcDir, name), resolve(outputDir, `${name}_g`));
    cpSync(resolve(srcDir, `${name}_g.wasm`), resolve(outputDir, `${name}_g.wasm`));
    const workerPath = resolve(srcDir, `${name}.worker.js`);
    if (existsSync(workerPath)) {
      cpSync(workerPath, resolve(outputDir, `${name}.worker.js`));
    }
  }
}
