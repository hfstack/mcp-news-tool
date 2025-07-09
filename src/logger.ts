import { createLogger, format, transports, Logger } from 'winston';

/**
 * 日志级别配置
 */
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

/**
 * 根据环境确定日志级别
 */
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'warn';
};

/**
 * 自定义日志格式
 */
const formatOptions = [
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  format.errors({ stack: true }),
  format.splat(),
  format.json(),
];

/**
 * 控制台日志格式
 */
const consoleFormat = format.combine(
  format.colorize({ all: true }),
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  format.printf((info: any) => `${info.timestamp} [${info.level}] ${info.message}`)
);

/**
 * 文件日志格式
 */
const fileFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  format.printf((info: any) => `${info.timestamp} [${info.level}] ${info.message}`)
);

/**
 * 日志传输配置
 */
const transportsConfig = [
  new transports.Console({
    format: consoleFormat,
  }),
];

/**
 * 创建日志记录器
 */
const logger = createLogger({
  level: level(),
  levels,
  format: format.combine(...formatOptions),
  transports: transportsConfig,
});

export default logger;
