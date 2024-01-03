const fs = require('fs/promises')
const fsmonitor = require('fsmonitor')
const config = require('config')
const logger = require('./modules/Logging');

const token = config.get('bot-token');
const chatId = config.get('chatId');
const monitoredFolder = config.get('watchFolder');
const convertedFolder = config.get('convertedFolder') ?? monitoredFolder;
const { exec } = require('child_process');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

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
      console.err('Telegram Error', err)
    }
  } else {
    console.err('Telegram Error')
  }
}

function convertDAVtoMP4(davFile) {
  const davFilePath = getFound(davFile);

  const mp4FileBase = getConverted(davFile);

  return new Promise((resolve, reject) => {
    const mp4FilePath = path.format({
      ...path.parse(mp4FileBase),
      base: undefined,
      ext: '.mp4',
    });


    const command = `ffmpeg -i ${davFilePath} -vf "scale=iw/2:ih/2" -vcodec libx264 -t 15 -crf 23 -preset ultrafast ${mp4FilePath}`;

    exec(command, (error) => {
      if (error) {
        console.error(`Errore durante la conversione del file: ${error}`);
        reject(error);
      } else {
        logger.debug(`File convertito con successo in: ${mp4FilePath}`);
        resolve(mp4FilePath);
      }
    });
  });
}

fsmonitor.watch(monitoredFolder, {
  // include files
  matches: function (relpath) {
    return relpath.match(/\.dav$/i) !== null || relpath.match(/\.jpeg$/i) !== null || relpath.match(/\.jpg$/i) !== null || relpath.match(/\.mp4$/i) !== null;
  },
  // exclude directories
  excludes: function (relpath) {
    return relpath.match(/^\.git$/i) !== null;
  }
}, (change) => {

  if (change.addedFiles) {
    change.addedFiles.forEach(async (file) => {
      const isDav = file.match(/\.dav$/i)
      const isJpg = file.match(/\.jpg$/i)
      const foundFile = getFound(file);
      let convertedFilePath;
      try {
        const bot = new TelegramBot(token, { polling: false })
        if (isJpg) {
          const buffer = await fs.readFile(foundFile)
          await sendMessage(bot, {
            title: 'Uploading image.',
            description: `Uploaded image ${file}`,
          }, [
            {
              type: 'photo',
              attachment: buffer,
              name: file + '.jpg'
            }
          ])
        } else if (isDav) {
          logger.debug(`Uploading to bot ${foundFile}`)
          convertedFilePath = await convertDAVtoMP4(file);

          const convertedBuffer = await fs.readFile(convertedFilePath)

          await sendMessage(bot, {
            title: 'Uploading video.',
            description: `Uploaded file ${convertedFilePath}`,
          }, [
            {
              type: 'video',
              attachment: convertedBuffer,
              name: convertedFilePath
            }
          ])
          if (convertedFilePath) {
            await fs.unlink(convertedFilePath);
          }
        }
        logger.debug(`Deleting ${foundFile}`)
        await fs.unlink(foundFile);

      } catch (error) {
        logger.error(`Telegram-uploader-error: ${foundFile}`, error)
      }
    })
  }
})


function getFound(file) {
  return `${monitoredFolder}/${file}`;
}
function getConverted(file) {
  return `${convertedFolder}/${file}`;
}

process.on('uncaughtException', (error) => {
  logger.error('FATAL: ', error.stack);
});
