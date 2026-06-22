interface BrowserToolModule {
	FS: {
		readFile: (path: string) => Uint8Array;
		writeFile: (path: string, data: string | Uint8Array) => void;
	};
}

interface BrowserToolRequest {
	args: string[];
	id: number;
	inputBuffer: ArrayBuffer;
	inputPath: string;
	outputPath?: string;
	tool: "ffmpeg" | "ffprobe";
}

export type BrowserToolEntrypoint = BrowserToolRequest;

interface BrowserToolSuccess {
	exitCode: number;
	id: number;
	ok: true;
	outputFile?: ArrayBuffer;
	stderrText: string;
	stdoutText: string;
}

interface BrowserToolFailure {
	error: string;
	id: number;
	ok: false;
	stderrText?: string;
}

interface BrowserToolProgress {
	id: number;
	progress: {
		frame?: number;
		outTimeSeconds?: number;
		phase: "continue" | "end";
		speed?: string;
	};
	type: "progress";
}

type BrowserToolFactory = (options: Record<string, unknown>) => Promise<BrowserToolModule>;
type BrowserToolResponse = BrowserToolFailure | BrowserToolProgress | BrowserToolSuccess;
type WorkerScope = typeof globalThis & {
	postMessage: (message: BrowserToolResponse, transfer?: Transferable[]) => void;
};

const workerScope = globalThis as WorkerScope;

globalThis.addEventListener("message", (event: MessageEvent<BrowserToolRequest>) => {
	// oxlint-disable-next-line no-void -- Worker event handlers cannot return promises.
	void runTool(event.data);
});

async function runTool(request: BrowserToolRequest) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const reportProgress = progressReporter(request.id);
	try {
		const factory = await browserToolFactory(request.tool);
		let exitCode: number | undefined;
		let resolveExit: (code: number) => void = () => {};
		const exitPromise = new Promise<number>((resolvePromise) => {
			resolveExit = resolvePromise;
		});
		const module = await factory({
			arguments: request.args,
			locateFile: (name: string) => `wasm/${name}`,
			onExit: (code: number) => {
				exitCode = code;
				resolveExit(code);
			},
			print: (line: string) => stdout.push(line),
			printErr: (line: string) => {
				if (!reportProgress(line)) {
					stderr.push(line);
				}
			},
			preRun: (runtimeModule: BrowserToolModule) => {
				runtimeModule.FS.writeFile(request.inputPath, new Uint8Array(request.inputBuffer));
			},
			thisProgram: request.tool,
		});
		const finalExitCode = await browserToolExitCode(exitCode, exitPromise);
		const response = successResponse(request, module, finalExitCode, stdout, stderr);
		const transfer = response.outputFile === undefined ? [] : [response.outputFile];
		workerScope.postMessage(response, transfer);
	} catch (error) {
		workerScope.postMessage(
			{
				error: errorMessage(error),
				id: request.id,
				ok: false,
				stderrText: stderr.join("\n"),
			},
			[],
		);
	}
}

function progressReporter(id: number) {
	const progress: Record<string, string> = {};
	return (line: string) => {
		const match = /^(?<key>[a-z0-9_]+)=(?<value>.*)$/u.exec(line.trim());
		if (match?.groups === undefined || !isProgressKey(match.groups.key)) {
			return false;
		}
		progress[match.groups.key] = match.groups.value;
		if (match.groups.key !== "progress") {
			return true;
		}
		const outTimeSeconds = parseProgressTime(progress);
		workerScope.postMessage(
			{
				id,
				progress: {
					frame: parseFiniteNumber(progress.frame),
					...(outTimeSeconds === null ? {} : { outTimeSeconds }),
					phase: match.groups.value === "end" ? "end" : "continue",
					speed: progress.speed,
				},
				type: "progress",
			},
			[],
		);
		return true;
	};
}

function isProgressKey(key: string) {
	return (
		key === "bitrate" ||
		key === "drop_frames" ||
		key === "dup_frames" ||
		key === "fps" ||
		key === "frame" ||
		key === "out_time" ||
		key === "out_time_ms" ||
		key === "out_time_us" ||
		key === "progress" ||
		key === "speed" ||
		key === "total_size" ||
		/^stream_\d+_\d+_q$/u.test(key)
	);
}

function parseProgressTime(progress: Record<string, string>) {
	const micros = parseFiniteNumber(progress.out_time_us);
	if (micros !== undefined) {
		return micros / 1_000_000;
	}
	const millis = parseFiniteNumber(progress.out_time_ms);
	if (millis !== undefined) {
		return millis / 1_000_000;
	}
	const clock = progress.out_time;
	if (clock === undefined) {
		return null;
	}
	const match = /^(?<hours>\d+):(?<minutes>\d{2}):(?<seconds>\d{2}(?:\.\d+)?)$/u.exec(clock);
	if (match?.groups === undefined) {
		return null;
	}
	return (
		Number(match.groups.hours) * 3600 +
		Number(match.groups.minutes) * 60 +
		Number(match.groups.seconds)
	);
}

function parseFiniteNumber(value: string | undefined) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function successResponse(
	request: BrowserToolRequest,
	module: BrowserToolModule,
	exitCode: number,
	stdout: string[],
	stderr: string[],
): BrowserToolSuccess {
	const outputBytes =
		exitCode === 0 && request.outputPath !== undefined
			? module.FS.readFile(request.outputPath)
			: undefined;
	const outputFile = outputBytes === undefined ? undefined : exactArrayBuffer(outputBytes);
	return {
		exitCode,
		id: request.id,
		ok: true,
		outputFile,
		stderrText: stderr.join("\n"),
		stdoutText: stdout.join("\n"),
	};
}

function browserToolExitCode(currentExitCode: number | undefined, exitPromise: Promise<number>) {
	if (currentExitCode !== undefined) {
		return currentExitCode;
	}
	return exitPromise;
}

async function browserToolFactory(tool: "ffmpeg" | "ffprobe"): Promise<BrowserToolFactory> {
	const imported: unknown = await import(`./wasm/${tool}.js`);
	if (typeof imported !== "object" || imported === null || !("default" in imported)) {
		throw new Error(`Invalid ${tool} browser module`);
	}
	const factory: unknown = Reflect.get(imported, "default");
	if (!isBrowserToolFactory(factory)) {
		throw new TypeError(`Invalid ${tool} browser module`);
	}
	return factory;
}

function isBrowserToolFactory(value: unknown): value is BrowserToolFactory {
	return typeof value === "function";
}

function exactArrayBuffer(bytes: Uint8Array) {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
