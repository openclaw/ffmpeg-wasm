#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const cache = resolve(root, ".cache");
const srcDir = resolve(cache, "FFmpeg");
const lameDir = resolve(cache, "lame");
const prefix = resolve(cache, "prefix");
const dist = resolve(root, "dist");
const ffmpegTag = process.env.FFMPEG_VERSION ?? "n8.1.1";
const lameRef = process.env.LAME_REF ?? "master";

const configureFlags = [
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
  "--enable-pthreads",
  "--disable-w32threads",
  "--disable-os2threads",
  "--enable-ffmpeg",
  "--enable-ffprobe",
  "--disable-ffplay",
  "--enable-avcodec",
  "--enable-avformat",
  "--enable-avfilter",
  "--enable-swresample",
  "--enable-swscale",
  "--enable-decoder=h264,hevc,mpeg4,vp8,vp9,aac,mp3,flac,vorbis,opus,pcm_s16le,png,mjpeg",
  "--enable-parser=h264,hevc,mpeg4video,vp8,vp9,aac,mpegaudio,opus,vorbis,png,mjpeg",
  "--enable-demuxer=mov,matroska,mp3,wav,flac,ogg,aac,mpegts,hls,image2",
  "--enable-muxer=null,rawvideo,image2,wav,segment,mp3,mov,mp4",
  "--enable-encoder=mpeg4,png,rawvideo,wrapped_avframe,pcm_s16le,libmp3lame",
  "--enable-protocol=file,data,pipe,fd",
  "--enable-filter=scale,format,select,showinfo,signalstats,metadata,null,aresample,aformat",
  "--enable-zlib",
  "--enable-libmp3lame",
  "--cc=emcc",
  "--cxx=em++",
  "--ar=emar",
  "--ranlib=emranlib",
  "--nm=emnm",
  "--pkg-config-flags=--static",
  "--optflags=-Oz",
  `--extra-cflags=-Oz -pthread -sUSE_ZLIB=1 -I${resolve(prefix, "include")}`,
  `--extra-ldflags=-Oz -pthread -sUSE_ZLIB=1 -L${resolve(prefix, "lib")}`,
];

const exeFlags = [
  "LDEXEFLAGS=-Oz -pthread -sUSE_ZLIB=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=node -sNODERAWFS=1 -sALLOW_MEMORY_GROWTH=1 -sPTHREAD_POOL_SIZE=4 -sPROXY_TO_PTHREAD=1 -sEXIT_RUNTIME=1 -sEXPORTED_RUNTIME_METHODS=FS,callMain",
];

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
ensureCheckout(srcDir, "https://github.com/FFmpeg/FFmpeg.git", ffmpegTag);
ensureCheckout(lameDir, "https://github.com/ffmpegwasm/lame.git", lameRef);

rmSync(prefix, { recursive: true, force: true });
mkdirSync(prefix, { recursive: true });
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
run("emmake", ["make", "-j", String(parallelJobs()), "install"], { cwd: lameDir });

run("emmake", ["make", "distclean"], { cwd: srcDir, allowFailure: true });
run("emconfigure", ["./configure", ...configureFlags], {
  cwd: srcDir,
  env: { PKG_CONFIG_PATH: resolve(prefix, "lib", "pkgconfig") },
});
run("emmake", ["make", "-j", String(parallelJobs()), "ffmpeg", "ffprobe", ...exeFlags], {
  cwd: srcDir,
});

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const name of ["ffmpeg", "ffprobe"]) {
  cpSync(resolve(srcDir, name), resolve(dist, `${name}.js`));
  cpSync(resolve(srcDir, name), resolve(dist, `${name}_g`));
  cpSync(resolve(srcDir, `${name}_g.wasm`), resolve(dist, `${name}_g.wasm`));
}
for (const name of [
  "LICENSE.md",
  "COPYING.LGPLv2.1",
  "COPYING.LGPLv3",
  "COPYING.GPLv2",
  "COPYING.GPLv3",
]) {
  cpSync(resolve(srcDir, name), resolve(dist, name));
}

function parallelJobs() {
  return Math.max(1, Math.min(8, availableParallelism()));
}

function ensureCheckout(dir: string, repo: string, ref: string) {
  if (!existsSync(dir)) {
    run("git", ["clone", "--filter=blob:none", "--no-checkout", repo, dir]);
  }
  run("git", ["fetch", "--depth", "1", "origin", ref], { cwd: dir });
  run("git", ["checkout", "--force", "--detach", "FETCH_HEAD"], { cwd: dir });
}
