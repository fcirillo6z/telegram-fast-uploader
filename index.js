process.env.NTBA_FIX_319 = 1
const fsProm = require('node:fs/promises');
const fs = require('node:fs');
const chokidar = require('chokidar');
const config = require('config')
const logger = require('./modules/Logging');
const anymatch = require('anymatch');
const token = config.get('bot-token');
const chatId = config.get('chatId');
const monitoredFolder = config.get('watchFolder');
const convertedFolder = config.get('convertedFolder') ?? monitoredFolder;
const { exec } = require('child_process');
const path = require('path');
const readline = require('readline');
const TelegramBot = require('node-telegram-bot-api');

const sendTelegram = async function (bot, body, files) {
  if (!bot) {
    logger.debug('bot non trovato')
    return
  }
  if (bot && bot.sendMessage) {
    try {
      await sendMessage(bot, body);
      if (files) {
        files.forEach(async (file) => {
          switch (file.type) {
            case 'video':
              await bot.sendVideo(chatId, file.attachment, {}, {
                filename: file.name, contentType: 'audio/mpeg',
              })
              break;
            case 'photo':
              await bot.sendPhoto(chatId, file.attachment, {}, { filename: file.name, contentType: 'image' })
              break;
          }
        })
      }
    } catch (err) {
      logger.error('Telegram Error', err)
    }
  } else {
    logger.error('Telegram Error')
  }
}

async function sendMessage(bot, body) {
  await bot.sendMessage(chatId, `${body.title}${body.description ? '\n' + body.description : ''}`);
}

function convertDAVtoMP4(davFile) {
  const mp4FileBase = getConverted();

  return new Promise((resolve, reject) => {
    const mp4FilePath = path.format({
      ...path.parse(mp4FileBase),
      base: undefined,
      ext: '.mp4',
    });


    const command = `ffmpeg -i ${davFile} -vf "scale=iw/2:ih/2" -vcodec libx264 -t ${config.has('videoduration') ? config.get('videoduration') : 15} -crf 27 -preset veryfast ${mp4FilePath}`;

    exec(command, (error) => {
      if (error) {
        logger.error(`Errore durante la conversione del file: ${error}`);
        reject(error);
      } else {
        logger.debug(`File convertito con successo in: ${mp4FilePath}`);
        resolve(mp4FilePath);
      }
    });
  });
}


const idxPattern = '**/*.idx';
const davPattern = '**/*.dav';
const jpgPattern = '**/*.jpg';

chokidar.watch(monitoredFolder, {
  // ignored: (string) => !anymatch([davPattern, jpgPattern, jpegPattern], string),
  persistent: true,
  ignoreInitial: true,
  usePolling: false,
  awaitWriteFinish: {
    stabilityThreshold: 1000,
    pollInterval: 100
  },
}).on('add', async (file) => {
  handleFileName(path.normalize(file));
});

async function handleFileName(file) {
  let convertedFilePath;
  let deleteFlag = false;
  try {
    const bot = new TelegramBot(token, { polling: false });
    if (anymatch(jpgPattern, file)) {
      logger.debug(`Preparing to send image: ${file}`)
      const buffer = await fsProm.readFile(file);
      logger.debug(`Image size: ${buffer.byteLength} bytes`)
      await sendTelegram(bot, {
        title: 'Uploading image.',
        description: `Uploaded image ${file}`,
      }, [
        {
          type: 'photo',
          attachment: buffer,
          name: path.parse(file).base
        }
      ]);
      logger.debug(`Image sent: ${buffer.byteLength} bytes`)
    } else if (anymatch(idxPattern, file)) {
      const eventInfo = await readEventInfoFromFile(idx);
      if (eventInfo) {
        logger.debug(`Converting dav file: ${file}`);

        try {
          await sendMessage(bot, {
            title: `Event`,
            description: `Event of type: ${eventInfo.Name ?? 'Motion'}`,
          });
        } catch {
          logger.error('Telegram Error', err)
        }
      }
    } else if (anymatch(davPattern, file)) {
      logger.debug(`Dav file found: ${file}`)

      // convert dav file
      logger.debug(`Converting dav file: ${file}`);
      convertedFilePath = await convertDAVtoMP4(file);
      logger.debug(`Converted mp4 file: ${convertedFilePath}`);

      const convertedBuffer = await fsProm.readFile(convertedFilePath);
      if (convertedBuffer.byteLength) {
        logger.debug(`Mp4 file read with size: ${convertedBuffer.byteLength}`);
        await sendTelegram(bot, undefined, [
          {
            type: 'video',
            attachment: convertedBuffer,
            name: path.parse(convertedFilePath).base
          }
        ]);
        if (convertedFilePath) {
          await fsProm.unlink(convertedFilePath);
          logger.debug(`Deleted mp4 file at :${convertedFilePath}`);
        }
      }
      deleteFlag = true;
    }
    if (deleteFlag) {
      logger.debug(`Deleting original file at: ${file}`);
      await fsProm.unlink(file);
    }
  } catch (error) {
    logger.error(`Telegram-uploader-error: ${file}`, error);
  }
}

function getConverted() {
  const now = new Date();
  return `${convertedFolder}/${now.getFullYear()}_${(now.getMonth() + 1).toString().padStart(2, '0')}_${(now.getDate()).toString().padStart(2, '0')}T${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}_${now.getSeconds().toString().padStart(2, '0')}_${now.getMilliseconds().toString().padStart(3, '0')}`;
}

process.on('uncaughtException', (error) => {
  logger.error('FATAL: ', error);
});

logger.info('Started watching folder.')
logger.info(`Watchfolder: ${monitoredFolder}`)

async function readEventInfoFromFile(file) {
  logger.debug(`Reading idx file: ${file}`)

  const fileStream = fs.createReadStream(file);
  if (fileStream) {
    const rl = readline.createInterface({
      input: fileStream,
    });
    for await (const line of rl) {
      if (line.startsWith('Event=')) {
        const eventRaw = line.substring(6);
        return JSON.parse(eventRaw);
      }
    }
  }
}

function findFileWithSameName(idxFile, extension) {
  const idxPath = path.parse(idxFile);
  return path.format({
    dir: idxPath.dir,
    name: idxPath.name,
    ext: extension
  })
}
