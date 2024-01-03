const fs = require('fs/promises')
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
const TelegramBot = require('node-telegram-bot-api');

process.env["NTBA_FIX_319"] = 1
const sendMessage = async function (bot, body, files) {
  if (!bot) {
    logger.debug('bot non trovato')
    return
  }
  if (bot && bot.sendMessage) {
    try {
      await bot.sendMessage(chatId, `${body.title}${body.description ? '\n' + body.description : ''}`)
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

function convertDAVtoMP4(davFile) {
  const davFilePath = davFile;

  const mp4FileBase = getConverted(davFile);

  return new Promise((resolve, reject) => {
    const mp4FilePath = path.format({
      ...path.parse(mp4FileBase),
      base: undefined,
      ext: '.mp4',
    });


    const command = `ffmpeg -i ${davFilePath} -vf "scale=iw/2:ih/2" -vcodec libx264 -t ${config.has('videoduration') ? config.get('videoduration') : 15} -crf 27 -preset veryfast ${mp4FilePath}`;

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


const davPattern = '**/*.dav';
const jpgPattern = '**/*.jpg';
const jpegPattern = '**/*.jpeg';

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
  await handleFileName(file);
});

async function handleFileName(file) {
  let convertedFilePath;
  let deleteFlag = false;
  try {
    const bot = new TelegramBot(token, { polling: false });
    if (anymatch(jpgPattern, file)) {
      const buffer = await fs.readFile(file);
      await sendMessage(bot, {
        title: 'Uploading image.',
        description: `Uploaded image ${file}`,
      }, [
        {
          type: 'photo',
          attachment: buffer,
          name: file
        }
      ]);
    } else if (anymatch(davPattern, file)) {
      logger.debug(`Uploading to bot ${file}`);
      convertedFilePath = await convertDAVtoMP4(file);

      const convertedBuffer = await fs.readFile(convertedFilePath);

      await sendMessage(bot, {
        title: 'Uploading video.',
        description: `Uploaded file ${convertedFilePath}`,
      }, [
        {
          type: 'video',
          attachment: convertedBuffer,
          name: convertedFilePath
        }
      ]);
      if (convertedFilePath) {
        await fs.unlink(convertedFilePath);
      }
      deleteFlag = true;
    }
    if (deleteFlag) {
      logger.debug(`Deleting ${file}`);
      await fs.unlink(file);
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
