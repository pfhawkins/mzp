type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";

function log(level: LogLevel, message: string, ...args: unknown[]) {
	if (LEVELS[level] < LEVELS[currentLevel]) return;
	const prefix = `[${level.toUpperCase()}]`;
	if (args.length > 0) {
		console.error(prefix, message, ...args);
	} else {
		console.error(prefix, message);
	}
}

export const logger = {
	debug: (message: string, ...args: unknown[]) => log("debug", message, ...args),
	info: (message: string, ...args: unknown[]) => log("info", message, ...args),
	warn: (message: string, ...args: unknown[]) => log("warn", message, ...args),
	error: (message: string, ...args: unknown[]) => log("error", message, ...args),
};
