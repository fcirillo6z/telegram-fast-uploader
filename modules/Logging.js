const winston = require('winston');
const config = require('config');

class Logger {
  constructor() {
    let fileLogger;
    if (config.has("errorlogfile")) {
      fileLogger = new winston.transports.File({
        filename: config.get("errorlogfile"),
        level: 'error',
        format: winston.format.printf(
          info => `[${new Date().toLocaleString()}] ${info.level.toLocaleUpperCase()}: ${info.message}`
        )
      });
    }

    this.logger = winston.createLogger({
      level: config.get("loglevel"),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.printf(
              info =>
                `[${new Date().toLocaleString()}] ${info.level.toLocaleUpperCase()}: ${info.message}`
            ),
            winston.format.colorize({ all: true })
          )
        }),
        ...(fileLogger ? {
          fileLogger
        } : {})
      ]
    });
  }
}
module.exports = new Logger().logger
