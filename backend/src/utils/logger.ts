import { config } from '../config';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const colors = {
  info: '\x1b[36m',    // Cyan
  warn: '\x1b[33m',    // Yellow
  error: '\x1b[31m',   // Red
  debug: '\x1b[35m',   // Magenta
  reset: '\x1b[0m',
};

function formatMessage(level: LogLevel, message: string) {
  const timestamp = new Date().toISOString();
  const color = colors[level];
  const reset = colors.reset;
  const prefix = `${color}[${level.toUpperCase()}]${reset}`;

  return `${timestamp} ${prefix} ${message}`;
}

export const logger = {
  info: (message: string, ...args: any[]) => {
    console.log(formatMessage('info', message), ...args);
  },

  warn: (message: string, ...args: any[]) => {
    console.warn(formatMessage('warn', message), ...args);
  },

  error: (message: string, ...args: any[]) => {
    console.error(formatMessage('error', message), ...args);
  },

  debug: (message: string, ...args: any[]) => {
    if (config.isDevelopment) {
      console.log(formatMessage('debug', message), ...args);
    }
  },
};
