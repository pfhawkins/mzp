type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

const LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

let currentLevel: LogLevel = "info";

export function parseLogLevel(value: string | undefined = process.env.LOG_LEVEL): LogLevel {
	if (value === undefined) return "info";

	const level = value.trim();
	if (LOG_LEVELS.includes(level as LogLevel)) return level as LogLevel;

	throw new Error(
		`Configuration error: invalid LOG_LEVEL ${JSON.stringify(value)}. ` +
			`Expected one of: ${LOG_LEVELS.join(", ")}.`,
	);
}

export function configureLogger(value: string | undefined = process.env.LOG_LEVEL): LogLevel {
	currentLevel = parseLogLevel(value);
	return currentLevel;
}

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
